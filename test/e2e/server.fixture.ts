// Test-only composition: production main.ts never imports this file.
import express from "express";
import { randomBytes } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import { resolve } from "node:path";
import { createApp } from "../../src/server/app";
import { Store } from "../../src/server/store";

function start() {
  const db = new DatabaseSync(":memory:");
  const origin = "http://127.0.0.1:4174";
  const app = createApp({
    store: new Store(db, randomBytes(32)),
    origin,
    production: false,
    provider: {
      authorization(transaction) {
        const url = new URL("/auth/callback", origin);
        url.searchParams.set("state", transaction.state);
        url.searchParams.set("code", "fixture-only");
        return url;
      },
      async callback() {
        return {
          issuer: "https://accounts.google.com",
          subject: "browser-fixture",
          email: "browser@example.test",
        };
      },
    },
  });
  app.use(express.static(resolve("dist")));
  const server = app.listen(4174, "127.0.0.1");
  function stop() {
    server.close(() => {
      db.close();
      process.exit(0);
    });
  }
  process.once("SIGTERM", stop);
  process.once("SIGINT", stop);
}
start();
