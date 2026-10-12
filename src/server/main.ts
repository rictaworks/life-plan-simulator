import { mkdirSync, chmodSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import express from "express";
import { createApp } from "./app.js";
import { loadConfig } from "./config.js";
import { createGoogleProvider } from "./oidc.js";
import { Store } from "./store.js";

// Fail closed. Production has no identity override, test account or generated credentials.
// No access logger is installed: requests contain personal financial inputs or OAuth codes.
try {
  const config = loadConfig();
  const provider = await createGoogleProvider(config);
  process.umask(0o077);
  mkdirSync(dirname(config.databasePath), { recursive: true, mode: 0o700 });
  const db = new DatabaseSync(config.databasePath);
  chmodSync(config.databasePath, 0o600);
  const store = new Store(db, config.key);
  const app = createApp({ ...config, store, provider });
  const dist = resolve("dist");
  app.use(express.static(dist, { etag: false, lastModified: false }));
  app.get("/", (_req, res) => res.sendFile(resolve(dist, "index.html")));
  // The platform/reverse proxy terminates TLS. Exposure requires explicit HOST.
  // Forwarded headers are not trusted; no configurable trust-proxy security bypass.
  const server = app.listen(config.port, config.host);
  const stop = () => {
    server.close(() => {
      db.close();
      process.exit(0);
    });
  };
  process.once("SIGTERM", stop);
  process.once("SIGINT", stop);
} catch {
  // Do not log exceptions: provider/network exceptions may contain credentials or tokens.
  console.error(
    "Startup failed. Check the documented runtime configuration, database permissions, and Google discovery connectivity.",
  );
  process.exitCode = 1;
}
