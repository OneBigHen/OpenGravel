---
id: P03
title: Ride recovery and crash resilience
assignee: ogv-builder
parents: [G3]
priority: 50
max_runtime: 2h
---
# P03 · Ride recovery and crash resilience

## Build
- Verify that an interrupted recording is saved locally at the documented 30-second cadence and can be resumed within the documented two-hour window.
- Keep ride and location data on the phone. Do not add crash uploads, diagnostics endpoints, or background telemetry.

## Acceptance checks
- [ ] Unit tests cover recording checkpoint recovery and the two-hour resume decision.
- [ ] A simulated interrupted ride restores its route and recording state without a network request.
- [ ] `apps/iphone/scripts/gate.sh --ci` passes.
