---
id: S03
title: App shell: tabs, sheets, settings store, deep links
assignee: ogv-builder
parents: [S01]
priority: 80
max_runtime: 3h
---
# S03 · App shell

## Read first
SPEC §3, §4.10, §6 (pairing data only). ENGINEERING §3 (state rules).

## Build
- `AppEnvironment` (created once in `App`) holds `OpenGravelAPI`, `SettingsStore`, `LocationService`, `RidesStore` (empty for now), `Router`.
- `RootView`:
  - a shared map area behind a bottom sheet with three detents;
  - tabs Plan, Explore and Rides as a custom bottom bar from OGDesign, hidden in Ride;
  - a Settings gear on Plan;
  - Ride as a `fullScreenCover`.

  Placeholder content per tab is fine.
- `SettingsStore`: units, voice on and verbosity, map appearance (auto, day, night), server URL (hidden advanced entry), all via `@AppStorage` keys prefixed `ogv.`.
- Settings screen per SPEC §4.10 (pairing row disabled until V08), with About and licenses: OSM attribution plus each dependency's license text, generated at build time from the package list.
- `Router` with deep links `opengravel://ride/{id}`, `opengravel://pair/{code}`, `opengravel://share/{token}`. Register the URL scheme. Unknown links show a toast, not a crash.
- `LocationService` (OGCore): when-in-use authorization, a stream of `LocationFix`, a simulated mode fed by a GPX file for tests, and a permission-state publisher.
- Maestro flow `maestro/shell.yaml`: switch tabs, open Settings, open the licenses page.

## Acceptance checks
- [ ] `mac-gate <branch> --snapshots --ui --maestro` passes. Attach screenshots of each tab and of Settings.
- [ ] The accessibility audit passes on each tab and on Settings.
- [ ] A deep link test: `xcrun simctl openurl booted opengravel://share/abc` routes to the share handler stub.
