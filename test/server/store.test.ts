import { describe, expect, it } from "vitest";
import { mkdtempSync, rmSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { Store } from "../../src/server/store.js";
import { scenarioSchema } from "../../src/domain/schema.js";

const input = scenarioSchema.parse({
  schemaVersion: 1,
  name: "private-financial-title",
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
});
describe("durable encrypted storage", () => {
  it("survives reopening the server database and keeps financial payloads encrypted on disk", () => {
    const temp = mkdtempSync(join(tmpdir(), "life-plan-test-"));
    const path = join(temp, "app.sqlite");
    const key = Buffer.alloc(32, 42);
    let db = new DatabaseSync(path);
    try {
      let store = new Store(db, key);
      const user = store.identify({
        issuer: "https://accounts.google.com",
        subject: "A",
        email: "a@example.test",
      });
      const saved = store.create(user.id, input, Date.now());
      const session = store.createSession(user, Date.now());
      db.close();
      expect(
        readFileSync(path).includes(Buffer.from("private-financial-title")),
      ).toBe(false);
      expect(readFileSync(path).includes(Buffer.from(session.token))).toBe(
        false,
      );
      expect(readFileSync(path).includes(Buffer.from("a@example.test"))).toBe(
        false,
      );
      db = new DatabaseSync(path);
      store = new Store(db, key);
      const same = store.identify({
        issuer: "https://accounts.google.com",
        subject: "A",
        email: "new@example.test",
      });
      expect(same.id).toBe(user.id);
      expect(store.get(same.id, saved.id).input).toEqual(input);
      expect(store.session(session.token, Date.now())).toBeUndefined();
      store.deleteAll(same.id);
      expect(store.list(same.id)).toEqual([]);
      db.close();
      db = new DatabaseSync(path);
      store = new Store(db, key);
      expect(store.list(same.id)).toEqual([]);
    } finally {
      if (db.isOpen) db.close();
      rmSync(temp, { recursive: true, force: true });
    }
  });
  it("refuses an invalid encryption key", () => {
    const db = new DatabaseSync(":memory:");
    try {
      expect(() => new Store(db, Buffer.alloc(8))).toThrow();
    } finally {
      db.close();
    }
  });
});
