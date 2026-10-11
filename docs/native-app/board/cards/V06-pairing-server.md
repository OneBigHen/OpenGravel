---
id: V06
title: Server: device pairing and ride inbox endpoints
assignee: ogv-builder
parents: [F06]
priority: 70
max_runtime: 3h
---
# V06 · Pairing and inbox (server)

## Read first
SPEC §4.6, ENGINEERING §5, the existing `src/app/api/shares/**` and community storage (SQLite) code. Follow the same storage and rate-limit patterns.

## Build
- `POST /api/devices/pair`: called by the laptop browser. Creates a pairing code (8 chars, no ambiguous characters, valid 10 min, single use) and returns `{code, expiresAt, qrPayload: "opengravel://pair/<code>"}`. The browser keeps a random `laptopToken` it sends as a header.
- `POST /api/devices/pair/{code}`: called by the phone with its random `phoneToken` and a `phoneName`. Creates the pair, returns `{pairId, laptopName}`. Expired or used codes return 410 with a readable error.
- `POST /api/inbox` (laptop): body is a ride (geometry polyline6, stops, ride style, name), sent to all phones paired with that laptop. Limit 2 MB, 60 per hour.
- `GET /api/inbox` (phone) lists pending items. `DELETE /api/inbox/{itemId}` acknowledges one. Items expire after 30 days.
- `DELETE /api/devices/pair/{pairId}` unpairs, from either side.
- Tokens are stored hashed (SHA-256 with server salt). No personal data. Add the table to the existing SQLite store, with a migration.
- Add everything to `contracts/openapi/opengravel-app.yaml` and the contract test (same PR).

## Acceptance checks
- [ ] Vitest covers: the happy path, expired code, reused code, wrong token, inbox size limit, acknowledgement and expiry. `npm test` passes; paste the summary.
- [ ] `npm run lint && npm run typecheck` pass.
