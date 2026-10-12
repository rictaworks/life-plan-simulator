import express, {
  type Request,
  type Response,
  type NextFunction,
} from "express";
import cookieParser from "cookie-parser";
import helmet from "helmet";
import { rateLimit } from "express-rate-limit";
import { randomBytes, timingSafeEqual } from "node:crypto";
import { z } from "zod";
import { scenarioSchema } from "../domain/schema.js";
import { Store, StoreError, ABSOLUTE_MS, type Session } from "./store.js";
import type { IdentityProvider } from "./oidc.js";
import { rateLimitKey, type RateLimitIpSource } from "./rate-limit-key.js";

type Transaction = {
  state: string;
  nonce: string;
  verifier: string;
  expires: number;
};
export type AppOptions = {
  store: Store;
  provider: IdentityProvider;
  origin: string;
  production: boolean;
  clock?: () => number;
  rateLimitIpSource?: RateLimitIpSource;
};
const token = () => randomBytes(32).toString("base64url");
const equal = (a: unknown, b: string) =>
  typeof a === "string" &&
  Buffer.byteLength(a) === Buffer.byteLength(b) &&
  timingSafeEqual(Buffer.from(a), Buffer.from(b));
const createBody = z.object({ input: scenarioSchema }).strict();
const updateBody = z
  .object({
    input: scenarioSchema,
    version: z.number().int().min(1).max(Number.MAX_SAFE_INTEGER),
  })
  .strict();

export function createApp({
  store,
  provider,
  origin,
  production,
  clock = Date.now,
  rateLimitIpSource = "socket",
}: AppOptions) {
  const app = express();
  app.disable("x-powered-by");
  app.set("trust proxy", false);
  const transactions = new Map<string, Transaction>();
  const cookie = {
    httpOnly: true,
    secure: production,
    sameSite: "lax" as const,
    path: "/",
  };
  app.use(
    helmet({
      contentSecurityPolicy: {
        directives: {
          defaultSrc: ["'self'"],
          scriptSrc: ["'self'"],
          styleSrc: ["'self'", "'unsafe-inline'"],
          imgSrc: ["'self'", "data:"],
          connectSrc: ["'self'"],
          frameAncestors: ["'none'"],
          formAction: ["'self'"],
          baseUri: ["'none'"],
        },
      },
      referrerPolicy: { policy: "no-referrer" },
    }),
  );
  app.use((_req, res, next) => {
    res.set("Cache-Control", "no-store");
    next();
  });
  app.use(cookieParser());
  app.use(express.json({ limit: "256kb", strict: true }));
  const keyGenerator = (req: Request) => rateLimitKey(req, rateLimitIpSource);
  const loginLimit = rateLimit({
    keyGenerator,
    windowMs: 15 * 60 * 1000,
    limit: 30,
    standardHeaders: "draft-8",
    legacyHeaders: false,
    handler: (_req, res) => {
      res.status(429).json({ error: "rate_limited" });
    },
  });
  const apiLimit = rateLimit({
    keyGenerator,
    windowMs: 60 * 1000,
    limit: 180,
    standardHeaders: "draft-8",
    legacyHeaders: false,
    handler: (_req, res) => {
      res.status(429).json({ error: "rate_limited" });
    },
  });
  app.use("/auth", loginLimit);
  app.use("/api", apiLimit);
  app.get("/auth/google", (req, res) => {
    for (const [key, value] of transactions)
      if (value.expires <= clock()) transactions.delete(key);
    if (transactions.size >= 1000) {
      res.status(503).json({ error: "temporarily_unavailable" });
      return;
    }
    const previous = req.cookies?.oidc_tx;
    if (typeof previous === "string") transactions.delete(previous);
    const id = token();
    const transaction = {
      state: token(),
      nonce: token(),
      verifier: token(),
      expires: clock() + 10 * 60 * 1000,
    };
    transactions.set(id, transaction);
    res.cookie("oidc_tx", id, { ...cookie, maxAge: 10 * 60 * 1000 });
    res.redirect(provider.authorization(transaction).href);
  });
  app.get("/auth/callback", async (req, res) => {
    const id = req.cookies?.oidc_tx;
    const transaction =
      typeof id === "string" ? transactions.get(id) : undefined;
    if (typeof id === "string") transactions.delete(id);
    res.clearCookie("oidc_tx", cookie);
    try {
      if (
        !transaction ||
        transaction.expires <= clock() ||
        !equal(req.query.state, transaction.state)
      )
        throw Error("invalid login transaction");
      const identity = await provider.callback(
        new URL(req.originalUrl, origin),
        transaction,
      );
      if (
        identity.issuer !== "https://accounts.google.com" ||
        !identity.subject ||
        !identity.email
      )
        throw Error("invalid identity");
      store.deleteSession(req.cookies?.sid);
      const session = store.createSession(store.identify(identity), clock());
      res.cookie("sid", session.token, { ...cookie, maxAge: ABSOLUTE_MS });
      res.redirect("/");
    } catch {
      res.redirect("/?authError=failed");
    }
  });
  const authenticated = (req: Request, res: Response, next: NextFunction) => {
    const session = store.session(req.cookies?.sid, clock());
    if (!session) {
      res.clearCookie("sid", cookie);
      res.status(401).json({ error: "unauthorized" });
      return;
    }
    res.locals.session = session;
    next();
  };
  const csrf = (req: Request, res: Response, next: NextFunction) => {
    const session = res.locals.session as Session;
    if (
      req.get("origin") !== origin ||
      !equal(req.get("X-CSRF-Token"), session.csrfToken)
    ) {
      res.status(403).json({ error: "csrf" });
      return;
    }
    next();
  };
  const boundIdentity = (req: Request, res: Response, next: NextFunction) => {
    if (req.get("X-Session-User") !== (res.locals.session as Session).user.id) {
      res.status(401).json({ error: "identity_changed" });
      return;
    }
    next();
  };
  app.post("/auth/logout", authenticated, boundIdentity, csrf, (req, res) => {
    store.deleteSession(req.cookies?.sid);
    res.clearCookie("sid", cookie);
    res.status(204).end();
  });
  app.use("/api", authenticated);
  app.get("/api/session", (_req, res) => res.json(res.locals.session));
  app.use("/api/scenarios", boundIdentity);
  app.use("/api", (req, res, next) => {
    if (["GET", "HEAD", "OPTIONS"].includes(req.method)) next();
    else csrf(req, res, next);
  });
  const owner = (res: Response) => (res.locals.session as Session).user.id;
  app.get("/api/scenarios", (_req, res) =>
    res.json({ scenarios: store.list(owner(res)) }),
  );
  app.get("/api/scenarios/:id", (req, res) =>
    res.json(store.get(owner(res), String(req.params.id))),
  );
  app.post("/api/scenarios", (req, res) => {
    const parsed = createBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({
        error: "invalid_input",
        issues: parsed.error.issues.map((i) => ({
          path: i.path,
          message: i.message,
        })),
      });
      return;
    }
    res.status(201).json(store.create(owner(res), parsed.data.input, clock()));
  });
  app.put("/api/scenarios/:id", (req, res) => {
    const parsed = updateBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({
        error: "invalid_input",
        issues: parsed.error.issues.map((i) => ({
          path: i.path,
          message: i.message,
        })),
      });
      return;
    }
    res.json(
      store.update(
        owner(res),
        String(req.params.id),
        parsed.data.input,
        parsed.data.version,
        clock(),
      ),
    );
  });
  app.post("/api/scenarios/:id/duplicate", (req, res) =>
    res
      .status(201)
      .json(store.duplicate(owner(res), String(req.params.id), clock())),
  );
  app.delete("/api/scenarios/:id", (req, res) => {
    store.delete(owner(res), String(req.params.id));
    res.status(204).end();
  });
  app.delete("/api/scenarios", (_req, res) => {
    store.deleteAll(owner(res));
    res.status(204).end();
  });
  app.use("/api", (_req, res) => res.status(404).json({ error: "not_found" }));
  app.use(
    (error: unknown, _req: Request, res: Response, _next: NextFunction) => {
      if (error instanceof StoreError) {
        const statuses = {
          not_found: 404,
          conflict: 409,
          storage_limit: 422,
          invalid_saved_data: 422,
        };
        res.status(statuses[error.code]).json({ error: error.code });
        return;
      }
      if (
        error &&
        typeof error === "object" &&
        "type" in error &&
        error.type === "entity.too.large"
      ) {
        res.status(413).json({ error: "payload_too_large" });
        return;
      }
      if (error instanceof SyntaxError) {
        res.status(400).json({ error: "invalid_json" });
        return;
      }
      // Never serialize exceptions, request bodies, URLs or identity/session values into logs or responses.
      res.status(500).json({ error: "internal_error" });
    },
  );
  return app;
}
