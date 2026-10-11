---
id: S05
title: Ride: native Ferrostar session on our map, voice, background
assignee: ogv-sol
parents: [S04]
priority: 85
max_runtime: 4h
---
# S05 · Riding, natively

## Read first
SPEC §4.5. The existing `apps/ios/OpenGravelNavigation` sources:
- `OpenGravelNavigationCoordinator`
- `OpenGravelRouteMapper`
- `OpenGravelRouteProvider`
- `OpenGravelStepCatchUp`

Also the Capacitor plugin `apps/ios/ios/App/App/OpenGravelNavigationPlugin.swift`, for how it is driven today. The repo invariant: **one RideSession/navigation lifecycle across web, native and CarPlay.**

## Build
- Drive the existing `OpenGravelNavigation` package from the native app; don't fork its logic. Small API additions are fine (keep the Capacitor plugin compiling), for example accepting an OGCore `RouteCandidate` in place of the plugin payload.
- **Route provider:** Ferrostar `CustomRouteProvider` calling `OpenGravelAPI.routePlan` for reroutes, with the remaining stops and the **original ride style** (SPEC §4.5).
- **Map:** the navigation view uses OGMap's style (day or night) and route styling, not the default Ferrostar style.
- **Voice:** `AVSpeechSynthesizer` through an `AVAudioSession` set to `.playback` with `.duckOthers` and `.allowBluetoothA2DP`. Prompts at the distances in SPEC §4.5, mute toggle.
- **Background:** location updates during a ride (`UIBackgroundModes: location`, `allowsBackgroundLocationUpdates` only while riding), idle timer disabled while riding, re-enabled on end.
- End ride confirmation, and the arrival state with basic stats.
- `RideSessionStore` persists the active session (route, progress) so "Resume ride?" works after relaunch (SPEC §6).

## Acceptance checks
- [ ] On the simulator with a simulated location along a fixture route: turn banner, voice prompts (log lines), arrival. Attach a screen recording or 6 screenshots.
- [ ] A reroute is requested after a simulated deviation and keeps the ride style (unit test on the provider request).
- [ ] The Capacitor shell still builds (`apps/ios` sync and build on the Mac). Paste the tail.
- [ ] `mac-gate <branch> --snapshots --ui` passes.
