# Pennsylvania trail catalog and experimental hike graph — 2026-10-28

Input: Geofabrik Pennsylvania extract dated 2026-10-27, downloaded 2026-10-28 to `/mnt/wsl/ogv-data/trails/pennsylvania-latest.osm.pbf`. Catalog command: `TMPDIR=/mnt/wsl/ogv-data/trails node --max-old-space-size=24000 --import tsx infra/trails/build-trails.ts --osm /mnt/wsl/ogv-data/trails/pennsylvania-latest.osm.pbf --out /mnt/wsl/ogv-data/trails/2026-10-28`, with locally unpacked osmium-tool 1.16 on PATH. Only OSM was supplied; USFS, NPS and PA DCNR were not ingested. Outputs: `trails.geojson` (83 MB) and `hikes.json` (24 MB) in that output directory. Input SHA-256: `2ec5209b40267c339b84a3476c7eecb027550a18d38b1ddf4ba1a5d3cc59225a`. OSM attribution applies.

The run read 410,843 exported line features and 64,797 place features. After OSM ingestion and containment removal, 17,748 candidates merged into **16,484 trails**: 15,762 way IDs and 722 relation IDs; 16,091 LineStrings and 393 MultiLineStrings. 16,460 have names, 6,353 have a nearby mapped parking/trailhead, and 708 contain multiple source records (all OSM in this run, not cross-agency matches). 14,707 have no access tag; 1,183 are tagged private and 210 no. The catalog stores null for every gain/loss. A real API lookup of bbox `-76.01,40.62,-75.95,40.66` returned 13 records. Unknown access, parking or surface is not evidence of permission or conditions.

Route relations are assembled from direct way members. Nested relations are not expanded and incomplete extracts or unordered members may produce disconnected geometry; lengths sum the retained pieces, not an established hiking itinerary. Named paths and tracks include fragments, cycling routes and roads. End-based parking matches are proximity signals, not confirmed public trailheads. Near-duplicate merging uses endpoints and lengths and can join different alignments. The outputs are a source catalog, not a list of vetted hikes. Local access and closures are not independently checked.

## Ten sample catalog lines

Samples are chosen for proximity to the three requested areas; they are not route recommendations. Shape is the existing line classifier. Gain uses the application's zoom-12 Terrarium DEM and `computeHikeStats`, sampling line segments at no more than 30 m; it sums positive changes without smoothing, so resolution and noise affect the estimate. These estimates are for this report only; the catalog retains null gains. Trailhead is the nearest matched OSM parking/trailhead and its endpoint distance; `—` means none mapped within 300 m. Hawk Mountain samples have `access=no` in OSM even where foot is also tagged designated.

| Area | OSM line | Length km | Approx. gain m | Shape | Nearest matched place | Access tag |
|---|---|---:|---:|---|---|---|
| Hawk Mountain | [Lookout Trail](https://www.openstreetmap.org/way/28721832) | 1.17 | 19 | point-to-point | parking (Hawk Mountain Sanctuary), 276 m | no |
| Hawk Mountain | [River of Rocks Trail](https://www.openstreetmap.org/way/28721859) | 5.31 | 267 | point-to-point | parking (Hawk Mountain Sanctuary), 276 m | no |
| Hawk Mountain | [Golden Eagle Trail](https://www.openstreetmap.org/way/28721694) | 1.33 | 199 | point-to-point | — | no |
| Lehigh Gorge area | [Penn Haven Express](https://www.openstreetmap.org/way/425040022) | 3.08 | 12 | point-to-point | — | unknown |
| Lehigh Gorge area | [Buzzard's Option](https://www.openstreetmap.org/way/425040023) | 0.98 | 1 | point-to-point | — | unknown |
| Lehigh Gorge area | [Black Oak Connector](https://www.openstreetmap.org/way/499743206) | 0.93 | 54 | point-to-point | — | unknown |
| Jim Thorpe | [Galen's Revenge](https://www.openstreetmap.org/way/336895814) | 1.77 | 50 | point-to-point | parking, 139 m | unknown |
| Jim Thorpe | [Pisgah Plane](https://www.openstreetmap.org/way/336895838) | 0.70 | 186 | point-to-point | parking, 139 m | unknown |
| Jim Thorpe | [Switchback Trail](https://www.openstreetmap.org/way/1015150944) | 1.05 | 21 | point-to-point | parking, 55 m | unknown |
| Jim Thorpe | [The Wagon Road](https://www.openstreetmap.org/way/49683297) | 0.91 | 140 | point-to-point | parking, 111 m | unknown |

## Separate hike router

GraphHopper 11.0 imported the derived `pennsylvania-hike-strict.osm.pbf` into `/mnt/wsl/ogv-data/ghbuild-hike/graph-cache-strict`; the server listens at `127.0.0.1:8995` (admin 8996). The preprocessing set `foot=no` on 5,792 objects tagged `access=no`. Configuration, exact commands and limitations are in [infra/graphhopper/README.md](../../../infra/graphhopper/README.md). The graph has 3,180,588 nodes and 4,035,393 edges. The import reported 3,034 barriers ignored at junctions; relation-level access tags are not propagated to members. This is experimental routing evidence, not proof of access, trail condition or closure status. No app integration was enabled.

Five real requests used `profile=hike`, with no elevation graph. Points below are requested lat,lon; snap distances describe the actual points used by GraphHopper. Times are GraphHopper estimates, not measured walking times. Raw results and edge details are at `/mnt/wsl/ogv-data/ghbuild-hike/route-measurements.jsonl`.

| Area | Requested start → end (lat, lon) | Distance | Estimated time | Start / end snap | Road classes observed |
|---|---|---:|---:|---:|---|
| Hawk Mountain | 40.6343, -75.9878 → 40.6420, -75.9940 | 0.55 km | 6.5 min | 1 / 660 m | service, tertiary |
| Lehigh Gorge | 40.9700, -75.7150 → 40.9420, -75.7180 | 40.06 km | 480.8 min | 150 / 46 m | cycleway, path, track, service, footway, steps, residential, tertiary, secondary, unclassified |
| Jim Thorpe | 40.8697, -75.7408 → 40.8790, -75.7520 | 4.88 km | 58.6 min | 19 / 52 m | trunk, tertiary, service, residential, footway, cycleway |
| Delaware Water Gap | 40.9720, -75.1270 → 40.9860, -75.1330 | 2.36 km | 28.3 min | 161 / 207 m | tertiary, service, footway, path |
| Ricketts Glen | 41.3270, -76.2870 → 41.3380, -76.2790 | 2.83 km | 34.0 min | 51 / 18 m | footway, service, path |

These probes demonstrate limitations as well as successful responses. At Hawk Mountain, the end snapped 660 m away from the requested point and the resulting 0.55 km route is entirely service/tertiary road: it is not the requested trail walk. Before enforcing `access=no`, the same points produced a 1.38 km route over Lookout Trail, whose OSM way also has `foot=designated`; the stricter build excludes that access-no way. The Lehigh Gorge request produced a 40.06 km detour with road sections despite points only a few kilometres apart. Jim Thorpe includes a trunk edge. None should be presented as a validated hike without inspecting geometry, snaps, current access and conditions. All returned `hike_rating` values were 0 (unknown) or 1, and none reported `foot_road_access` no/private; that does not prove all restrictions were mapped or applied.


## Routing quality follow-up — 2026-10-28

**Result: working import, access/barrier/snap fixes and complete DEM catalog;
route acceptance is still 6/10, not ten validated hikes.** The original five
coordinates were retained, and five additional pairs were selected from named OSM
ways. The full-source PBF and its SHA-256 above are unchanged. No rider router,
rider cache, shared GraphHopper jar, app routing configuration, deployment or
remote branch was modified.

The previous run's import/pipeline commits were brought onto
`build/hike-route-quality` from `origin/ship/hike-data`. Baseline reruns reproduced
the previous five distances/classes, including Hawk's 660 m snap and Jim Thorpe's
trunk edge. Complete baseline and final responses (geometry, snapped points and
edge details) are under `/mnt/wsl/ogv-data/ghbuild-hike/`:

- `probes-before.jsonl`: ten probes against the old strict graph/model.
- `probes-after.jsonl`: ten probes against the rebuilt graph and 300 m trail snap.
- `probes-trails-only.jsonl`: final graph with every non-trail road class disabled
  in a request custom model, CH/LM disabled, to diagnose connectivity.
- `nearby-trails.jsonl`: nearest source ways and tags around the original four
  problematic pairs; projected distances are approximate.
- `preprocess-quality.log`, `server-quality.log`, `fixture-tests.log` and
  `server-quality-final.log`: preprocessing/import, real fixture checks and the
  latest listener startup. Earlier intermediate measurements are not acceptance.

The compact [measurement summary](trail-route-quality-2026-10-28.json) is committed
with input/output hashes; bulk artifacts remain on the data disk. Requested
coordinates are also versioned in [probes.json](../../../infra/graphhopper/probes.json).
Additional source ways are Trexler Border Trail `1093475201`, Jacobsburg red trail
`24293862`, Pine Creek Rail Trail `537248118`, Shades of Death `384591245` and
Bushkill Colony Trail `835309990`.

### Actual changes and import evidence

The custom model forbids motorway/trunk and SAC T3+, strongly penalizes primary,
secondary and tertiary roads, and prefers hiking/foot networks and walking ways.
`foot_network`, `hike_rating`, foot access/priority/speed/road access, road
class/environment and surface are imported. Nested hiking relations are flattened
for GraphHopper; **32** parent relations were expanded. The strict prepass also
propagates restricted relation access to **598** descendant ways.

GH11's stock snap filter does not support primary-road prevention and its
ViaRouting lookup falls back to unrestricted snapping. A pinned-source classpath
overlay now snaps only to eligible path/footway/track/steps/bridleway/cycleway/
pedestrian edges, within **300 m**, with no road fallback. The first iteration used
250 m, which rejected Water Gap's 252.5 m footway; the final 300 m cap uses the
same scale as catalog trailhead matching. Heading/name hints do not override the
trail filter. This covers point-to-point/via routing; round-trip snapping remains
outside the patch. See [the exact build/run and policy](../../../infra/graphhopper/README.md).

Unrestricted gates/stiles are passable on foot. Restricted/locked barriers are
copied 0.5 m onto **every** incident segment, so the importer no longer ignores
blocked junctions. The derivative retained **52,886 foot-passable barrier or
restriction nodes**, identified **9,131 blocked nodes**, and inserted **19,085**
blocker copies. The broader inventory includes access-restricted nodes without a
barrier tag, so these counts are not directly comparable to the old 3,034 warning.
The actual GH import's **ignored junction barriers fell from 3,034 to 0**. Fixture
imports separately verify that this is enforcement, rather than merely removal of
warnings: blocked junction approaches cannot route while open gates/stiles can.

The new graph is `/mnt/wsl/ogv-data/ghbuild-hike/graph-cache-quality`, with
**3,123,618 nodes / 3,978,423 edges**. The old `graph-cache-strict` remains intact.
The original jar is unchanged; the overlay is `snap-overlay/hike-snap.jar` and the
active config is `config-quality.yml`. The listener remains localhost:8995/admin
8996. No elevation graph is imported; the times in raw GH responses remain GH
estimates, not catalog Tobler times.

### Ten before/after probes

Percentages are length-weighted using response geometry and road-class detail
indices. “Path/track” counts exactly those two classes; “all trails” also includes
footway, steps, bridleway, pedestrian and cycleway. This matters at Ricketts and
Shades of Death: a footway is not a road simply because path/track share is low.
“None” means no motor-road class occurred. Unavailable is a rejected request,
never an invented zero-length trail route.

| Probe | Distance km, before → after | Path/track %, before → after | All trails %, before → after | Max road class, before → after | Final start/end snap m |
|---|---:|---:|---:|---|---:|
| Hawk Mountain | 0.55 → unavailable | 0.0 → — | 0.0 → — | tertiary → — | rejected |
| Lehigh Gorge | 40.06 → 38.33 | 37.3 → 10.5 | 59.5 → 66.5 | secondary → secondary | 150/48 |
| Jim Thorpe | 4.88 → unavailable | 0.0 → — | 19.8 → — | trunk → — | rejected |
| Delaware Water Gap | 2.36 → 2.18 | 49.7 → 53.8 | 59.4 → 64.4 | tertiary → tertiary | 252/207 |
| Ricketts Glen | 2.83 → 3.30 | 74.5 → 23.6 | 97.3 → 100.0 | service → none | 51/42 |
| Trexler Border Trail | 1.88 → 1.88 | 100.0 → 100.0 | 100.0 → 100.0 | none → none | 0/0 |
| Jacobsburg red trail | 0.98 → 0.98 | 100.0 → 100.0 | 100.0 → 100.0 | none → none | 0/0 |
| Pine Creek Rail Trail | 1.93 → 1.93 | 100.0 → 100.0 | 100.0 → 100.0 | none → none | 0/0 |
| Shades of Death Trail | 1.56 → 1.56 | 0.0 → 0.0 | 100.0 → 100.0 | none → none | 0/0 |
| Bushkill Colony Trail | 1.06 → 1.06 | 100.0 → 100.0 | 100.0 → 100.0 | none → none | 0/0 |

The six all-trail results also succeed with every road class disabled. The other
four are **not accepted** as trail hikes:

- **Hawk Mountain:** nearby destination paths, including Lookout/Escarpment/Skyline,
  carry `access=no` plus `foot=designated`. This run retains the prior strict policy
  requested for no/private access, so it rejects the destination instead of moving
  it 660 m onto a road. Normal OSM foot-specific precedence would allow these ways;
  that policy decision is unresolved, not a snapped-route success.
- **Lehigh Gorge:** the nearest start is D&L cycleway `421732696`, 150 m away; the
  nearest end is Penn Haven Express path `425040022`, 48 m away. Under this graph's
  access/SAC rules they have **no all-trail connection**. Even disabling landmarks
  and requesting zero priority on every road returns `ConnectionNotFoundException`.
  The road-permitted result still takes **38.33 km**, including secondary roads.
  Increasing penalties did not create a missing legal trail connection. It remains
  a failed quality probe, requiring verified source connectivity/access or a
  deliberate change of endpoints; no artificial connector was inserted.
- **Jim Thorpe:** no mapped trail lies within 300 m of the requested end. The nearest
  source path is about **629 m** away and D&L is about **632 m** away. The request is
  rejected instead of using a trunk or silently moving the destination. A separate
  diagnostic moving the end to D&L still required roads, so it did not establish an
  all-trail solution to the original request.
- **Delaware Water Gap:** the start now snaps to the nearest footway, **252.5 m**
  away, rather than tertiary road. The route still needs **699.9 m tertiary +
  76.7 m service**, and the all-trail request has no connection. This is an improved
  snap, not an accepted all-trail hike. A verified pedestrian connection or
  different hiking endpoints is needed.

These blockers cannot honestly be fixed by weakening access restrictions,
connecting unrelated OSM geometries or relabeling roads as trails. No claimed
all-ten success, legal-access verification or product integration is made.

## Catalog follow-up — DEM and nested relations

Rebuilt the existing Pennsylvania source to the requested
`/mnt/wsl/ogv-data/trails/2026-10-28/` using the command in
[infra/trails/README.md](../../../infra/trails/README.md). The original outputs are
preserved at `/mnt/wsl/ogv-data/trails/2026-10-28-before-quality/`.

| Metric | Previous run | Final run |
|---|---:|---:|
| Catalog records | 16,484 | 16,433 |
| Relation / way IDs | 722 / 15,762 | 703 / 15,730 |
| Multiple-source records | 708 | 709 |
| Nearby mapped parking/trailhead | 6,353 | 6,335 |
| Gain / loss known | 0 / 0 | 16,433 / 16,433 |
| Tobler time known | 0 | 16,433 |
| Max grade known | 0 | 16,340 |

Nested route and superroute children are expanded recursively, backward roles
reverse geometry, repeated sibling relations remain valid, and cycles terminate.
Missing references remain gaps. The state extract produced **16,666 missing-way
visits and 92 missing-relation visits, zero cycles** during expansion (visits, not
unique IDs); long regional/national routes remain partial source geometries.
Containment now compares nested parents against their full retained geometry,
which absorbs additional contained records and explains the record-count drop.
Canonical containment strings are cached so a statewide parent is not reformatted
for each candidate.

The DEM adapter decodes Mapterhorn's **512 px Terrarium WebP** tiles at zoom 12,
bilinearly interpolates across tile boundaries, and caches **1,781 tiles**, about
165 MiB, in `/mnt/wsl/ogv-data/dem-cache/mapterhorn/12/`. Tile byte hashes are
preserved in `dem-cache/mapterhorn/manifest-2026-10-28.json` on the data disk,
with its hash in the committed summary. Six downloads at most run
concurrently; failures retry and remain null. All final records have full DEM
coverage. Every source geometry vertex is retained and segments are densified to
≤30 m; a first sampling attempt collapsed ten short closed loops, which was fixed
and covered by a regression test before this final rebuild.

Each continuous geometry part uses domain `computeHikeStats`; the grade window
is **100 m**, with a shorter run's average and null below 5 m. **93 records** lack
any measured run reaching 5 m, so max grade remains honestly null. No statistics
or time bridge disconnected parts. Gain/loss sum DEM rises/falls without a noise
deadband, so resolution and DEM noise still affect them. The final median gain is
8 m, median loss 7 m, and median Tobler baseline 6.2 min; the long trail relations
are source fragments, not day-hike recommendations.

Tobler time integrates `6 * exp(-3.5 * abs(slope + 0.05))` km/h per DEM segment in
the stored geometry direction. It excludes breaks and personal/surface/SAC
multipliers; `timeMethod` explicitly labels this baseline rather than inventing
adjustments from absent data. Both files include gain/loss, signed max grade,
Tobler minutes, DEM measured share and method/source text. Surface/SAC distance
mixes, calibrated multipliers, shape classification and along-trail features
remain outside this task's implemented pipeline.

The ten prior sample records now have catalog gain/loss/grade/time, not report-only
values:

| Trail | Gain/loss m | Max signed grade % | Tobler baseline min |
|---|---:|---:|---:|
| Lookout Trail | 16 / 62 | -15.2 | 14.8 |
| River of Rocks Trail | 265 / 256 | 30.3 | 79.4 |
| Golden Eagle Trail | 200 / 1 | 27.8 | 28.0 |
| Penn Haven Express | 13 / 256 | -20.9 | 38.9 |
| Buzzard's Option | 1 / 93 | -19.8 | 12.5 |
| Black Oak Connector | 54 / 7 | 11.3 | 13.5 |
| Galen's Revenge | 48 / 61 | -24.8 | 23.9 |
| Pisgah Plane | 187 / 1 | 33.0 | 22.0 |
| Switchback Trail | 18 / 7 | 3.4 | 13.0 |
| The Wagon Road | 141 / 0 | 20.9 | 19.2 |

Only OSM is included; USFS/NPS/DCNR ingestion was not added. There are still 1,183
private and 210 no-access catalog records. A record is source evidence, not
permission to walk it. OSM and [Mapterhorn upstream attribution](https://mapterhorn.com/attribution)
apply. Exact artifact sizes and SHA-256 hashes are in the committed JSON summary.

## Follow-up validation

- `npx tsc --noEmit` — passed.
- ESLint on every changed TypeScript pipeline/test file — passed.
- `npx vitest run tests/unit/infra/trails tests/unit/domain/hike --maxWorkers=8` —
  **118 tests in 9 files passed**.
- Python preprocessing tests and the actual GH11 integration fixture — passed,
  covering open gates/stiles, blocked junctions, no/private/foot restrictions,
  locked-gate foot permissions, SAC cap, trunk/primary snaps, the 300 m boundary,
  nested hiking network preference, a longer trail beating a shorter road, and
  motorway/trunk transit between eligible trail endpoints.
- Full Pennsylvania hike graph rebuilt; final import ignored **0** junction barriers.
- All ten original/additional real probes and ten all-trail connectivity diagnostics
  rerun; six all-trail successes, four explicitly unresolved above.

No npm install, push or deployment was performed.
