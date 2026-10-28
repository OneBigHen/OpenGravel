# Map experience: what's next (dream big)

Written 2026-10-27 after #166 (mobile UX) and design/map-layers (HD terrain, picture layers sheet, solid bottom, conditions pill) shipped. Sources: Codex gpt-6.1-terra review (thread `01a18041-30f0-7891-941e-9d0e33645874`) and Claude's own list. Build this in a fresh session, one wave at a time, deploying each wave with `infra/deploy/release.sh` once its gates are green.

The bar: a rider opens OpenGravel and it looks and feels better than Google Maps, Calimoto and REVER. It stays free to run: Mapbox only within its free tiers (with MapLibre, Mapbox bills per tile request: 200k vector, 750k raster and 50k static images a month), and everything else from free or self-hosted sources.

---

## Wave 1: polish what just shipped (Terra's larger items)

1. **Layers sheet first screen** (Terra #6). Map previews at 80–88px, tighter groups, and the first live-condition row above the fold on an iPhone 15. Header and close stay fixed while the body scrolls.
2. **Quick sets show On / Partial / Off** (Terra #7). Today a partly applied set reads as off. Add an "N active" summary beside Clear all, and show state with a mark as well as colour.
3. **Real 2D / 3D control** (Terra #4). A 2D/3D toggle in the map's button column: 3D eases to about 40°, keeps the rider's own pitch and bearing, and 2D returns to the camera the rider had. Terrain stays at 1.0–1.1×.
4. **Terrain and building truth** (Terra #5 and #11). Check the building filter against real Mapbox Streets and OpenFreeMap tile properties (`extrude`, `underground`, `hide_3d`). The 3D tile shows "Loading terrain", "Terrain unavailable" or "Flat offline". Measure FPS and tile count on the owner's iPhone over Hawk Mountain and Jim Thorpe.
5. **One bottom dock** (Terra #3). The home pills, recent places and tab bar read as one tinted surface at 94–98% with a single top edge, in both themes, respecting the safe area.

## Wave 2: the top bar becomes a ride companion

6. **Route context replaces the chips when a route is open** (Terra #12): `62 mi · 1h 45m · arrive 5:40 · 22 min before dark`. Tapping it opens a ride-conditions sheet.
7. **Weather along the route, not at map centre.** Sample NWS hourly forecasts at about 6 points along the route, each at its ETA. In the sheet, draw a strip under the elevation profile coloured by rain chance and temperature, plus a "Rain from mile 38 around 3 PM" headline. NWS is free; cache on the server per grid cell, as /api/weather already does.
8. **Daylight on the route line.** Shade the part of the route that would be ridden after sunset (a dimmer casing), with a 🌅 marker where the light runs out. This uses `calculateSunset` at each point's ETA.
9. **Smart chip.** Gas stays first. One contextual chip, worded as a suggestion: "Coffee nearby" in the morning, "Fuel before the gap" when the route's longest stretch without a station passes 60 mi, "Lodging" after 8 PM.

## Wave 3: a map that matches the hour and the ride

10. **Real sun lighting.** Position the hillshade illumination, extrusion light and sky colours from the actual sun azimuth and altitude (NOAA maths we already have, or SunCalc, which is MIT). Golden hour on the map is golden, and dusk turns the sky to dusk. Pair it with auto Day/Dusk/Night by sun state. The `sunState` helper already exists.
11. **OpenGravel Rider style** (Terra #10; reboots the Style Lab direction). Transform Mapbox Outdoors at load:
    - quieter shields and POIs at z9–13, keeping fuel, coffee and viewpoints;
    - twisty roads with a warm glow and a width that tracks curvature;
    - unpaved roads in a textured dashed brown;
    - water and forest a touch richer, contours lighter.
    The bar is a blind A/B against Mapbox Standard, using the `/vote` pattern from the Style Lab.
12. **Animated rain radar.** RainViewer's free tiles with a two-hour scrub and a 30-minute nowcast, drawn as a raster under labels with a small timeline in the map. Free with attribution.
13. **Wind on the map.** Small animated wind arrows from the NWS gridpoint data, shown at z8–12 when the Weather set is on. Riders care about crosswinds on bridges and ridges.

## Wave 4: wow

14. **3D ride flyover** ("Preview this ride"). MapLibre `FreeCamera` follows the route over Mapterhorn terrain at about 600 m altitude, looking ahead, at 60–90 s per 100 mi, with a scrub bar plus pause and play. This is REVER's best feature, done better. Respect reduced motion (show a static 3D overview instead).
15. **Self-hosted HD terrain for PA, NJ and NY.** Mapterhorn publishes regional PMTiles extracts. Host them on megaplex and serve them through our tile route with CDN caching. That gives offline 3D, no dependence on a third party, and the same 512px z16 relief. Check disk space on docker-stable first (12 GB free).
16. **Street-level peek on place cards.** Viewpoints, gravel roads and twisty segments show the nearest Mapillary image (the key is already in env) as a swipeable strip. Pressing Look around opens the full viewer.
17. **Layer scenes.** One tap sets a whole look:
    - **Sunday twisties:** Rider style, Fun roads, 3D off, coffee chips.
    - **Gravel day:** gravel and public land, hillshade, satellite hybrid.
    - **Night ride:** Night style, fuel and lodging, weather alerts.
    Each scene has a picture card, like the map types.
18. **Explore thumbnails rendered by us.** Explore cards currently use static Mapbox images, which ignore Night (a known follow-up). Render them server-side with headless MapLibre in our own style and theme, at 3D 45° for mountain routes, and cache them by route hash. This is cheaper than static images at scale.

## Guard rails

- **Quota watch.** A daily timer reads Mapbox token usage (or counts our own tile requests at the proxy) and alerts at 70% of each free tier. It feeds the existing PostHog daily report.
- **Every wave:** iPhone screenshots in Day and Night, keyboard and focus check, reduced motion respected, all gates (powerplex fast, megaplex for critical), and deploy via release.sh.

## Known bugs to fix along the way

- Several catalog `colorToken`s (`--og-signal-blue`, `--og-ember`, …) no longer exist after the v3 token rename. The sheet now uses the hex `color`, but other surfaces that read the tokens should be checked.
- Powerplex-only critical flakes: `first-route:179/240` and `avoid-area:264` (they miss the "Updating ride…" frame) also fail on main there, and pass on megaplex.

---

## Prompt for the build session

> Build OpenGravel's map experience plan in `docs/vnext/design/MAP-EXPERIENCE-NEXT.md`, wave by wave, starting with Wave 1. Work in a new worktree off origin/main (OneBigHen/OpenGravel). You have full authority. The bar is a sleek, gorgeous, moto-centric, Google-Maps-grade app inside free tiers. Take Terra's ideas as input, not orders. For each wave:
> 1. Build it.
> 2. Run fast gates on powerplex (`~/ogv-verify/pp-gates.sh <branch> <sha>`, which queues on a lock) and the critical gate on megaplex or powerplex.
> 3. Shoot iPhone-size screenshots in Day and Night.
> 4. Merge, then deploy with `ssh docker-stable "cd /root/Vibe/wt/og-public && bash infra/deploy/release.sh origin/main"`.
> 5. Send the owner the screenshots.
>
> Bring in Codex gpt-6.1-terra (`delegate sol -m gpt-6.1-terra`) for a design review after each wave.
