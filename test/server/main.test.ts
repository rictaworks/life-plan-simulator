import { cp, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { expect, test } from "vitest";
// The helper deliberately has no dev dependency so a production-only install can
// run exactly the same assertions against the real entrypoint.
// @ts-expect-error Standalone Node verification script has no declaration file.
import { checkProductionStart } from "../../scripts/check-production-start.mjs";

test("real production entrypoint binds configured HOST/PORT and preserves authentication", async () => {
  const runtime = await mkdtemp(join(tmpdir(), "life-plan-test-runtime-"));
  try {
    // Copy an explicit allowlist: a developer's checkout .env is never read,
    // copied, or passed to the child. Build dist before running these tests.
    await Promise.all(
      ["src", "dist", "package.json", "tsconfig.json"].map((entry) =>
        cp(resolve(entry), join(runtime, entry), { recursive: true }),
      ),
    );
    await symlink(
      resolve("node_modules"),
      join(runtime, "node_modules"),
      "dir",
    );
    const report = await checkProductionStart(runtime);
    expect(report.testedHosts).toEqual([
      "default-loopback",
      "127.0.0.1",
      "0.0.0.0",
    ]);
    expect(["verified", "unavailable"]).toContain(report.nonLoopback);

    // The standalone helper must still refuse contaminated explicit runtimes.
    // This synthetic file is created only in disposable storage, never checkout.
    await writeFile(join(runtime, ".env"), "HOST=invalid-synthetic-host\n");
    await expect(checkProductionStart(runtime)).rejects.toThrow(
      "run smoke checks in a clean runtime without a real .env file",
    );
  } finally {
    await rm(runtime, { recursive: true, force: true });
  }
}, 30_000);
