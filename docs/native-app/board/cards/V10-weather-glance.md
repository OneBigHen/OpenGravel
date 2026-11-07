---
id: V10
title: Weather glance on route cards
assignee: ogv-builder
parents: [V02]
priority: 50
max_runtime: 90m
---
# V10 · Weather glance

## Build
- Per SPEC §4.8: one line on each route card for the ride window, and a tap opens an hourly strip.
- Phrase rules as a pure function with table tests: "Dry all ride", "Rain likely after 3 PM" (probability ≥ 50 %), "Showers possible" (30–49 %), "Below 40 °F early", "Strong wind after 2 PM" (≥ 25 mph gusts).
- Hidden on failure.

## Acceptance checks
- [ ] Table tests for the phrasing.
- [ ] Snapshot of a card with a weather line and of the hourly strip. `mac-gate --snapshots` passes.
