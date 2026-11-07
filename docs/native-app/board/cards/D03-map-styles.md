---
id: D03
title: Three OpenGravel map style candidates with side-by-side renders
assignee: ogv-builder
parents: [D02]
priority: 85
max_runtime: 3h
skills: [frontend-design]
---
# D03 · Map style candidates

## Read first
SPEC §5. D01's PATTERNS.md if it is merged (map items). D02's README for tile URLs and layer names.

## Goal
Three distinct day styles plus one night variant of the leading candidate, rendered at fixed places so the owner can pick at a glance.

## Build
- `design/map-styles/<name>/style.json` (MapLibre style spec v8) for three directions:
  - **A, "Topo calm":** muted land, strong hillshade, warm route;
  - **B, "High contrast sun":** for bright daylight on a handlebar;
  - **C, "Adventure":** richer terrain, earthy palette, gravel very visible.

  Each must:
  - draw paved vs unpaved distinctly at z ≥ 9 (dash or texture, not color alone);
  - use hillshade from the D02 terrain;
  - use quiet labels and fonts from free glyph sets (OpenMapTiles fonts or Protomaps glyphs, hosted beside the tiles);
  - include a sample route line and a sample curvy-roads overlay (use a GeoJSON exported from `/api/map-layers` in fixture or production mode).
- A night variant of whichever candidate you'd recommend.
- **Render:** `tools/map-render/render.mjs` uses Playwright plus MapLibre GL JS (same style spec as native) to render 1170×2532 phone-size PNGs at 6 fixed views:
  1. Jim Thorpe PA z12;
  2. Hawk Mountain z13;
  3. Route 44 PA Wilds z11;
  4. a gravel cluster in Michaux State Forest z13;
  5. Philadelphia z10 (labels and density);
  6. a z8 overview.

  Render each view with each style, plus Mapbox Outdoors and OpenFreeMap Liberty for comparison. Use the web app's existing Mapbox public token from the server env if present; if not, skip Mapbox and say so.
- `design/map-styles/COMPARE.md`: a grid of images per view plus a 3-line rationale per style.

## Acceptance checks
- [ ] 6 views × (3 + night + 2 references) PNGs committed (compressed, each under 600 KB) and shown in COMPARE.md.
- [ ] Unpaved roads are visually distinct from paved in every candidate at view 4 (the reviewer checks the images).
- [ ] Styles load without console errors in the renderer. Paste the log.
