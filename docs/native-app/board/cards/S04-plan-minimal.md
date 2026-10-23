---
id: S04
title: Plan A→B minimal: search, plan, show candidates
assignee: ogv-builder
parents: [S02, S03, F07]
priority: 80
max_runtime: 3h
---
# S04 · Minimal planning

## Read first
SPEC §4.1 (only the start and destination rows plus search), §4.2 (lines plus a simple card list), §10.

## Build
- `Plan` feature: `PlanStore` (`@Observable`) holds start, destination, the candidates and the selection.
- Search field rows using `OpenGravelAPI.geocode` with 300 ms debounce. "Current location" comes first when authorized.
- "Find rides" calls `routePlan` with defaults (Balanced, Mostly paved) and draws candidates via OGMap (selected plus alternatives), fitting the camera with sheet insets.
- A simple candidate list (time, miles); tapping one selects it. The "Ride" button opens Ride with the selected candidate (Ride is a stub until S05).
- Every state in SPEC §4.1 and §4.2 that this card covers, with the exact copy.
- Maestro `maestro/plan-basic.yaml` against the fixture server (`OGV_ROUTE_PLAN_FIXTURE=1`, `OGV_GEOCODE_FIXTURE=1`, served by Next.js on the Mac or a tunnel; document which in `maestro/README.md`).

## Acceptance checks
- [ ] `mac-gate <branch> --snapshots --ui --maestro` passes. Attach screenshots of: empty, search results, 3 candidates on the map, server error.
- [ ] Unit tests for `PlanStore` cover the debounce, cancelling a stale search, and the error mapping.
