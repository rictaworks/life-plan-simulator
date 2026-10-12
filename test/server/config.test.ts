import { describe, expect, it } from "vitest";
import { loadConfig } from "../../src/server/config.js";
const env = {
  NODE_ENV: "production",
  APP_ORIGIN: "https://app.example",
  GOOGLE_CLIENT_ID: "client",
  GOOGLE_CLIENT_SECRET: "secret",
  DATA_ENCRYPTION_KEY: "ab".repeat(32),
  DATABASE_PATH: "/tmp/test-life-plan.sqlite",
};
describe("runtime configuration", () => {
  it("fails closed on missing configuration", () => {
    expect(() => loadConfig({})).toThrow();
  });
  it("requires HTTPS production, exact origin and nontrivial 32-byte key", () => {
    expect(() =>
      loadConfig({ ...env, APP_ORIGIN: "http://app.example" }),
    ).toThrow();
    expect(() =>
      loadConfig({ ...env, APP_ORIGIN: "https://app.example/path" }),
    ).toThrow();
    expect(() =>
      loadConfig({ ...env, DATA_ENCRYPTION_KEY: "0".repeat(64) }),
    ).toThrow();
    expect(() => loadConfig({ ...env, DATA_ENCRYPTION_KEY: "bad" })).toThrow();
    expect(() => loadConfig({ ...env, DATABASE_PATH: ":memory:" })).toThrow();
    expect(() => loadConfig({ ...env, PORT: "bad" })).toThrow();
  });
  it("accepts explicit config and permits HTTP only for local development", () => {
    expect(loadConfig(env)).toMatchObject({
      origin: "https://app.example",
      production: true,
      port: 3000,
      host: "127.0.0.1",
      rateLimitIpSource: "socket",
      redirectUri: "https://app.example/auth/callback",
    });
    expect(
      loadConfig({
        ...env,
        NODE_ENV: "development",
        APP_ORIGIN: "http://localhost:3000",
      }).production,
    ).toBe(false);
    expect(() =>
      loadConfig({
        ...env,
        NODE_ENV: "development",
        APP_ORIGIN: "http://public.example",
      }),
    ).toThrow();
  });
  it("requires explicit all-interface binding and rejects ambiguous hosts", () => {
    expect(loadConfig({ ...env, HOST: "0.0.0.0", PORT: "8080" })).toMatchObject(
      {
        host: "0.0.0.0",
        port: 8080,
      },
    );
    for (const host of ["", "localhost", "::", "example.com", " 0.0.0.0"])
      expect(() => loadConfig({ ...env, HOST: host })).toThrow("HOST must be");
  });
});

it("only enables Railway IP assertions by explicit valid configuration", () => {
  expect(
    loadConfig({ ...env, RATE_LIMIT_IP_SOURCE: "railway-edge" })
      .rateLimitIpSource,
  ).toBe("railway-edge");
  for (const value of ["", "true", "1", "railway", " railway-edge"])
    expect(() => loadConfig({ ...env, RATE_LIMIT_IP_SOURCE: value })).toThrow(
      "RATE_LIMIT_IP_SOURCE must be",
    );
});
