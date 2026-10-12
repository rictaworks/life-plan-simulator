import { isAbsolute } from "node:path";
import type { RateLimitIpSource } from "./rate-limit-key.js";

export function loadConfig(env: NodeJS.ProcessEnv = process.env) {
  const required = (name: string) => {
    const value = env[name];
    if (!value) throw Error(`Missing required configuration: ${name}`);
    return value;
  };
  const origin = required("APP_ORIGIN");
  const url = new URL(origin);
  const production = env.NODE_ENV !== "development";
  if (
    url.origin !== origin ||
    url.username ||
    url.password ||
    (url.protocol !== "https:" &&
      (production ||
        url.protocol !== "http:" ||
        !["localhost", "127.0.0.1"].includes(url.hostname)))
  )
    throw Error(
      "APP_ORIGIN must be an exact HTTPS origin (HTTP loopback allowed only in development)",
    );
  const clientId = required("GOOGLE_CLIENT_ID"),
    clientSecret = required("GOOGLE_CLIENT_SECRET");
  const hexKey = required("DATA_ENCRYPTION_KEY");
  if (!/^[a-f\d]{64}$/i.test(hexKey) || /^0+$/.test(hexKey))
    throw Error(
      "DATA_ENCRYPTION_KEY must be a nonzero 32-byte key encoded as 64 hexadecimal characters",
    );
  const databasePath = required("DATABASE_PATH");
  if (!isAbsolute(databasePath))
    throw Error("DATABASE_PATH must be an absolute file path");
  const port = Number(env.PORT ?? "3000");
  if (!Number.isInteger(port) || port < 1 || port > 65535)
    throw Error("PORT must be an integer between 1 and 65535");
  const host = env.HOST ?? "127.0.0.1";
  if (host !== "127.0.0.1" && host !== "0.0.0.0")
    throw Error("HOST must be 127.0.0.1 or 0.0.0.0");
  const rateLimitIpSource = env.RATE_LIMIT_IP_SOURCE ?? "socket";
  if (rateLimitIpSource !== "socket" && rateLimitIpSource !== "railway-edge")
    throw Error("RATE_LIMIT_IP_SOURCE must be socket or railway-edge");
  return {
    origin,
    production,
    clientId,
    clientSecret,
    key: Buffer.from(hexKey, "hex"),
    databasePath,
    port,
    host,
    rateLimitIpSource: rateLimitIpSource as RateLimitIpSource,
    redirectUri: `${origin}/auth/callback`,
  };
}
