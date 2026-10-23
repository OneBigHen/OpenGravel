---
id: V13
title: Live Activity and Dynamic Island for rides
assignee: ogv-builder
parents: [V11]
priority: 55
max_runtime: 2h
---
# V13 · Lock screen and Dynamic Island

## Read first
SPEC §4.9. The existing `apps/ios/ios/App/App/RideActivityAttributes.swift` and `RideActivityPlugin.swift`; reuse the attributes shape.

## Build
- Widget extension `OpenGravelLiveActivity` (add it to `project.yml`): lock-screen view, compact, minimal and expanded island, using OGDesign tokens.
- Starts with the ride and updates on maneuver change or at most every 5 s (local updates, no push). Ends at arrival or End ride.

## Acceptance checks
- [ ] Simulator screenshots of the lock screen and the expanded island during replay R1.
- [ ] Unit test for the update throttle.
