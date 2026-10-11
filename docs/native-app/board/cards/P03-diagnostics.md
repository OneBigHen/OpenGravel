---
id: P03
title: Crash and hang diagnostics (MetricKit), privacy-safe
assignee: ogv-builder
parents: [G3]
priority: 50
max_runtime: 2h
---
# P03 · Diagnostics

## Build
- Subscribe to MetricKit. On diagnostic payloads (crash, hang, CPU exception), strip anything location-like and POST them to a new `POST /api/diagnostics` endpoint: contract plus server handler storing the JSON for 30 days, 1 MB limit, 20 per day per install id. The install id is random and resettable in Settings.
- Settings → Privacy: a "Send crash reports" toggle, on by default, with a description.
- A server-side admin read path behind the existing moderator bearer token: `GET /api/diagnostics?since=`.

## Acceptance checks
- [ ] Vitest for the endpoint (limits, auth). `npm test` passes.
- [ ] A unit test proves the payload scrubber removes coordinates from a sample payload.
