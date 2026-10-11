---
id: V02
title: Route choices: comparison cards, evidence chips, Why this ride
assignee: ogv-builder
parents: [V01]
priority: 70
max_runtime: 3h
---
# V02 · Honest route comparison

## Read first
SPEC §4.2, §2.3 (honesty), §10. Repo CLAUDE.md invariants: unknown never becomes paved, safe, open or legal.

## Build
- Paged route cards: name, time, miles, curvy miles, surface mix bar (paved, gravel, unknown, using pattern as well as color), backroad share, evidence chips (measured, inferred, unknown, with text).
- Selecting a card selects its line on the map, and the reverse.
- "Why this ride?" half sheet: named curvy roads, surveyed gravel segments, warnings with source names. Every fact shows its evidence level.
- Save (to RidesStore; V04 may land later, so stub behind a protocol if needed), Share (`shares` endpoint, then the system share sheet), Edit (back to the composer).
- Loading skeletons, "Still working…" after 5 s, and the none, single and error states.

## Acceptance checks
- [ ] Snapshots: 3 cards, a card with unknown surface, the Why sheet, loading, none. `mac-gate --snapshots --ui` passes.
- [ ] A unit test asserts no rendering path turns an `unknown` surface or evidence into "Paved" or a measured style, fed from a fixture with unknowns.
