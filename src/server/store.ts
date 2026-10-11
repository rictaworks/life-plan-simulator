import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
  randomUUID,
} from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import { scenarioSchema, type ScenarioInput } from "../domain/schema.js";

export class StoreError extends Error {
  constructor(
    public code:
      "not_found" | "conflict" | "storage_limit" | "invalid_saved_data",
  ) {
    super(code);
  }
}
export type Saved = {
  id: string;
  version: number;
  createdAt: string;
  updatedAt: string;
  input: ScenarioInput;
};
export type User = { id: string; email: string };
export type Session = { user: User; csrfToken: string };
type Row = {
  id: string;
  owner_id: string;
  version: number;
  created_at: string;
  updated_at: string;
  payload: string;
};
const hash = (value: string) =>
  createHash("sha256").update(value).digest("hex");
export const IDLE_MS = 30 * 60 * 1000;
export const ABSOLUTE_MS = 12 * 60 * 60 * 1000;

/** Every scenario operation scopes its SQL to the authenticated internal user. */
export class Store {
  private sessionEmail = new Map<string, string>();
  constructor(
    private db: DatabaseSync,
    private key: Buffer,
  ) {
    if (key.length !== 32) throw Error("DATA_ENCRYPTION_KEY must be 32 bytes");
    db.exec(`PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000; PRAGMA secure_delete=ON;
   CREATE TABLE IF NOT EXISTS users(id TEXT PRIMARY KEY, issuer TEXT NOT NULL, subject TEXT NOT NULL, UNIQUE(issuer,subject));
   CREATE TABLE IF NOT EXISTS sessions(token_hash TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id), csrf TEXT NOT NULL, created_at INTEGER NOT NULL, touched_at INTEGER NOT NULL);
   CREATE TABLE IF NOT EXISTS scenarios(id TEXT PRIMARY KEY, owner_id TEXT NOT NULL REFERENCES users(id), version INTEGER NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL, payload TEXT NOT NULL);
   CREATE INDEX IF NOT EXISTS scenarios_owner ON scenarios(owner_id);
  `);
  }
  private seal(input: ScenarioInput, id: string, owner: string): string {
    const iv = randomBytes(12),
      cipher = createCipheriv("aes-256-gcm", this.key, iv);
    cipher.setAAD(Buffer.from(`${owner}:${id}`));
    const payload = Buffer.concat([
      cipher.update(JSON.stringify(input), "utf8"),
      cipher.final(),
    ]);
    return Buffer.concat([iv, cipher.getAuthTag(), payload]).toString("base64");
  }
  private open(row: Row): Saved {
    try {
      const data = Buffer.from(row.payload, "base64");
      const decipher = createDecipheriv(
        "aes-256-gcm",
        this.key,
        data.subarray(0, 12),
      );
      decipher.setAAD(Buffer.from(`${row.owner_id}:${row.id}`));
      decipher.setAuthTag(data.subarray(12, 28));
      const decoded = Buffer.concat([
        decipher.update(data.subarray(28)),
        decipher.final(),
      ]).toString("utf8");
      return {
        id: row.id,
        version: row.version,
        createdAt: row.created_at,
        updatedAt: row.updated_at,
        input: scenarioSchema.parse(JSON.parse(decoded)),
      };
    } catch {
      throw new StoreError("invalid_saved_data");
    }
  }
  identify(identity: { issuer: string; subject: string; email: string }): User {
    this.db
      .prepare(
        "INSERT INTO users(id,issuer,subject) VALUES(?,?,?) ON CONFLICT(issuer,subject) DO NOTHING",
      )
      .run(randomUUID(), identity.issuer, identity.subject);
    const row = this.db
      .prepare("SELECT id FROM users WHERE issuer=? AND subject=?")
      .get(identity.issuer, identity.subject) as { id: string };
    return { id: row.id, email: identity.email };
  }
  private pruneSessions(now: number) {
    const expired = this.db
      .prepare(
        "SELECT token_hash FROM sessions WHERE touched_at<=? OR created_at<=?",
      )
      .all(now - IDLE_MS, now - ABSOLUTE_MS) as { token_hash: string }[];
    for (const row of expired) this.sessionEmail.delete(row.token_hash);
    this.db
      .prepare("DELETE FROM sessions WHERE touched_at<=? OR created_at<=?")
      .run(now - IDLE_MS, now - ABSOLUTE_MS);
  }
  createSession(user: User, now: number): { token: string; csrfToken: string } {
    this.pruneSessions(now);
    const token = randomBytes(32).toString("base64url"),
      csrfToken = randomBytes(32).toString("base64url");
    this.db
      .prepare("INSERT INTO sessions VALUES(?,?,?,?,?)")
      .run(hash(token), user.id, csrfToken, now, now);
    this.sessionEmail.set(hash(token), user.email);
    return { token, csrfToken };
  }
  session(token: string | undefined, now: number): Session | undefined {
    this.pruneSessions(now);
    if (!token || token.length > 128) return;
    const email = this.sessionEmail.get(hash(token));
    if (!email) {
      this.deleteSession(token);
      return;
    }
    const row = this.db
      .prepare(
        "SELECT users.id,sessions.csrf,sessions.created_at,sessions.touched_at FROM sessions JOIN users ON users.id=sessions.user_id WHERE token_hash=?",
      )
      .get(hash(token)) as
      | {
          id: string;
          email: string;
          csrf: string;
          created_at: number;
          touched_at: number;
        }
      | undefined;
    if (!row) return;
    if (
      now - row.touched_at >= IDLE_MS ||
      now - row.created_at >= ABSOLUTE_MS
    ) {
      this.deleteSession(token);
      return;
    }
    this.db
      .prepare("UPDATE sessions SET touched_at=? WHERE token_hash=?")
      .run(now, hash(token));
    return { user: { id: row.id, email }, csrfToken: row.csrf };
  }
  deleteSession(token: string | undefined) {
    if (token) {
      this.sessionEmail.delete(hash(token));
      this.db
        .prepare("DELETE FROM sessions WHERE token_hash=?")
        .run(hash(token));
    }
  }
  list(owner: string): Saved[] {
    return (
      this.db
        .prepare(
          "SELECT * FROM scenarios WHERE owner_id=? ORDER BY updated_at DESC,id",
        )
        .all(owner) as Row[]
    ).map((row) => this.open(row));
  }
  get(owner: string, id: string): Saved {
    const row = this.db
      .prepare("SELECT * FROM scenarios WHERE owner_id=? AND id=?")
      .get(owner, id) as Row | undefined;
    if (!row) throw new StoreError("not_found");
    return this.open(row);
  }
  private transaction<T>(fn: () => T): T {
    this.db.exec("BEGIN IMMEDIATE");
    try {
      const result = fn();
      this.db.exec("COMMIT");
      return result;
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
  }
  create(owner: string, input: ScenarioInput, now: number): Saved {
    return this.transaction(() => {
      const count = this.db
        .prepare("SELECT COUNT(*) AS n FROM scenarios WHERE owner_id=?")
        .get(owner) as { n: number };
      if (count.n >= 50) throw new StoreError("storage_limit");
      const id = randomUUID(),
        stamp = new Date(now).toISOString();
      this.db
        .prepare("INSERT INTO scenarios VALUES(?,?,?,?,?,?)")
        .run(id, owner, 1, stamp, stamp, this.seal(input, id, owner));
      return { id, version: 1, createdAt: stamp, updatedAt: stamp, input };
    });
  }
  update(
    owner: string,
    id: string,
    input: ScenarioInput,
    version: number,
    now: number,
  ): Saved {
    return this.transaction(() => {
      const original = this.get(owner, id);
      if (original.version !== version) throw new StoreError("conflict");
      const stamp = new Date(now).toISOString();
      const result = this.db
        .prepare(
          "UPDATE scenarios SET payload=?,version=version+1,updated_at=? WHERE owner_id=? AND id=? AND version=?",
        )
        .run(this.seal(input, id, owner), stamp, owner, id, version);
      if (result.changes !== 1) throw new StoreError("conflict");
      return { ...original, input, version: version + 1, updatedAt: stamp };
    });
  }
  duplicate(owner: string, id: string, now: number): Saved {
    return this.create(owner, this.get(owner, id).input, now);
  }
  delete(owner: string, id: string) {
    const result = this.db
      .prepare("DELETE FROM scenarios WHERE owner_id=? AND id=?")
      .run(owner, id);
    if (result.changes !== 1) throw new StoreError("not_found");
  }
  deleteAll(owner: string) {
    this.db.prepare("DELETE FROM scenarios WHERE owner_id=?").run(owner);
  }
}
