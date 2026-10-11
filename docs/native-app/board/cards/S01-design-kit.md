---
id: S01
title: OGDesign: tokens, components and Gallery in SwiftUI
assignee: ogv-builder
parents: [G0, G1]
priority: 80
max_runtime: 3h
---
# S01 · Design kit in code

## Read first
DESIGN-SYSTEM.md (final, after G1), `design/tokens/tokens.json`, ENGINEERING §3 and §6.

## Build
- `scripts/gen-tokens.swift`, or a build-time step, turns `tokens.json` into `OGDesign/Generated/Tokens.swift`. Don't hand-copy values. Colors are asset-free `Color` values with day, night and sun variants selected by an `OGAppearance` environment value.
- Fonts: bundle the chosen display font (OFL license file included) and register it. `Font.og(.title)` and friends scale with Dynamic Type through `relativeTo:`. Riding roles cap as DESIGN-SYSTEM.md says.
- Every component in the DESIGN-SYSTEM.md inventory, each in its own file, with every listed state. Public API is small and documented with one doc comment each.
- `Gallery`: a SwiftUI screen listing all components and states. The app shows it only in Debug builds via a hidden Settings entry.
- Snapshot tests: one `assertOGSnapshots` per component state group.

## Acceptance checks
- [ ] `mac-gate <branch> --snapshots --ui` passes. Attach the Gallery screenshots in light, dark and accessibility5.
- [ ] Glove buttons measure at least 60×60 pt (a unit test reads their frame).
- [ ] No component file over 300 lines.
