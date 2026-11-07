---
id: S02
title: OGMap: MapLibre map with our style, hillshade and route layers
assignee: ogv-sol
parents: [G0, G1]
priority: 85
max_runtime: 4h
---
# S02 · The map

## Read first
SPEC §5, the D02 README (tile URLs), the chosen style in `OGMap/Resources/Styles/`. Ferrostar's MapLibre SwiftUI DSL is used by OpenGravelNavigation; use the same MapLibre version so both share one map stack.

## Build
- `OGMapView` (SwiftUI) wraps the MapLibre view. Use the MapLibre SwiftUI DSL if it covers the needs below; otherwise `UIViewRepresentable` around `MLNMapView`. Justify the choice in the PR. Features:
  - style from bundled JSON, day or night by `OGAppearance`, swapping without reloading tiles where possible;
  - PMTiles sources via `pmtiles://https://...` (MapLibre iOS 6.10 or later);
  - terrain `raster-dem` defined in style JSON (Terrarium encoding) with a hillshade layer. **Check whether MapLibre Native iOS supports 3D terrain in the pinned version.** Report yes or no with evidence, and do not build 3D in this card;
  - an API to set route lines (`[RouteLine]` with selected and alternative styling), pins (start, end, stops, places), rider-layer GeoJSON from `/api/map-layers`, user location puck, and camera (`fit(route:insets:)`, `follow(heading:)`, `free`);
  - map gestures report long-press coordinates and pin drags through closures;
  - attribution control always visible (SPEC §5.1);
  - URLCache configured at 500 MB.
- Performance: no per-frame SwiftUI updates. Diff layer data and update only what changed.
- A demo screen in the Debug Gallery showing a fixture route over Jim Thorpe.

## Acceptance checks
- [ ] `mac-gate <branch> --snapshots --ui` passes. Attach demo screenshots in day and night with hillshade visible.
- [ ] Unit tests cover the layer diffing (adding a route twice does not duplicate sources).
- [ ] With the network link conditioner off, map first render on the simulator is under 1 s with a warm cache. Measure with signposts and paste the numbers.
