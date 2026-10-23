---
id: V12
title: Off route, reroute, and no-signal rejoin guidance
assignee: ogv-sol
parents: [V11]
priority: 70
max_runtime: 3h
---
# V12 · Getting back on the ride

## Read first
SPEC §4.5 (off route and states). F08's SERVER-AUDIT.md item 3 (cheaper reroute path, if any).

## Build
- Off-route detection: 50 m for 5 s, with hysteresis so GPS jitter in a forest doesn't trigger it (tune on R2).
- With signal: reroute via the server with the remaining stops and the original style. Show "Finding a way back…", then the new route.
- No signal or a failed reroute: keep the planned line, draw a rejoin arrow to the nearest point **ahead** on the route (never behind), and show the copy from SPEC §4.5. Voice says "Head back to your route" once.
- Never auto-reroute more than once per 30 s.

## Acceptance checks
- [ ] Replay R3 with the network on: exactly one reroute, and the ride style is kept (request log).
- [ ] Replay R3 with the network off (stubbed API): the rejoin arrow points ahead (screenshot), and there's no reroute spam (timeline log).
- [ ] Unit tests for the nearest-point-ahead geometry, including a loop route that crosses itself.
