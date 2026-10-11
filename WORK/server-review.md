# Independent server security and normal review

Reviewed `src/server/**`, `test/server/**`, approved requirements, architecture/environment contracts, and `/workspace/rules/OWASP10.md`, `QC10.md`, `CC.md`. The reviewer authored the domain engine, not these server modules. No unavailable named skill or external legal review is claimed.

## Verdict

No blocking server code finding in the reviewed implementation. This is approval of the server code for integration, conditional on whole-repository tests/CI and final PR checks. It is not authorization to deploy or a claim that live Google authentication passed.

## Security and correctness evidence

- **Owner authorization (A01):** Every scenario query/mutation is scoped to authenticated internal owner ID. List/get/create/update/delete/delete-all/duplicate paths do not accept a client owner. Missing and foreign IDs share not-found responses. No independent nested case/event resource bypass exists. Reads and writes require the session-bound user header, preventing stale-account UI requests from silently accessing a new account.
- **Authentication (A07):** Google issuer is fixed. `openid-client` discovery enables non-repudiation signature checks; real RSA-signed mocked responses test valid identity, wrong signature/issuer/audience/expiry/nonce/state, missing token, unverified email, cancellation and redirect mismatch. PKCE S256, nonce and state are tied to a ten-minute one-use browser-cookie transaction. Google subject plus issuer, not email, identifies users.
- **Sessions/CSRF:** Random 256-bit session IDs, hashed persistence, HttpOnly/SameSite=Lax and production Secure cookies; 30-minute idle and 12-hour absolute expiry are server-enforced. Logout deletes the server session. All mutations require exact Origin and timing-safe CSRF token equality. No auth bypass is exposed in production config; mock providers are injected only by tests.
- **Encryption/integrity (A02/A08):** AES-256-GCM uses fresh 96-bit IVs and owner/scenario AAD. Financial names/events/amounts are inside encrypted payloads. Raw session IDs, OAuth tokens and email are not written to the database. Display email is process-memory-only; restart deliberately expires sessions while stable Google identity preserves scenarios. Ciphertext corruption produces a generic typed error; schema validation runs again when decrypting saved input.
- **Injection (A03):** SQL uses prepared placeholders. Strict shared Zod schema validates API inputs, schema versions and unknown fields. No financial data or provider exceptions are rendered into log output. Server response errors contain controlled codes; validation issues contain only paths and schema messages.
- **Limits/design/configuration (A04/A05):** Bounded JSON size, per-IP login/API quotas, 50-scenario owner limit, 1000 live login transaction limit and transaction pruning. Optimistic locking and owner checks execute inside SQLite transactions. Runtime configuration fails closed on missing secrets, insecure nonlocal origins, invalid keys/database paths/ports. Server binds loopback; no trust-proxy bypass. DB file creation uses restrictive permissions.
- **Components (A06):** Exact locked dependency versions and official-registry integrity were reviewed in foundation review. Runtime dependency audit reported zero known vulnerabilities. This is not a transitive source audit.
- **Privacy/observability (A09):** No request/access logging, analytics or external AI. Financial data is sent only to own authenticated API. Generic startup failure avoids credential-bearing exceptions. Production proxy log redaction, counts-only monitoring and storage/backup protection remain operator responsibilities.
- **SSRF (A10):** OAuth issuer is a constant; no request parameter controls discovery or token destination. Callback URI must match configured origin/path. No other remote-fetch surface exists in reviewed server source.

## Executed verification

`npm test -- test/server`, Node 24.19.0 / Vitest 5.0.3, 2026-10-11 23:10:45 UTC: **4 files, 34 tests passed**, 930 ms. After the requested coverage additions, independent rerun on 2026-10-11 23:12 UTC passed **4 files, 36 tests**. Includes durable database reopen/deletion, absence of financial plaintext/email/raw session token, owner isolation, same-email different-subject isolation, cross-device reads/conflicts, stale identity, cookie security, auth replay/failures, quotas/body limits and cryptographic OIDC negatives.

## Nonblocking test follow-ups and deployment limits

Both requested test follow-ups are resolved: same-browser login rotation rejects the previous cookie, and ciphertext swapping between different IDs of the same owner fails while the original remains readable. The reviewer read both new regression tests and independently reran the full server suite. No server review findings remain open.

The loopback reverse proxy means observed-IP rate limits can be shared across users. This behavior is documented in WORK/server.md and requires an operator quota decision before release. Single-process SQLite, ephemeral login transactions/email, provider configuration, HTTPS, key/backup handling and retention/deletion-replay policies remain explicit runtime limits.

QC review here covers API error behavior and configuration only; UI accessibility/mobile/performance are outside this server pass. CC items requiring actual operator identity, privacy/terms publication or legal review are release work, not asserted complete. No paid service, production data or persistent credential was used by these tests.
