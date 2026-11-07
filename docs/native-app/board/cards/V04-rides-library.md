---
id: V04
title: Rides library: SwiftData store, GPX import and export
assignee: ogv-builder
parents: [G2]
priority: 70
max_runtime: 3h
---
# V04 · My rides

## Read first
SPEC §4.4, §6.

## Build
- `RidesStore` (OGCore, SwiftData) with the models `SavedRide` and `Recording` (fields per SPEC §6), plus a migration plan from day one (`VersionedSchema` v1).
- The Rides tab with sections Saved and Recorded. "From laptop" is added by V08. Rows with mini map previews: a static snapshot image rendered once with MLNMapSnapshotter and cached.
- Open, rename, delete with a 5 s undo toast.
- GPX import via `fileImporter` (GPX 1.1 tracks and routes; waypoints become stops when there are 8 or fewer), dedupe by content hash ("Already in your rides."), and per-file errors.
- GPX export via `ShareLink` (route as `rte`, recording as `trk`).
- Write GPX parse and serialize in OGCore with tests. No third-party GPX library unless MIT and named in the PR.

## Acceptance checks
- [ ] Round-trip test: import a fixture GPX, export it, and compare geometry within 1 m.
- [ ] Snapshots of: empty, list with 3 rides, rename, import error. `mac-gate --snapshots --ui` passes.
