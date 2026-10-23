---
id: V05
title: Recording during rides and Resume ride
assignee: ogv-builder
parents: [V04]
priority: 60
max_runtime: 2h
---
# V05 · Recording

## Read first
SPEC §4.4 (recorded), §4.5 (arrival), §6.

## Build
- Every ride records fixes into a `Recording`, flushed every 30 s. On arrival or End ride, show "Save recording" or "Discard" with stats (distance, moving time, elapsed time, max speed).
- Moving time excludes stops under 2 mph lasting more than 10 s.
- Resume: on launch, if an active session exists and is under 2 h old, offer "Resume your ride to *X*?".
- A "Just ride" entry on Plan records with no route (free ride).

## Acceptance checks
- [ ] Replay R1 with recording on gives a saved recording whose distance is within 2 % of the fixture. Unit test plus replay assert.
- [ ] Killing the app mid-replay and relaunching offers Resume (UI test).
