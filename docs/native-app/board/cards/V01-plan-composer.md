---
id: V01
title: Plan composer: loop, ride style, stops, map editing
assignee: ogv-builder
parents: [G2]
priority: 70
max_runtime: 3h
---
# V01 · Full composer

## Read first
SPEC §4.1 (all of it), §2, §10. DESIGN-SYSTEM.md components: SearchField, SegmentedControl, ToggleRow, Chip, Button.

## Build
- **Shape switch:** To a destination / Loop. Loop shows the ride-time picker (1–6 h, 30 min steps) and hides destination pins on the map.
- **Ride style panel:** Roads, Surface, Avoid highways, Avoid tolls. It persists the last choice and shows the one-line summary on peek.
- **Stops:** add (search or long-press), remove, reorder with drag handles and the VoiceOver actions "Move up/down". Up to 8.
- **Map editing:** long-press menu (Start here, Go here, Add stop), draggable pins, reverse-geocoded names. A label is dropped when its pin is dragged; there's a name cache keyed by rounded coordinate.
- The request maps every option to `routePlan` parameters exactly as the web planner does (see `src/` composer and route-plan types). Reference the web code in the PR.
- Every SPEC §4.1 state with its copy.

## Acceptance checks
- [ ] `mac-gate <branch> --snapshots --ui --maestro` passes. Snapshots of: loop mode, style panel half sheet, 3 stops, long-press menu, location denied.
- [ ] Unit tests: request mapping for every style combination (table-driven), stop reorder, loop hides destination.
- [ ] Maestro `plan-composer.yaml` builds a loop with 2 h, Curvy and Dirt OK, and gets candidates.
