import { afterEach, describe, expect, it, vi } from "vitest";
import type { Request } from "express";
import request from "supertest";
import { DatabaseSync } from "node:sqlite";
import { createApp } from "../../src/server/app.js";
import { rateLimitKey } from "../../src/server/rate-limit-key.js";
import { Store } from "../../src/server/store.js";
import type { IdentityProvider } from "../../src/server/oidc.js";

const databases: DatabaseSync[] = [];
const provider: IdentityProvider = {
  authorization(transaction) {
    return new URL(
      `https://accounts.google.com/o/oauth2/v2/auth?state=${transaction.state}`,
    );
  },
  async callback() {
    throw Error("This rate-limit test never authenticates");
  },
};
function app(source: "socket" | "railway-edge" = "socket") {
  const db = new DatabaseSync(":memory:");
  databases.push(db);
  return createApp({
    store: new Store(db, Buffer.alloc(32, 42)),
    provider,
    origin: "https://synthetic.example.test",
    production: true,
    rateLimitIpSource: source,
  });
}
function remaining(response: { headers: Record<string, string> }) {
  const match = response.headers.ratelimit?.match(/\br=(\d+)/);
  expect(match, "draft-8 rate-limit remaining header").not.toBeNull();
  return Number(match![1]);
}
function fakeRequest(value?: string | string[], raw?: string[]) {
  return {
    ip: "127.0.0.1",
    socket: { remoteAddress: "127.0.0.1" },
    headers: value === undefined ? {} : { "x-real-ip": value },
    rawHeaders:
      raw ?? (value === undefined ? [] : ["X-Real-IP", String(value)]),
  } as unknown as Request;
}
afterEach(() => {
  databases.splice(0).forEach((db) => db.close());
  vi.restoreAllMocks();
});

describe("strict Railway edge identity parsing", () => {
  it("defaults to the socket and rejects missing, malformed, duplicate and array header values", () => {
    const socket = rateLimitKey(fakeRequest(), "socket");
    expect(rateLimitKey(fakeRequest("192.0.2.1"), "socket")).toBe(socket);
    const invalid = [
      undefined,
      "",
      "unknown",
      "192.0.2.1, 198.51.100.2",
      "192.0.2.1:443",
      "[2001:db8::1]",
      "fe80::1%eth0",
      " 192.0.2.1 ",
      ["192.0.2.1"],
    ];
    for (const value of invalid)
      expect(rateLimitKey(fakeRequest(value), "railway-edge")).toBe(socket);
    expect(
      rateLimitKey(
        fakeRequest("192.0.2.1", [
          "X-Real-IP",
          "192.0.2.1",
          "x-real-ip",
          "192.0.2.2",
        ]),
        "railway-edge",
      ),
    ).toBe(socket);
  });
  it("normalizes IPv6 subnet peers and both mapped IPv4 forms", () => {
    const key = (value: string) =>
      rateLimitKey(fakeRequest(value), "railway-edge");
    expect(key("2001:db8:abcd:1200::1")).toBe(
      key("2001:db8:abcd:12ff:ffff::2"),
    );
    expect(key("2001:db8:abcd:1200::1")).not.toBe(key("2001:db8:abcd:1300::1"));
    expect(key("::ffff:192.0.2.7")).toBe(key("192.0.2.7"));
    expect(key("::ffff:c000:207")).toBe(key("192.0.2.7"));
  });
});

describe("actual auth and API rate limiters", () => {
  it("keeps the local socket quota despite rotating all forwarded headers, without validation warnings", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const server = app();
    expect(server.get("trust proxy")).toBe(false);
    for (let index = 0; index < 31; index++) {
      const response = await request(server)
        .get("/auth/google")
        .set("X-Real-IP", `192.0.2.${index + 1}`)
        .set("X-Forwarded-For", `198.51.100.${index + 1}`)
        .set("Forwarded", `for=203.0.113.${index + 1}`)
        .set("CF-Connecting-IP", `203.0.113.${index + 1}`);
      expect(response.status).toBe(index < 30 ? 302 : 429);
      expect(remaining(response)).toBe(Math.max(0, 29 - index));
      expect(response.headers["cache-control"]).toBe("no-store");
      if (index === 30)
        expect(response.body).toEqual({ error: "rate_limited" });
    }
    expect(error).not.toHaveBeenCalled();
  });
  it("separates public edge users sharing a socket, ignores attacker forwarding headers, and retains the API quota", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const server = app("railway-edge");
    expect(server.get("trust proxy")).toBe(false);
    for (let index = 0; index < 181; index++) {
      const response = await request(server)
        .get("/api/scenarios")
        .set("X-Real-IP", "192.0.2.10")
        .set("X-Forwarded-For", `198.51.100.${index + 1}`)
        .set("Forwarded", `for=203.0.113.${index + 1}`)
        .set("CF-Connecting-IP", `203.0.113.${index + 1}`);
      expect(response.status).toBe(index < 180 ? 401 : 429);
      expect(response.body).toEqual({
        error: index < 180 ? "unauthorized" : "rate_limited",
      });
      expect(remaining(response)).toBe(Math.max(0, 179 - index));
      expect(response.headers["cache-control"]).toBe("no-store");
    }
    const second = await request(server)
      .get("/api/scenarios")
      .set("X-Real-IP", "192.0.2.11");
    expect(second.status).toBe(401);
    expect(remaining(second)).toBe(179);
    // Auth and API stores remain separate for the same edge identity.
    const auth = await request(server)
      .get("/auth/google")
      .set("X-Real-IP", "192.0.2.10");
    expect(auth.status).toBe(302);
    expect(remaining(auth)).toBe(29);
    const otherAuth = await request(server)
      .get("/auth/google")
      .set("X-Real-IP", "192.0.2.11");
    expect(otherAuth.status).toBe(302);
    expect(remaining(otherAuth)).toBe(29);
    const repeatedAuth = await request(server)
      .get("/auth/google")
      .set("X-Real-IP", "192.0.2.10")
      .set("X-Forwarded-For", "198.51.100.200");
    expect(remaining(repeatedAuth)).toBe(28);
    expect(error).not.toHaveBeenCalled();
  });
  it("uses one socket fallback quota for absent, invalid, list and duplicate headers", async () => {
    const server = app("railway-edge");
    const headers = [
      undefined,
      "garbage",
      "192.0.2.1, 192.0.2.2",
      ["192.0.2.1", "192.0.2.2"],
    ];
    for (const [index, header] of headers.entries()) {
      const req = request(server).get("/api/session");
      if (header !== undefined) req.set({ "X-Real-IP": header });
      const response = await req;
      expect(response.status).toBe(401);
      expect(remaining(response)).toBe(179 - index);
    }
  });
  it("shares actual quotas across IPv6 /56 addresses and mapped IPv4 spellings", async () => {
    const server = app("railway-edge");
    for (const [index, ip] of [
      "2001:db8:abcd:1200::1",
      "2001:db8:abcd:12ff:ffff::2",
    ].entries()) {
      const response = await request(server)
        .get("/api/session")
        .set("X-Real-IP", ip);
      expect(remaining(response)).toBe(179 - index);
    }
    for (const [index, ip] of [
      "192.0.2.7",
      "::ffff:192.0.2.7",
      "::ffff:c000:207",
    ].entries()) {
      const response = await request(server)
        .get("/api/session")
        .set("X-Real-IP", ip);
      expect(remaining(response)).toBe(179 - index);
    }
  });
});
