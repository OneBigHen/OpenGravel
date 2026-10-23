---
id: F06
title: App↔server OpenAPI contract and server contract test
assignee: ogv-sol
priority: 90
max_runtime: 3h
---
# F06 · The contract

## Read first
ENGINEERING §5. `docs/architecture.md`. The route handlers under `src/app/api/` for the v1 endpoints in ENGINEERING §5 (all except the new `devices` and `inbox`, which V06 adds). Use codegraph if the index exists, otherwise read the handlers and the types they return.

## Goal
`contracts/openapi/opengravel-app.yaml` (OpenAPI 3.1) describes exactly what the server returns today for the v1 endpoints, and a test proves it.

## Build
- The schema, written from the TypeScript types and handler code, never guessed:
  - parameters, request bodies, response bodies and error shapes;
  - unknowns stay nullable or `"unknown"` enums exactly as the server emits them;
  - add `description` fields in plain words;
  - mark fields the app does not need with `x-ogv-app: unused` instead of leaving them out.
- `tests/contracts/app-openapi.test.ts` (Vitest):
  - calls each route handler in-process with the existing fixture modes (`OGV_ROUTE_PLAN_FIXTURE=1`, `OGV_GEOCODE_FIXTURE=1` and the like; add fixture switches only where missing, following the existing pattern);
  - validates each response against the schema with an OpenAPI validator. Use `ajv` with `ajv-formats` if already present; otherwise add `@seriousme/openapi-schema-validator` or a similarly small MIT package and say so.
- `contracts/README.md`: how to change the contract (same-PR rule).

## Acceptance checks
- [ ] `npm test` passes, including the new test. Paste the summary line.
- [ ] Removing a required field from one fixture response makes the test fail with a readable message. Show it, then revert.
- [ ] The schema lints with `npx @redocly/cli lint contracts/openapi/opengravel-app.yaml` with no errors (use npx; don't add it as a dependency).

## Out of scope
Changing any endpoint's behavior. If you find a server bug, describe it in the handoff and do not fix it here.
