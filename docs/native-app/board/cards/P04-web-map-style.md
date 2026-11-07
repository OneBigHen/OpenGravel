---
id: P04
title: Web planner uses the OpenGravel map style
assignee: ogv-builder
parents: [G3]
priority: 40
max_runtime: 2h
---
# P04 · Same map on the laptop

## Build
- Add an `opengravel` basemap option in `src/infrastructure/map/basemap.ts` loading the same style JSON (served beside the tiles), and make it the production default. Keep `openfreemap`, `osm` and `empty` as fallbacks. Tests keep `empty`.
- Ensure the attribution is shown.

## Acceptance checks
- [ ] `npm run lint && npm run typecheck && npm test && npm run build` pass. Screenshots of the planner at 1440×900 and 390×844 with the new style.
- [ ] The critical e2e suite is unchanged (it still uses `empty`).
