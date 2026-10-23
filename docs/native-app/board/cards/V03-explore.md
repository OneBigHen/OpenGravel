---
id: V03
title: Explore: catalog on map and list, filters, detail
assignee: ogv-builder
parents: [G2]
priority: 65
max_runtime: 3h
---
# V03 · Explore

## Read first
SPEC §4.3, §5.2. Endpoints `catalog` and `catalog/{id}`.

## Build
- List in the sheet plus map lines at z ≥ 7, clustered pins below that.
- Filters (distance, length, surface, shape), nearest-first sort, "Clear filters".
- Detail: stats, source and license attribution, photos if present, Plan from this, Save, Export GPX.
- Cache the last catalog response on disk for offline display.

## Acceptance checks
- [ ] Snapshots of: list, filter sheet, detail, empty filter result, offline with cache. `mac-gate --snapshots --ui --maestro` passes with `explore.yaml`.
- [ ] "Plan from this" produces a plan whose request uses the route's checkpoints (unit test).
