---
id: P02
title: Performance and battery: measure against the budgets
assignee: ogv-sol
parents: [G3]
priority: 55
max_runtime: 3h
---
# P02 · Budgets

## Read first
SPEC §7.

## Build
- `scripts/perf.sh` (Mac):
  - cold-launch time via `xcrun xctrace` (App Launch template) on the simulator;
  - a memory trace over a 2 h replay at ×8 (Allocations, or `vmmap` sampling);
  - fps during pan via signposts.
- A device battery measurement procedure for the owner (`docs/native-app/PERF.md`): a 60-minute replay on the iPhone with the screen at 70 %, reading battery % at the start and end.
- Fix the top 3 offenders found, each as its own commit with before and after numbers.

## Acceptance checks
- [ ] A table of every SPEC §7 budget with the measured value, pass or fail, and the method.
- [ ] Before and after numbers for each fix.
