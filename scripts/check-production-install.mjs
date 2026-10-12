// Isolate module resolution from this checkout: verify a genuine omit-dev install.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { access, cp, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { checkProductionStart } from "./check-production-start.mjs";

const source = resolve(import.meta.dirname, "..");
const runtime = await mkdtemp(join(tmpdir(), "life-plan-production-install-"));
try {
  for (const path of [
    "package.json",
    "package-lock.json",
    "tsconfig.json",
    "src",
    "dist",
  ]) {
    await cp(join(source, path), join(runtime, path), { recursive: true });
  }
  const install = spawnSync(
    "npm",
    ["ci", "--omit=dev", "--cache", join(tmpdir(), "life-plan-npm-cache")],
    { cwd: runtime, timeout: 120_000, stdio: "inherit" },
  );
  assert.equal(
    install.status,
    0,
    "isolated production dependency install failed",
  );
  await access(join(runtime, "node_modules/tsx/package.json"));
  for (const packageName of ["vitest", "vite", "typescript"]) {
    await assert.rejects(access(join(runtime, "node_modules", packageName)), {
      code: "ENOENT",
    });
  }
  console.log(JSON.stringify(await checkProductionStart(runtime)));
} finally {
  await rm(runtime, { recursive: true, force: true });
}
