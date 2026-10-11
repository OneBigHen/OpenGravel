---
id: V11
title: Riding screen: our banners, landscape, gloves, heat and battery
assignee: ogv-sol
parents: [G2]
priority: 75
max_runtime: 4h
---
# V11 · The riding screen

## Read first
SPEC §4.5 (entire), §2.1–2.2, §7. DESIGN-SYSTEM.md riding rules. D01's PATTERNS.md riding items. The G2 ride notes.

## Build
- Replace Ferrostar's default views using its SwiftUI customization modifiers (instruction view, progress view, current road name, off-route view, inner grid) with OGDesign components: ManeuverBanner, TripProgressStrip and road-name pill.
- Layouts for portrait and landscape, both first-class. Landscape puts the banner on the left third and keeps the map's look-ahead to the right.
- Camera: heading-up default with a north-up toggle, 45° tilt above 15 mph, flat when stopped, zoom-out on long straights and zoom-in 300 m before turns. Make these parameters in one `RideCameraPolicy` with unit tests.
- Glove targets of at least 60 pt. Overview tap on the bottom strip for 10 s.
- Thermal: observe `ProcessInfo.thermalState`. At `.serious` or above, cap at 30 fps, pause hillshade transitions, and show the one-time notice. Battery under 15 % shows a quiet banner.
- Sun mode: when appearance is Auto and it's daytime, use the sun-high-contrast token set.

## Acceptance checks
- [ ] Replays R1 and R2 pass. Screenshots in portrait and landscape, day and night, at a turn and on a straight.
- [ ] A unit test measures every interactive element at 60 pt or more in both orientations.
- [ ] Simulated thermal state (debug menu) shows the notice and the fps cap (signpost log).
