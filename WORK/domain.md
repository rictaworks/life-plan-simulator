# Domain implementation evidence — issues #2, #3, #4

Read the complete approved requirements.md, app-ui/README.md, and SPEC/architecture.md. No executor skill was installed or invoked; this is domain subagent implementation with direct TDD.

## Red → green

- Tests written before source files: `test/domain/domain.test.ts`.
- Actual RED: Node v24.19.0 / Vitest v5.0.3, 2026-10-11 23:05:49 UTC. `vitest run test/domain/domain.test.ts` reported 1 failed suite, `Cannot find module '../../src/domain/schema.js'`; source files did not yet exist.
- Implemented strict Zod validation, pure monthly calculation, and independent case copying.
- Initial GREEN at 23:06:28 UTC: 1 file / 26 tests passed, 322 ms.
- Final domain GREEN at 23:06:57 UTC: 1 file / 28 tests passed, 324 ms. Covers T01–T18, event/reset/calendar boundaries, unsafe integers, strict unknown-field rejection, schema and count bounds, negative rates, max input size, and 100 seeded deterministic conservation scenarios. All acceptance calculations also verify repeated results, conservation, and nonnegative assets.
- Repository-wide `tsc --noEmit` at this stage reports only concurrently missing client/server modules (`App`, `app.js`, `store.js`); no domain diagnostic. Root must run integration typecheck after other agents complete.

## Contract and decisions

`schema.ts`: exports `eventSchema`, `caseSchema`, `scenarioSchema`, `EventInput`, `CaseInput`, `ScenarioInput`, `monthIndex`, `formatMonth`. Strict input validation rejects coercion, unknown fields (including asserted ownership), unknown schema versions, duplicate IDs/replacements, events outside the shared period, invalid calendar months and years beyond 9999. Rates remain percentages on input. Operational identifier limit is 100 ASCII alphanumeric/underscore/hyphen characters; scenario title limit is 80 characters. Case/event limits preserve the specification.

`simulate.ts`: exports `simulate`, `roundYen`, `SimulationResult`, `MonthlyRow`. Returns actual computed rows only; shortfall ends that month. Overflow returns `completed:false`, `reason:'overflow'`, prior safe rows, and no fabricated period-end result. `firstShortfall` is the first deficient row or null. Initial assets are separate from month-end rows. `targetSaving` is the desired normal surplus allocation, never double-counted as another asset. Output is not persisted.

`cases.ts`: `cloneCase(original,newId,name?)` parses a fresh nested object and gives events new local IDs. Caller supplies a fresh case ID and scenario validation enforces uniqueness.

No financial data leaves the pure engine, and there are no log, persistence, analytics, networking or credential operations. No deployment or live Google authentication was tested here.

## Japanese validation follow-up

Root review identified English default Zod messages in the Japanese-only UI. Three regression cases (negative cash, empty numeric input, empty case name) first failed with English messages at 23:13:23 UTC. Configured official installed Zod v4 `z.config(z.locales.ja())` in the shared schema module, keeping all constraints and issue paths unchanged. Domain suite now passes 31 tests; TypeScript passes. Custom existing messages remain Japanese. This locale is shared by browser and server validation.
