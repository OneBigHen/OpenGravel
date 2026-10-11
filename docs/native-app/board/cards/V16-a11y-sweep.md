---
id: V16
title: Accessibility and copy sweep across v1
assignee: ogv-builder
parents: [V01, V02, V03, V04, V05, V08, V09, V10, V11, V12, V13, V14, V15]
priority: 50
max_runtime: 3h
---
# V16 · Accessibility and copy sweep

## Build
- Run `auditCurrentScreen()` on every screen and state reachable by Maestro. Fix every issue.
- VoiceOver walk-through script: `maestro/a11y-walk.yaml` plus a manual checklist in `docs/native-app/A11Y.md`.
- Dynamic Type `.accessibility5` on every screen with no truncated actions.
- Reduce motion: camera cuts instead of flights.
- Copy pass against SPEC §10: list every user-visible string (`Localizable.xcstrings`; English only for now) and fix the ones that break the rules.

## Acceptance checks
- [ ] Accessibility audits pass on all screens (paste the list).
- [ ] A string table diff and before/after screenshots for changed copy.
