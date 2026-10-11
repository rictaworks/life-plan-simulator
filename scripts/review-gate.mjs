import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import {
  readFileSync,
  readdirSync,
  existsSync,
  mkdirSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";

function files(path) {
  return readdirSync(path, { withFileTypes: true }).flatMap((entry) => {
    if (
      [
        "node_modules",
        ".git",
        "dist",
        "test-results",
        "playwright-report",
        ".review-receipts",
        ".npm-cache",
      ].includes(entry.name)
    )
      return [];
    const name = join(path, entry.name);
    if (entry.isDirectory()) return files(name);
    if (entry.name.startsWith(".env") && entry.name !== ".env.example")
      return [];
    if (/\.(sqlite|db)(-|$)/.test(entry.name)) return [];
    return [name];
  });
}
function digest() {
  const hash = createHash("sha256");
  for (const path of files(".").sort()) {
    const bytes = readFileSync(path);
    hash.update(JSON.stringify([path, bytes.length])).update(bytes);
  }
  return hash.digest("hex");
}
function main() {
  const [mode, phase] = process.argv.slice(2);
  if (
    !["security", "reviewer", "pr-checker"].includes(phase) ||
    !["record", "check"].includes(mode)
  )
    throw new Error(
      "Usage: review-gate.mjs record|check security|reviewer|pr-checker",
    );
  const filename = `.review-receipts/${phase}.json`;
  if (mode === "record") {
    if (!process.env.REVIEW_EVIDENCE)
      throw new Error(
        "REVIEW_EVIDENCE must identify completed independent review evidence",
      );
    mkdirSync(".review-receipts", { recursive: true });
    writeFileSync(
      filename,
      JSON.stringify({
        digest: digest(),
        evidence: process.env.REVIEW_EVIDENCE,
        at: new Date().toISOString(),
      }),
    );
  } else if (
    !existsSync(filename) ||
    JSON.parse(readFileSync(filename, "utf8")).digest !== digest()
  )
    throw new Error(
      `Current files require ${phase} review; record only after the review is complete.`,
    );
  if (mode === "check") {
    // A reviewed worktree must also be exactly the index that will be committed.
    execFileSync("git", ["diff", "--quiet", "--"], { stdio: "pipe" });
    const tracked = execFileSync("git", ["ls-files", "-z"], {
      encoding: "utf8",
    })
      .split("\0")
      .filter(Boolean);
    if (
      tracked.some(
        (path) =>
          (/(^|\/)\.env($|\.)/.test(path) && !path.endsWith(".env.example")) ||
          /\.(sqlite|db)(-|$)/.test(path) ||
          /(^|\/)(master\.key|id_rsa|id_ed25519)$/.test(path),
      )
    ) {
      throw new Error(
        "Sensitive runtime files must not be present in the Git index.",
      );
    }
  }
}
main();
