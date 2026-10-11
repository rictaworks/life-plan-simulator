# Independent foundation review

Scope: package.json/package-lock.json, .npmrc/.gitignore, TypeScript/Vite/Vitest/Playwright configs, index.html, CI workflow, SPEC/architecture.md, app-ui/README.md, ENV documentation. Source implementation was not reviewed in this pass. No named skill is claimed.

## Result

No blocking normal or security finding in the reviewed foundation. Approval is limited to this foundation snapshot; implementation behavior, successful full CI, and the unresolved design selection require separate review.

## Evidence

- Exact direct dependency versions are pinned; lockfile v3 contains 289 dependency entries, all resolved URLs use `https://registry.npmjs.org/`, and every entry has integrity metadata. No private/credential-bearing dependency URL, Git dependency, or external runtime script in index.html was found. Standard esbuild and optional fsevents install hooks are identified; this is not a package source-code audit.
- Installed environment reports Node 24.19.0 and Vitest 5.0.3. `npm audit --omit=dev --audit-level=high` returned `found 0 vulnerabilities` during this review.
- An independent live registry/latest and GitHub action-commit check could not complete: Node fetch failed `getaddrinfo EAI_AGAIN registry.npmjs.org`, including one retry with network permission. Current-latest versions and upstream commit provenance are therefore not independently confirmed by this review. Root's successful package installation/version-resolution evidence must support those claims.
- CI gives only `contents: read`, uses full 40-character commit pins for checkout/setup-node, has a 15-minute job timeout and command timeouts, and runs install, type/tests/build, Chromium browser tests and runtime dependency audit. There is no deploy job, secret injection, pull_request_target context, write token, or production service access.
- Vite development server binds loopback through the npm script, API/auth proxy targets loopback, and Playwright defaults to loopback. Browser traces/screenshots are disabled, avoiding capture of future real financial/session inputs by default.
- Strict TypeScript and bounded test execution are enabled. .env, database files, test artifacts and node_modules are ignored.
- Architecture and environment docs clearly separate implementation from live Google login/deployment; credentials and encrypted persistent infrastructure remain operator configuration. Owner restriction is not misrepresented as encryption against operators. Unresolved backup retention/deletion restoration and design-selection requirements are accurately documented.
- app-ui is an explicit nonvisual interaction contract, with design choice pending Jev rather than a fabricated approval. No automatic save, analytics or external AI integration is introduced by foundation configuration.

## Nonblocking improvements

1. Align `@types/node` with Node 24 runtime rather than 26 to avoid compiling against APIs absent from the supported runtime.
2. `.npmrc` hardcodes `/workspace/.npm`; this fits this isolated executor but may fail for contributors without writable `/workspace`. Prefer documenting the environment-local cache override or a portable cache for external contributors.
3. Set checkout `persist-credentials: false` as defense in depth; the existing token is already read-only and no CI mutation needs it.

Root should recheck documentation/configuration if the implementation changes the contracts, and require actual CI success before merging.
