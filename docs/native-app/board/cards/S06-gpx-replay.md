---
id: S06
title: GPX ride replay harness and fixture rides
assignee: ogv-builder
parents: [S05, F05]
priority: 80
max_runtime: 2h
---
# S06 · GPX replay

## Build
- `apps/iphone/fixtures/gpx/`: three real-ish Pennsylvania rides with timestamps:
  - **R1** "Jim Thorpe loop", 35 mi, curvy;
  - **R2** "Michaux gravel", 25 mi, mixed surface;
  - **R3** "Hawk Mountain with a missed turn", including one deliberate 300 m deviation.

  Generate them from `/api/route-plan` fixture geometry plus a speed profile script `scripts/make-ride-gpx.py`, which you write.
- A UI test target `OpenGravelReplayTests` launches the app with `-ogvReplay R1` and speed ×8:
  - asserts the turn banner changes at least N times;
  - asserts no "Off route" while on R1 and R2;
  - asserts exactly one reroute on R3;
  - asserts arrival is reached.

  It writes a timeline log and 1 screenshot per minute of ride time to `build/screenshots/replay/`.
- Wire `gate.sh --mac --replay`.

## Acceptance checks
- [ ] `mac-gate <branch> --replay` passes all three. Attach the R3 reroute screenshots and the timeline excerpt.
- [ ] The replay takes under 10 min total on the Mac.
