---
id: V09
title: Gas and food along the ride (Plan and Ride)
assignee: ogv-builder
parents: [V02, S05]
priority: 55
max_runtime: 2h
---
# V09 · Places along the ride

## Read first
SPEC §4.7, §4.5 (places while riding). Endpoint `places/along`.

## Build
- Fetch for the selected route (Plan, routes over 40 mi) and the active route (Ride). Categories gas and food. Pins from DESIGN-SYSTEM.md.
- Place card: name, category, miles ahead along the route, detour time if provided, "Add as stop". In Ride this triggers a reroute that keeps the ride style.
- Fail quietly: if the endpoint fails, no pins and no error banner (it's optional, per the repo invariant).

## Acceptance checks
- [ ] Snapshots of Plan with places and of the place card. Replay R1 shows place pins near the route (screenshot).
- [ ] Unit test for "miles ahead" along the polyline.
