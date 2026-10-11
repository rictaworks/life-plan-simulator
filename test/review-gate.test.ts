import { describe, it, expect } from "vitest";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { execFileSync, spawnSync } from "node:child_process";

function fixture() {
  const cwd = mkdtempSync(join(tmpdir(), "life-review-gate-"));
  writeFileSync(
    join(cwd, "gate.mjs"),
    readFileSync(resolve("scripts/review-gate.mjs")),
  );
  execFileSync("git", ["init", "--quiet"], { cwd });
  function git(...args: string[]) {
    execFileSync("git", args, { cwd });
  }
  function write(path: string, value: string) {
    writeFileSync(join(cwd, path), value);
  }
  function gate(mode: string) {
    return spawnSync(process.execPath, ["gate.mjs", mode, "security"], {
      cwd,
      env: {
        ...process.env,
        REVIEW_EVIDENCE: "test-only synthetic attestation",
      },
      timeout: 5000,
      encoding: "utf8",
    }).status;
  }
  write("source.ts", "export const value=1;");
  git("add", "gate.mjs", "source.ts");
  return { write, git, gate };
}
describe("review gate protects reviewed content", () => {
  it("rejects changed content and a partially staged reviewed worktree", () => {
    const f = fixture();
    expect(f.gate("record")).toBe(0);
    expect(f.gate("check")).toBe(0);
    f.write("source.ts", "export const value=2;");
    expect(f.gate("check")).not.toBe(0);
    expect(f.gate("record")).toBe(0);
    expect(f.gate("check")).not.toBe(0);
    f.git("add", "source.ts");
    expect(f.gate("check")).toBe(0);
  });
  it("rejects a staged runtime environment file even with an attestation", () => {
    const f = fixture();
    f.write(".env", "TEST_FIXTURE_ONLY=yes");
    f.git("add", ".env");
    expect(f.gate("record")).toBe(0);
    expect(f.gate("check")).not.toBe(0);
  });
});
