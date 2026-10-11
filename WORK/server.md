# Server implementation evidence — issues #5–9

Implemented Google OIDC, server sessions, owner-scoped SQLite persistence and protected CRUD. `src/server/oidc.ts` and its cryptographic tests were delegated to the OIDC subagent. No live Google login, credentials, cloud resources or deployment were created.

## TDD

- API suite first failed on missing `src/server/app.js`, then passed 9 initial session/CRUD tests.
- OIDC suite first failed on missing adapter, then passed 14 tests using real generated RSA signatures with mocked Google discovery/token/JWKS responses. Rejects forged signatures, wrong issuer/audience/expiry/nonce/state, missing token, unverified email, cancellation and callback substitution. openid-client non-repudiation checks are explicitly enabled; relying on TLS alone would not test the required JWT signature validation.
- Configuration suite failed on missing module, then passed 3 tests.
- Cross-account stale-tab regression failed `expected 200 to be 401`, then passed after adding required `X-Session-User` binding on every scenario request and logout.
- No-persist-email regression failed the database byte scan, then passed after removing email from the user schema and holding display email only in session memory. Restart requires login again; scenarios persist by stable issuer/sub identity.
- Final server command: `npx --no-install vitest run test/server`: **4 files, 36 tests passed**. Covers cross-device persistence, optimistic conflict, all owner routes, unauthenticated mutations, CSRF/Origin, idle/absolute expiry, login replay, body/count/rate limits, cookie flags/session-token hashes, financial encryption and ciphertext swapping/tampering. Independent-review follow-up explicitly verifies existing-cookie login rotation invalidates the old session and same-owner cross-scenario ciphertext swapping fails authentication. The on-disk persistence test uses disposable files under OS temp and removes only that generated fixture directory.

## Runtime configuration

`npm run build`, then provide `APP_ORIGIN`, `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `DATA_ENCRYPTION_KEY` (64 hexadecimal characters representing an independently provisioned 32-byte key), `DATABASE_PATH` (absolute path) and optionally `PORT` (default 3000). `npm start` invokes `src/server/main.ts`. No defaults create credentials, keys or a test identity. Development permits HTTP only on localhost/127.0.0.1 with explicit `NODE_ENV=development`; all other modes require an exact HTTPS origin. Register `${APP_ORIGIN}/auth/callback` in separately authorized Google configuration. No configuration was created during implementation.

The server binds loopback. An operator-managed HTTPS reverse proxy must strip/redact authentication callback query strings and suppress financial request bodies, tokens, cookies and user identifiers in access/error logging. Forwarded headers are not trusted. Consequently login/API rate limits apply to the observed connection IP; a reverse proxy may share its quota across users. Default limits are login 30/15 minutes, API 180/minute, 256KiB JSON and 50 scenarios per owner. This conservative single-instance MVP requires an operator decision on production proxy quotas before release.

SQLite uses permission-restricted creation (umask 077, file mode 0600) and owner-scoped prepared SQL. Financial payloads use AES-256-GCM with fresh IV and owner/scenario authenticated context. Sessions persist only a token hash, internal owner ID, CSRF and timestamps; raw Google tokens never persist. Google display email stays in process memory only, respecting MVP privacy rules; no email appears in the DB byte-scan fixture. Server restarts invalidate sessions but preserve scenarios. The DB volume/backups and the encryption key must be separately protected; backup retention/deletion replay and key recovery are deployment prerequisites, not configured here.

## API contract

- `GET /api/session` → `{user:{id,email},csrfToken}`; establishes client identity context only.
- All `/api/scenarios` requests and `POST /auth/logout` require `X-Session-User` equal to the UI session's internal user ID. A stale/missing account header returns `401 identity_changed` without destroying a newer session cookie.
- Mutations additionally require exact `Origin: APP_ORIGIN` and `X-CSRF-Token` from `/api/session`.
- List → `{scenarios:[Saved]}`. Get/create/update/duplicate → bare `Saved={id,version,createdAt,updatedAt,input}`. Create body `{input}`; update `{input,version}`. Delete routes and logout return 204.
- Errors are fixed codes, never exception detail or echoed financial input. Validation includes paths and static constraint messages. Owner-mismatched IDs behave as nonexistent IDs.

Remaining runtime limits: single-process SQLite; login state and display email are memory-only; no live-provider acceptance test without separately authorized OAuth credentials; no deployment or backup policy approval represented by passing mocked tests.
