---
id: D05
title: Design system draft (tokens, components, riding-screen rules)
assignee: ogv-sol
parents: [D01]
priority: 80
max_runtime: 2h
---
# D05 · Design system draft

## Goal
`docs/native-app/DESIGN-SYSTEM.md` plus `design/tokens/tokens.json`: the vocabulary every screen card builds from. It stays look-neutral where the G1 choice will decide, so values are given per direction where they differ.

## Contents
- **Color tokens** (HSL): roles, not hues: `bg`, `surface`, `surfaceRaised`, `text`, `textMuted`, `accent`, `routeSelected`, `routeAlt`, `paved`, `unpaved`, `unknown`, `danger`, `warning`, `success`, `evidenceMeasured`, `evidenceInferred`, `evidenceUnknown`. Each has day, night and sun-high-contrast values, per look direction A, B and C.
- **Type scale:**
  - roles `display`, `numeral` (tabular), `title`, `body`, `caption`, `rideDistance`, `rideRoad`;
  - with Dynamic Type mapping, and the riding-screen cap (what stops growing at large sizes and why).
- **Spacing and shape:** a 4-pt grid, radii, elevation, sheet detent heights.
- **Components** (inventory with states): Button (primary, secondary, quiet, glove), IconButton, Chip (evidence), Card (route), SheetHeader, ToggleRow, SegmentedControl, Stat, Banner (info, warn, error), Toast, EmptyState, ListRow, SearchField, MapPin (start, end, stop, place), ManeuverBanner, TripProgressStrip.
- **Motion:** durations and curves, and the reduce-motion substitutes.
- **Icons:** SF Symbols names per concept; custom glyphs needed (curvy, gravel), described but not drawn.
- **Riding-screen rules** restated as testable numbers.

## Acceptance checks
- [ ] Every SPEC §4 screen can be built from the listed components. Include a table mapping screen to components.
- [ ] `tokens.json` validates against a small JSON schema committed beside it.
