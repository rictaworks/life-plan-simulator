import { beforeEach, afterEach, describe, expect, it } from "vitest";
import request from "supertest";
import { DatabaseSync } from "node:sqlite";
import { createApp } from "../../src/server/app.js";
import { Store } from "../../src/server/store.js";
import type { IdentityProvider } from "../../src/server/oidc.js";

const origin = "https://app.example";
const input = {
  schemaVersion: 1,
  name: "架空テスト",
  startMonth: "2026-01",
  months: 12,
  cases: [
    {
      id: "base",
      name: "基準",
      income: 300000,
      living: 200000,
      cash: 1000000,
      investment: 0,
      allocation: 50,
      annualReturn: 0,
      annualInflation: 0,
      events: [],
    },
  ],
};
let now: number, store: Store, db: DatabaseSync;
let app: ReturnType<typeof createApp>;
let identity = {
  issuer: "https://accounts.google.com",
  subject: "A",
  email: "same@example.test",
};
let fail = false;
const provider: IdentityProvider = {
  authorization(t) {
    return new URL(
      `https://accounts.google.com/o/oauth2/v2/auth?state=${t.state}`,
    );
  },
  async callback(url, t) {
    if (fail || url.searchParams.get("state") !== t.state)
      throw Error("denied");
    return identity;
  },
};
async function login(subject = "A") {
  identity = { ...identity, subject };
  const start = await request(app).get("/auth/google");
  const state = new URL(start.headers.location).searchParams.get("state");
  const cookies = start.headers["set-cookie"] as unknown as string[];
  const callback = await request(app)
    .get(`/auth/callback?code=mock&state=${state}`)
    .set("Cookie", cookies);
  expect(callback.status).toBe(302);
  const cookie = (callback.headers["set-cookie"] as unknown as string[])
    .find((c) => c.startsWith("sid="))!
    .split(";")[0]!;
  const session = await request(app).get("/api/session").set("Cookie", cookie);
  return {
    cookie,
    csrf: session.body.csrfToken as string,
    user: session.body.user,
  };
}
function write(
  method: "post" | "put" | "delete",
  path: string,
  auth: { cookie: string; csrf: string; user: { id: string } },
  body?: unknown,
) {
  const r = request(app)
    [method](path)
    .set("Cookie", auth.cookie)
    .set("Origin", origin)
    .set("X-CSRF-Token", auth.csrf)
    .set("X-Session-User", auth.user.id);
  return body ? r.send(body) : r;
}
beforeEach(() => {
  now = Date.UTC(2026, 0, 1);
  fail = false;
  db = new DatabaseSync(":memory:");
  store = new Store(db, Buffer.alloc(32, 42));
  app = createApp({
    store,
    provider,
    origin,
    production: false,
    clock: () => now,
  });
});
afterEach(() => db.close());

describe("session lifecycle and login", () => {
  it("requires authentication and suppresses cache", async () => {
    for (const path of [
      "/api/session",
      "/api/scenarios",
      "/api/scenarios/unknown",
    ]) {
      const res = await request(app).get(path);
      expect(res.status).toBe(401);
      expect(res.headers["cache-control"]).toContain("no-store");
    }
  });
  it("stores server sessions and rotates and invalidates on logout", async () => {
    const a = await login();
    expect(a.user.email).toBe("same@example.test");
    expect((await write("post", "/auth/logout", a)).status).toBe(204);
    expect(
      (
        await request(app)
          .get("/api/session")
          .set("Cookie", a.cookie)
          .set("X-Session-User", a.user.id)
      ).status,
    ).toBe(401);
  });
  it("rejects CSRF and Origin failures including logout", async () => {
    const a = await login();
    expect(
      (
        await request(app)
          .post("/api/scenarios")
          .set("Cookie", a.cookie)
          .set("X-Session-User", a.user.id)
          .send({ input })
      ).status,
    ).toBe(403);
    expect(
      (
        await request(app)
          .post("/api/scenarios")
          .set("Cookie", a.cookie)
          .set("X-Session-User", a.user.id)
          .set("Origin", "https://evil.test")
          .set("X-CSRF-Token", a.csrf)
          .send({ input })
      ).status,
    ).toBe(403);
    expect(
      (
        await request(app)
          .post("/auth/logout")
          .set("Cookie", a.cookie)
          .set("X-Session-User", a.user.id)
          .set("Origin", origin)
          .set("X-CSRF-Token", "wrong")
      ).status,
    ).toBe(403);
  });
  it("expires idle and absolute sessions", async () => {
    const a = await login();
    now += 30 * 60 * 1000;
    expect(
      (
        await request(app)
          .get("/api/session")
          .set("Cookie", a.cookie)
          .set("X-Session-User", a.user.id)
      ).status,
    ).toBe(401);
    const b = await login();
    for (let n = 0; n < 24; n++) {
      now += 29 * 60 * 1000;
      await request(app)
        .get("/api/session")
        .set("Cookie", b.cookie)
        .set("X-Session-User", b.user.id);
    }
    now += 25 * 60 * 1000;
    expect(
      (
        await request(app)
          .get("/api/session")
          .set("Cookie", b.cookie)
          .set("X-Session-User", b.user.id)
      ).status,
    ).toBe(401);
  });
  it("does not establish a session on provider failure or invalid/expired login state", async () => {
    const start = await request(app).get("/auth/google");
    const state = new URL(start.headers.location).searchParams.get("state");
    const cookie = start.headers["set-cookie"];
    fail = true;
    const rejected = await request(app)
      .get(`/auth/callback?code=mock&state=${state}`)
      .set("Cookie", cookie);
    expect(rejected.headers.location).toBe("/?authError=failed");
    expect(JSON.stringify(rejected.headers["set-cookie"])).not.toMatch(
      /sid=[^;]/,
    );
    expect(
      (await request(app).get("/auth/callback?code=x&state=wrong")).headers
        .location,
    ).toBe("/?authError=failed");
    fail = false;
    const next = await request(app).get("/auth/google");
    now += 10 * 60 * 1000;
    expect(
      (
        await request(app)
          .get(
            `/auth/callback?code=x&state=${new URL(next.headers.location).searchParams.get("state")}`,
          )
          .set("Cookie", next.headers["set-cookie"])
      ).headers.location,
    ).toBe("/?authError=failed");
  });
});

describe("owner scoped persistence", () => {
  it("saves, lists, retrieves, updates, duplicates and deletes across sessions", async () => {
    const a = await login();
    const created = await write("post", "/api/scenarios", a, { input });
    expect(created.status).toBe(201);
    const { id } = created.body;
    expect(created.body.version).toBe(1);
    expect(created.body.input).toEqual(input);
    const otherDevice = await login();
    expect(otherDevice.user.id).toBe(a.user.id);
    expect(
      (
        await request(app)
          .get(`/api/scenarios/${id}`)
          .set("Cookie", otherDevice.cookie)
          .set("X-Session-User", otherDevice.user.id)
      ).body.input,
    ).toEqual(input);
    expect(
      (
        await request(app)
          .get("/api/scenarios")
          .set("Cookie", a.cookie)
          .set("X-Session-User", a.user.id)
      ).body.scenarios,
    ).toHaveLength(1);
    const changed = { ...input, name: "別の仮定" };
    expect(
      (
        await write("put", `/api/scenarios/${id}`, a, {
          input: changed,
          version: 1,
        })
      ).body.version,
    ).toBe(2);
    expect(
      (
        await write("put", `/api/scenarios/${id}`, otherDevice, {
          input,
          version: 1,
        })
      ).status,
    ).toBe(409);
    const duplicate = await write("post", `/api/scenarios/${id}/duplicate`, a);
    expect(duplicate.status).toBe(201);
    expect(duplicate.body.id).not.toBe(id);
    expect((await write("delete", `/api/scenarios/${id}`, a)).status).toBe(204);
    expect(
      (
        await request(app)
          .get(`/api/scenarios/${id}`)
          .set("Cookie", a.cookie)
          .set("X-Session-User", a.user.id)
      ).status,
    ).toBe(404);
    expect((await write("delete", "/api/scenarios", a)).status).toBe(204);
    expect(
      (
        await request(app)
          .get("/api/scenarios")
          .set("Cookie", a.cookie)
          .set("X-Session-User", a.user.id)
      ).body.scenarios,
    ).toEqual([]);
  });
  it("keeps same-email Google subjects separate and hides other owners on every route", async () => {
    const a = await login("A");
    const created = await write("post", "/api/scenarios", a, { input });
    const id = created.body.id;
    const b = await login("B");
    expect(a.user.id).not.toBe(b.user.id);
    expect(
      (
        await request(app)
          .get("/api/scenarios")
          .set("Cookie", b.cookie)
          .set("X-Session-User", b.user.id)
      ).body.scenarios,
    ).toEqual([]);
    expect(
      (
        await request(app)
          .get(`/api/scenarios/${id}`)
          .set("Cookie", b.cookie)
          .set("X-Session-User", b.user.id)
      ).status,
    ).toBe(404);
    expect(
      (await write("put", `/api/scenarios/${id}`, b, { input, version: 1 }))
        .status,
    ).toBe(404);
    expect((await write("delete", `/api/scenarios/${id}`, b)).status).toBe(404);
    expect(
      (await write("post", `/api/scenarios/${id}/duplicate`, b)).status,
    ).toBe(404);
    await write("delete", "/api/scenarios", b);
    expect(
      (
        await request(app)
          .get(`/api/scenarios/${id}`)
          .set("Cookie", a.cookie)
          .set("X-Session-User", a.user.id)
      ).status,
    ).toBe(200);
  });
  it("rejects forged ownership, invalid inputs, unknown formats, oversized and excessive storage", async () => {
    const a = await login();
    expect(
      (await write("post", "/api/scenarios", a, { input, ownerId: "victim" }))
        .status,
    ).toBe(400);
    expect(
      (
        await write("post", "/api/scenarios", a, {
          input: { ...input, schemaVersion: 99 },
        })
      ).status,
    ).toBe(400);
    expect(
      (
        await write("post", "/api/scenarios", a, {
          input: { ...input, months: 0 },
        })
      ).status,
    ).toBe(400);
    expect(
      (
        await write("post", "/api/scenarios", a, {
          input,
          padding: "x".repeat(270000),
        })
      ).status,
    ).toBe(413);
    for (let n = 0; n < 50; n++)
      expect((await write("post", "/api/scenarios", a, { input })).status).toBe(
        201,
      );
    expect((await write("post", "/api/scenarios", a, { input })).status).toBe(
      422,
    );
  });
  it("encrypts financial payloads and fails safely on tampering", async () => {
    const a = await login();
    const created = await write("post", "/api/scenarios", a, { input });
    const row = db.prepare("SELECT payload FROM scenarios").get() as {
      payload: string;
    };
    expect(row.payload).not.toContain(input.name);
    expect(row.payload).not.toContain("300000");
    db.prepare("UPDATE scenarios SET payload=?").run("corrupt");
    const read = await request(app)
      .get(`/api/scenarios/${created.body.id}`)
      .set("Cookie", a.cookie)
      .set("X-Session-User", a.user.id);
    expect(read.status).toBe(422);
    expect(JSON.stringify(read.body)).not.toContain(input.name);
  });
});

describe("security boundaries", () => {
  it("rejects every unauthenticated mutation including account-claimed body", async () => {
    for (const [method, path, body] of [
      ["post", "/api/scenarios", { input, ownerId: "A" }],
      ["put", "/api/scenarios/id", { input, version: 1 }],
      ["delete", "/api/scenarios/id", undefined],
      ["delete", "/api/scenarios", undefined],
      ["post", "/api/scenarios/id/duplicate", undefined],
    ] as const) {
      expect(
        (await request(app)[method](path).set("Origin", origin).send(body))
          .status,
      ).toBe(401);
    }
  });
  it("uses HttpOnly SameSite cookies and Secure in production, hashing stored session IDs", async () => {
    app = createApp({
      store,
      provider,
      origin,
      production: true,
      clock: () => now,
    });
    const start = await request(app).get("/auth/google");
    expect(start.headers["set-cookie"][0]).toContain("Secure");
    expect(start.headers["set-cookie"][0]).toContain("HttpOnly");
    expect(start.headers["set-cookie"][0]).toContain("SameSite=Lax");
    const a = await login();
    const row = db.prepare("SELECT token_hash FROM sessions").get() as {
      token_hash: string;
    };
    expect(row.token_hash).toMatch(/^[a-f0-9]{64}$/);
    expect(row.token_hash).not.toBe(a.cookie.slice(4));
  });
  it("consumes login state once and binds it to browser cookie", async () => {
    const start = await request(app).get("/auth/google");
    const state = new URL(start.headers.location).searchParams.get("state");
    expect(
      (await request(app).get(`/auth/callback?code=x&state=${state}`)).headers
        .location,
    ).toBe("/?authError=failed");
    const callback = await request(app)
      .get(`/auth/callback?code=x&state=${state}`)
      .set("Cookie", start.headers["set-cookie"]);
    expect(callback.headers.location).toBe("/");
    expect(
      (
        await request(app)
          .get(`/auth/callback?code=x&state=${state}`)
          .set("Cookie", start.headers["set-cookie"])
      ).headers.location,
    ).toBe("/?authError=failed");
  });
  it("rate-limits login and authenticated API calls with retry metadata", async () => {
    const a = await login();
    for (let n = 0; n < 179; n++)
      await request(app)
        .get("/api/session")
        .set("Cookie", a.cookie)
        .set("X-Session-User", a.user.id);
    const response = await request(app)
      .get("/api/session")
      .set("Cookie", a.cookie)
      .set("X-Session-User", a.user.id);
    expect(response.status).toBe(429);
    expect(response.headers["retry-after"]).toBeDefined();
    for (let n = 0; n < 28; n++) await request(app).get("/auth/google");
    const loginResponse = await request(app).get("/auth/google");
    expect(loginResponse.status).toBe(429);
  });
  it("rejects swapping encrypted payloads between owners and between scenario IDs", async () => {
    const a = await login("A"),
      b = await login("B");
    const first = await write("post", "/api/scenarios", a, { input });
    const second = await write("post", "/api/scenarios", b, { input });
    const row = db
      .prepare("SELECT payload FROM scenarios WHERE id=?")
      .get(first.body.id) as { payload: string };
    db.prepare("UPDATE scenarios SET payload=? WHERE id=?").run(
      row.payload,
      second.body.id,
    );
    expect(
      (
        await request(app)
          .get(`/api/scenarios/${second.body.id}`)
          .set("Cookie", b.cookie)
          .set("X-Session-User", b.user.id)
      ).status,
    ).toBe(422);
  });
});

it("rejects stale account headers after a different account signs in", async () => {
  const a = await login("A"),
    b = await login("B");
  expect(
    (
      await request(app)
        .get("/api/scenarios")
        .set("Cookie", b.cookie)
        .set("X-Session-User", a.user.id)
    ).status,
  ).toBe(401);
  expect(
    (
      await request(app)
        .post("/api/scenarios")
        .set("Cookie", b.cookie)
        .set("Origin", origin)
        .set("X-CSRF-Token", b.csrf)
        .set("X-Session-User", a.user.id)
        .send({ input })
    ).status,
  ).toBe(401);
  expect(
    (
      await request(app)
        .post("/auth/logout")
        .set("Cookie", b.cookie)
        .set("Origin", origin)
        .set("X-CSRF-Token", b.csrf)
        .set("X-Session-User", a.user.id)
    ).status,
  ).toBe(401);
});

it("rotates an existing browser session after successful login and rejects its old cookie", async () => {
  const previous = await login();
  const start = await request(app)
    .get("/auth/google")
    .set("Cookie", previous.cookie);
  const state = new URL(start.headers.location).searchParams.get("state");
  const transactionCookie = (
    start.headers["set-cookie"] as unknown as string[]
  )[0]!.split(";")[0]!;
  const callback = await request(app)
    .get(`/auth/callback?code=mock&state=${state}`)
    .set("Cookie", [previous.cookie, transactionCookie]);
  expect(callback.headers.location).toBe("/");
  const currentCookie = (callback.headers["set-cookie"] as unknown as string[])
    .find((c) => c.startsWith("sid="))!
    .split(";")[0]!;
  expect(currentCookie).not.toBe(previous.cookie);
  expect(
    (await request(app).get("/api/session").set("Cookie", previous.cookie))
      .status,
  ).toBe(401);
  expect(
    (await request(app).get("/api/session").set("Cookie", currentCookie)).body
      .user.id,
  ).toBe(previous.user.id);
});

it("binds encrypted payloads to the scenario ID even within the same owner", async () => {
  const a = await login();
  const first = await write("post", "/api/scenarios", a, { input });
  const second = await write("post", "/api/scenarios", a, { input });
  const row = db
    .prepare("SELECT payload FROM scenarios WHERE id=?")
    .get(first.body.id) as { payload: string };
  db.prepare("UPDATE scenarios SET payload=? WHERE id=?").run(
    row.payload,
    second.body.id,
  );
  expect(
    (
      await request(app)
        .get(`/api/scenarios/${second.body.id}`)
        .set("Cookie", a.cookie)
        .set("X-Session-User", a.user.id)
    ).status,
  ).toBe(422);
  expect(
    (
      await request(app)
        .get(`/api/scenarios/${first.body.id}`)
        .set("Cookie", a.cookie)
        .set("X-Session-User", a.user.id)
    ).status,
  ).toBe(200);
});
