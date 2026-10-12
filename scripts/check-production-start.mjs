/** Real entrypoint smoke check. Uses only Node built-ins, so it also runs after
 * npm ci --omit=dev. All configuration is synthetic; only discovery is mocked.
 * Usage: node scripts/check-production-start.mjs [runtime-directory]
 */
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { createServer } from "node:net";
import { networkInterfaces, tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { setTimeout as delay } from "node:timers/promises";

const here = dirname(fileURLToPath(import.meta.url));
const fixture = resolve(here, "../test/server/fixtures/google-discovery.mjs");

async function freePort() {
  const server = createServer();
  server.listen(0, "0.0.0.0");
  await once(server, "listening");
  const port = server.address().port;
  await new Promise((done) => server.close(done));
  return port;
}

async function stop(child, exited) {
  if (child.exitCode !== null || child.signalCode !== null) return;
  child.kill("SIGTERM");
  const timer = setTimeout(() => child.kill("SIGKILL"), 2000);
  try {
    await exited;
  } finally {
    clearTimeout(timer);
  }
}

export async function checkProductionStart(runtimeDirectory = process.cwd()) {
  const runtime = resolve(runtimeDirectory);
  const manifest = JSON.parse(
    await readFile(join(runtime, "package.json"), "utf8"),
  );
  const command = manifest.scripts.start;
  assert.match(
    command,
    /^node(?: [A-Za-z0-9_./=-]+)+$/,
    "start must be a direct node command without shell syntax",
  );
  const [, ...startArguments] = command.split(" ");
  assert.deepEqual(
    startArguments,
    ["--env-file-if-exists=.env", "--import", "tsx", "src/server/main.ts"],
    "review smoke coverage whenever the production start command changes",
  );
  await assert.rejects(
    stat(join(runtime, ".env")),
    { code: "ENOENT" },
    "run smoke checks in a clean runtime without a real .env file",
  );
  const builtHtml = await readFile(join(runtime, "dist/index.html"), "utf8");
  const scratch = await mkdtemp(join(tmpdir(), "life-plan-start-"));
  const external = Object.values(networkInterfaces())
    .flat()
    .find(
      (address) => address && address.family === "IPv4" && !address.internal,
    )?.address;
  const report = {
    testedHosts: [],
    nonLoopback: external ? "verified" : "unavailable",
  };
  try {
    for (const host of [undefined, "127.0.0.1", "0.0.0.0", "invalid-host"]) {
      const port = await freePort();
      const databasePath = join(scratch, host ?? "default", "private.sqlite");
      const env = {
        PATH: process.env.PATH,
        NODE_ENV: "production",
        APP_ORIGIN: "https://startup.example.test",
        GOOGLE_CLIENT_ID: "synthetic-startup-client",
        GOOGLE_CLIENT_SECRET: "synthetic-startup-secret",
        DATA_ENCRYPTION_KEY: "12".repeat(32),
        DATABASE_PATH: databasePath,
        PORT: String(port),
        ...(host === undefined ? {} : { HOST: host }),
      };
      const child = spawn(
        process.execPath,
        ["--import", pathToFileURL(fixture).href, ...startArguments],
        { cwd: runtime, env, stdio: ["ignore", "pipe", "pipe"] },
      );
      let output = "";
      child.stdout.on("data", (chunk) => {
        output += chunk;
      });
      child.stderr.on("data", (chunk) => {
        output += chunk;
      });
      const exited = once(child, "exit");
      try {
        if (host === "invalid-host") {
          const timeout = setTimeout(() => child.kill("SIGKILL"), 5000);
          try {
            const [code] = await exited;
            assert.equal(
              code,
              1,
              "invalid HOST must fail closed before listening",
            );
            assert.match(output, /Startup failed/);
            await assert.rejects(stat(databasePath), { code: "ENOENT" });
          } finally {
            clearTimeout(timeout);
          }
          continue;
        }
        const base = `http://127.0.0.1:${port}`;
        let ready = false;
        for (let attempt = 0; attempt < 100; attempt++) {
          assert.equal(
            child.exitCode,
            null,
            "entrypoint exited before readiness",
          );
          try {
            const response = await fetch(`${base}/api/session`, {
              signal: AbortSignal.timeout(300),
            });
            if (response.status === 401) {
              ready = true;
              break;
            }
          } catch {
            /* Retry only during bounded startup. */
          }
          await delay(50);
        }
        assert.ok(
          ready,
          "actual production entrypoint must listen on configured PORT",
        );
        const page = await fetch(`${base}/`, {
          signal: AbortSignal.timeout(2000),
        });
        assert.equal(
          page.status,
          200,
          "production entrypoint must serve the built frontend",
        );
        assert.match(page.headers.get("content-type"), /text\/html/);
        assert.equal(await page.text(), builtHtml);
        const response = await fetch(`${base}/api/scenarios`, {
          signal: AbortSignal.timeout(2000),
        });
        assert.equal(response.status, 401);
        assert.deepEqual(await response.json(), { error: "unauthorized" });
        assert.equal(response.headers.get("cache-control"), "no-store");
        assert.match(response.headers.get("set-cookie"), /; Secure/i);
        assert.match(response.headers.get("set-cookie"), /; HttpOnly/i);
        const auth = await fetch(`${base}/auth/google`, {
          redirect: "manual",
          signal: AbortSignal.timeout(2000),
        });
        assert.equal(auth.status, 302);
        const destination = new URL(auth.headers.get("location"));
        assert.equal(destination.origin, "https://accounts.google.com");
        assert.equal(destination.pathname, "/o/oauth2/v2/auth");
        assert.equal(
          destination.searchParams.get("redirect_uri"),
          `${env.APP_ORIGIN}/auth/callback`,
        );
        assert.equal(
          destination.searchParams.get("client_id"),
          env.GOOGLE_CLIENT_ID,
        );
        assert.equal(
          destination.searchParams.get("code_challenge_method"),
          "S256",
        );
        for (const parameter of ["state", "nonce", "code_challenge"]) {
          assert.match(
            destination.searchParams.get(parameter),
            /^[A-Za-z0-9_-]{43}$/,
          );
        }
        assert.equal(destination.searchParams.has("client_secret"), false);
        assert.equal(destination.searchParams.has("code_verifier"), false);
        assert.match(auth.headers.get("set-cookie"), /; Secure/i);
        assert.match(auth.headers.get("set-cookie"), /; HttpOnly/i);
        assert.match(auth.headers.get("set-cookie"), /; SameSite=Lax/i);
        const second = await fetch(`${base}/auth/google`, {
          signal: AbortSignal.timeout(2000),
          redirect: "manual",
        });
        assert.notEqual(
          new URL(second.headers.get("location")).searchParams.get("state"),
          destination.searchParams.get("state"),
        );
        assert.equal(
          (await readFile(databasePath)).subarray(0, 16).toString(),
          "SQLite format 3\0",
        );
        assert.equal((await stat(databasePath)).mode & 0o777, 0o600);
        if (external) {
          if (host === "0.0.0.0") {
            const publicInterface = await fetch(
              `http://${external}:${port}/api/scenarios`,
              { signal: AbortSignal.timeout(1000) },
            );
            assert.equal(
              publicInterface.status,
              401,
              "wildcard HOST must serve non-loopback interface without bypassing authentication",
            );
            assert.deepEqual(await publicInterface.json(), {
              error: "unauthorized",
            });
          } else {
            await assert.rejects(
              fetch(`http://${external}:${port}/api/session`, {
                signal: AbortSignal.timeout(1000),
              }),
            );
          }
        }
        report.testedHosts.push(host ?? "default-loopback");
      } finally {
        await stop(child, exited);
        assert.ok(
          !output.includes(env.GOOGLE_CLIENT_SECRET),
          "startup must not log client secret",
        );
        assert.ok(
          !output.includes(env.DATA_ENCRYPTION_KEY),
          "startup must not log encryption key",
        );
      }
    }
    return report;
  } finally {
    await rm(scratch, { recursive: true, force: true });
  }
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  console.log(JSON.stringify(await checkProductionStart(process.argv[2])));
}
