---
id: V14
title: Settings complete: voice, map, units, about, privacy
assignee: ogv-builder
parents: [G2]
priority: 50
max_runtime: 90m
---
# V14 · Settings

## Build
- Everything in SPEC §4.10 not yet live: voice verbosity wired to the S05 voice, map appearance wired to OGMap, units wired through a single `Formatters` in OGCore (miles default).
- Privacy text.
- The hidden server URL setting (5 taps on the version) with validation and a reset button.

## Acceptance checks
- [ ] Switching units changes every distance on Plan, Ride and Rides (UI test).
- [ ] Snapshots of Settings and About. `mac-gate --snapshots --ui` passes.
