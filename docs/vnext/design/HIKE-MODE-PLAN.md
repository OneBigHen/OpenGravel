# Hike mode: a free, offline-first trail app that beats AllTrails and Gaia

Written 2026-10-27. The owner wants OpenGravel to also work for hiking and to be better than AllTrails (and its paid tier), Gaia GPS and onX Backcountry, especially offline. This plan runs beside `MAP-EXPERIENCE-NEXT.md`; the map waves there (terrain, sun lighting, flyover, self-hosted HD terrain) serve hikers too.

## Where the others fall short (our openings)

| Them | Gap | Our answer |
|---|---|---|
| AllTrails | Offline maps, wrong-turn alerts and 3D previews are behind a paid plan | All of it free, offline by default |
| AllTrails | Difficulty is crowd-voted ("moderate") and times are generic | Honest time from grade, surface and *your* recorded pace; difficulty explained in numbers |
| AllTrails | Trail data is closed and often stale; user-drawn tracks | OSM + USFS + NPS + state trails, with the source and date on every trail |
| Gaia / onX | Powerful but cluttered; planning on a phone is hard | Google-Maps-grade calm UI we already built for riders |
| All | Little help on the day: daylight, hunting season, water, closures | A trail-day briefing: sunset turn-around time, game-land hunting days, water sources, fire and NPS alerts |

## Truth rules (same as riding)

Unknown stays unknown. A trail with no surface or visibility data is never shown as easy or clear. Closures and seasonal restrictions come with their source and date. Time estimates show the formula behind them.

---

## H0: one app, two modes

1. **Activity mode** (`ride` | `hike`) in the planning store and Settings, with a switch on the Plan screen's search bar. The mode picks the routing profile, map style, units for pace, layer defaults, POIs and copy. Riding stays the default; nothing changes for riders who never switch.
2. **Hike map style.** Transform the base style at load (the same mechanism as the Rider style in map Wave 3): trails drawn bold by type (footway, path, track, hiking route relations in a coloured casing), contours and hillshade on by default, roads quieter, trailheads, shelters, water, summits and viewpoints promoted.
3. **Hike layers and sets** in the catalog: Trails, Trailheads, Water sources (`natural=spring`, `amenity=drinking_water`), Shelters and campsites, Summits, Public land (exists), Hunting season (PA State Game Lands), Trail closures.

## Core: Breadcrumb (off-trail waypoint routes)

A first-class planning mode for both hikers and ADV riders, beside the router and the pen. Gaia and onX have it; AllTrails barely does. Ours is free and fully offline.

- **Drop waypoints** by tapping the map (or long-press → "Add breadcrumb"), drag to move, tap to delete or rename, undo/redo. Each leg between two waypoints is either a **straight line** (off trail, the default when there is no trail or road) or **snapped** to the trail/road network when the user chooses it and a graph is available (online, or offline graph tiles).
- **Numbers that update as you tap:** distance per leg and total, elevation profile from the DEM (Mapterhorn online, cached terrain tiles offline), gain/loss, max grade, Tobler time (H1 item 6). Steep legs (>30 % grade) are flagged; legs that cross water or private land are flagged when that data is on the device. Unknown stays unknown.
- **Runs on the phone.** No server is needed to build a breadcrumb route, so it works with no signal. Saved like any route (My rides / My hikes), exported as GPX with waypoints, and navigable: follow the line with distance and bearing to the next waypoint and an off-line alert.
- **Breadcrumb trail while moving.** The recorder draws the user's own track as they go; **Back to start** turns it into a reversed route to follow home (the classic lost-hiker save), also offline.
- Works in Ride mode too (ADV off-road, private land with permission), with a clear note that straight-line legs are not roads.

## H1: trail data we can trust

4. **Trail catalog pipeline** (offline job on powerplex, output served by our API): OSM `route=hiking|foot` relations and named `highway=path|footway|track` ways, plus USFS National Forest System Trails and NPS trails (both public domain), plus PA DCNR state park and forest trails. Merge by geometry, keep the best name and every source.
5. **Hike records** we compute ourselves: length, elevation gain and loss (Mapterhorn/3DEP DEM), max grade, loop / out-and-back / point-to-point, surface and `sac_scale` mix, trailhead with parking, features along the way (waterfall, viewpoint, summit, water) from OSM within 50 m.
6. **Honest time.** Tobler's hiking function on the DEM profile, adjusted by surface and `sac_scale`; once the user has recorded hikes, scale by their own pace. Show "about 2 h 40 m (Tobler, your pace ×1.1)".
7. **Photos.** Wikimedia Commons geotagged images and Mapillary (key exists) near viewpoints and the trailhead; licence and author shown.

## H2: plan a hike

8. **Hike routing.** A second GraphHopper profile `hike` (custom model on `foot`: prefers `route=hiking`, footway/path, penalises roads with traffic, respects `access=no` and `sac_scale` limits the user sets). Built on powerplex as a separate graph and served beside the car graph; never swaps the live rider graph without the owner's go-ahead.
9. **Draw on trails.** The existing snap-sketch pen snaps to trails in hike mode.
10. **Loop finder.** "A 5 mile loop from here with a view": round-trip routing from a trailhead or the user's location with a target distance and a feature wish; return three honest options.
11. **Explore hikes.** The Explore tab in hike mode lists catalog hikes near the map: filters for length, gain, time, loop, dogs allowed (`dog=yes|leashed`), waterfalls, views, kid-friendly (short, low gain, `sac_scale=hiking`). Cards use a real map thumbnail and the elevation profile, never a stock photo.
12. **Trail page.** Map with the trail, 3D flyover (map Wave 4), elevation profile with grade colouring, honest time, sources, features list, photos, conditions, Download for offline, Start.

## H3: offline that just works

13. **Download a hike** in one tap: the trail corridor (default 5 km buffer) as a PMTiles extract of the hike style, contours, hillshade, the catalog record and the hike graph tiles, using the existing offline-region machinery. Shows size before download. Free.
14. **Download an area** for trips (existing region rows, with a hike layer pack).
15. **Works with no signal:** GPS position and heading on the offline map, trail follow, wrong-turn alert (off trail by more than 40 m for 20 s, with a vibration), distance and gain left, time to the end, sunset countdown. Battery saver: dim map refresh rate and GPS interval when the screen is off.

## H4: on the trail

16. **Record a hike** with the Free Ride recorder in hike mode (pace, moving time, gain), save to My hikes, export GPX.
17. **Trail-day briefing** before Start: weather along the hike at each ETA (map Wave 2 code), sunset and turn-around time ("turn back by 3:40 to finish before dark"), hunting season today on game lands with an orange-wear note, fire and NPS alerts, water sources on the way.
18. **Share my hike.** A live location link with the planned route and expected finish; it says "overdue" if the hiker passes the finish time plus a margin.
19. **Emergency card.** Coordinates in decimal, DMS and USNG, nearest road access point and its distance, a call-911 button.

## Order and staffing

- **Now:** H0 (mode, style, layers) and H1 data pipeline in parallel; the pipeline is a powerplex job.
- **Next:** H2 routing graph (powerplex build) and Explore hikes + trail page.
- **Then:** H3 offline and H4 on-trail features, tested on the owner's iPhone with the radio off.
- Every slice: Day and Night iPhone screenshots, keyboard and focus, reduced motion, gates, deploy via `infra/deploy/release.sh`.
