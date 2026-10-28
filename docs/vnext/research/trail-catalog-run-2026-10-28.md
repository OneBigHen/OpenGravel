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
