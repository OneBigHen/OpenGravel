# Brief: Night terrain basemap (OpenGravel)

This codebase is yours. You are in worktree `/root/Vibe/wt/og-night`, branch `design/night-terrain`. Do not push, do not deploy, do not touch other worktrees.

## Goal
Replace the night map with OpenGravel's own "Night terrain" look: the Mapbox **Outdoors** style (`mapbox://styles/mapbox/outdoors-v12`) repainted dark at load time, so ridges (hillshade), forest, contours and gravel roads stay visible at night. Today it repaints `navigation-night-v1`, which shows almost nothing in the forest.

## Read first
- `.fable/DESIGN-PICKS.md` section 2: the full colour spec table and the checks. Follow it exactly.
- `src/infrastructure/map/night-contrast-style.ts` (the current repaint; keep its shape: pure function, exported palette, no dependencies).
- `src/infrastructure/map/maplibre/host.ts` around line 989 (where the style is fetched and repainted).
- `tests/unit/map/night-contrast-style.test.ts`.
- `tests/fixtures/map/outdoors-v12.json`: the real Outdoors style (148 layers). Use it for layer ids and as a test fixture.

## Do
1. Point `NIGHT_CONTRAST_BASE_STYLE_URL` at `mapbox://styles/mapbox/outdoors-v12`.
2. Rewrite the palette and `repaint` for Outdoors layer ids, per the spec table: land `#0f1512`, landcover/forest/national-park `#15251c`, hillshade layer (it is a `fill` layer named `hillshade` with its own colour expressions: make shadows near `#04070a` and highlights near `#3a4d43`, keep its opacity expressions), contour-line `#4a5c53` at 35% (index lines brighter if the layer distinguishes them via `index` property), water `#0c1c26`, waterway `#1d3a4a`, built-up/landuse `#171c1a`, motorway/trunk `#8e9994`, primary/secondary `#b9c2bd`, minor/street `#7a857f`, unpaved roads `#d6a862` (Outdoors roads carry a `surface` property: `paved`/`unpaved`; tracks are class `track`: dashed per spec), path/trail `#6d7a73`, labels `#dfe6e2` halo `#0b100e`, road labels `#aab4ae`, water labels `#6f9bb3`, POI icons muted. No pure white anywhere (`#fff`, `white`, `hsl(..., 100%)` lightness). Patterns (`fill-pattern`, wetland-pattern, pedestrian pattern) should be dropped or dimmed so nothing bright shows.
3. Unknown surface must never be drawn as paved or gravel: if a road has no `surface` value, use the minor grey, not tan.
4. Keep dropping traffic/incident layers. Keep `turning-feature` drop.
5. Rename nothing public unless needed; if you rename, update every caller (`rg -n "NIGHT_CONTRAST|toNightContrast" src tests`).
6. Update `src/ui/layers/MapLayersPanel.tsx` `LOOK_PREVIEW_STYLE.night` only if it still makes sense (it is a static image preview; leave as is if no hosted equivalent; add a one-line comment).
7. Tests in `tests/unit/map/night-contrast-style.test.ts`: run the repaint over the real fixture and assert: every colour string in the output has lightness ≤ 92% (no pure white); land, forest, hillshade, contour, unpaved colours match the palette; traffic layers gone; a road with no `surface` is not tan; output layer count equals input minus dropped.
8. Update the doc comment at the top of the file to describe Night terrain.

## Pass / fail
- `npx vitest run tests/unit/map` passes.
- `npx tsc --noEmit -p .` has no new errors in files you touched.
- `npm run lint` clean for touched files.
- Commit on `design/night-terrain` with a plain-English message ("Night map: our own dark terrain..."). One commit is fine.
- Fail: changes outside the map files, the test, the fixture and this brief's listed files.

Finish with a 5-line plain summary of what changed and the test result.
