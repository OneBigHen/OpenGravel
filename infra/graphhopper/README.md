# Isolated Pennsylvania hike router (GraphHopper 11)

The app uses this dedicated foot graph only when `OGV_HIKE_GRAPHHOPPER_URL`
is configured. See [the production service recipe](hike-service.md) for the exact
copy list and unit template. Bulk files live in `/mnt/wsl/ogv-data/ghbuild-hike`.
Never stop another router, change the shared jar or write to a rider cache.
The old strict and quality graphs are retained. The quality listener still owns
127.0.0.1:8995 (API) and :8996 (admin). The v3 test server uses **127.0.0.2:8996**
because freeing the old admin port would require interrupting that server.
Production `hike.yml` uses 127.0.0.1:8995 with no admin connector.

## Build and run

Requires Java 17/JDK (`javac`), `curl`, `patch`, `osmium-tool` 1.16+, and pyosmium
4.3.2 in the existing hike-only venv. On this machine the unpacked osmium executable
and library need these environment variables:

```sh
export PATH=/mnt/wsl/ogv-data/trails/tools/usr/bin:$PATH
export LD_LIBRARY_PATH=/mnt/wsl/ogv-data/trails/tools/usr/lib/x86_64-linux-gnu${LD_LIBRARY_PATH:+:$LD_LIBRARY_PATH}
```

From the repository root:

```sh
/mnt/wsl/ogv-data/ghbuild-hike/venv/bin/python infra/graphhopper/hike-access.py \
  /mnt/wsl/ogv-data/trails/pennsylvania-latest.osm.pbf \
  /mnt/wsl/ogv-data/ghbuild-hike/pennsylvania-hike-v3.osm.pbf
infra/graphhopper/build-hike-snap.sh \
  /mnt/wsl/ogv-data/ghbuild-hike/graphhopper-web-11.0.jar \
  /mnt/wsl/ogv-data/ghbuild-hike/snap-overlay-v3
cp infra/graphhopper/hike.yml /mnt/wsl/ogv-data/ghbuild-hike/config-v3.yml
cp infra/graphhopper/custom-models/ogv-hike.json /mnt/wsl/ogv-data/ghbuild-hike/custom-models/
```

The preprocessor refuses to overwrite its input or an existing output. For another
import, choose a new derivative and graph directory in the hike build directory.
Check the listener's exact PID and command before restarting **only** this server.
Launch from the hike build directory:

```sh
cd /mnt/wsl/ogv-data/ghbuild-hike
java -Xmx12g -cp snap-overlay-v3/hike-snap.jar:graphhopper-web-11.0.jar \
  com.graphhopper.application.GraphHopperApplication server config-v3.yml
```

The first start imports and prepares landmarks; later starts load the cache.
**The classpath overlay is required.** Launching with `java -jar` omits the snap
fix. The overlay downloads the pinned GraphHopper 11.0 `ViaRouting.java` at commit
`69e50f6e2cfaf0a8e69752df9953ee5f1ac276a4`, verifies its SHA-256, applies the small
patch and compiles a separate jar. Upstream's Apache-2.0 source notice is retained
in the downloaded source. The original GraphHopper jar remains unchanged.

## Routing policy

- Snap to the nearest eligible path, footway, track, steps, bridleway, pedestrian
  way or cycleway, within **2 km**. No fallback to a road. The app discloses
  starts, ends and waypoints more than **300 m** from the trail, without adding
  an invented access connector. This
  applies to point-to-point/via requests; round-trip generation is not covered by
  this patch. Heading/name hints do not override nearest-trail snapping.
- Prefer mapped hiking/foot networks (including nested relations) and walking
  ways. Penalize primary ×0.01, secondary ×0.03, tertiary ×0.08 and other ordinary
  roads ×0.15. Motorways and trunks have zero priority, even when `foot=yes`.
- Import foot access, priority, speed, road access, hiking network, SAC rating,
  road class/environment and surface. SAC T3 and above (`hike_rating >= 3`) are
  excluded; unknown is allowed but never described as easy. There is no exposed
  user-selectable SAC limit yet.
- Explicit `foot=yes/designated/permissive` (also official/destination) overrides
  general `access=no/private`. `foot=no` remains excluded. Restricted relation
  access propagates to descendants without explicit foot permission. Node/barrier
  permission is evaluated independently from the way's permission.
- Unrestricted gates/stiles/cycle barriers/bollards are passable for foot. A locked
  barrier needs explicit foot permission; fences/walls without permission block.
  Restricted nodes get blocker copies 0.5 m along **every incident segment**,
  including way ends and junctions. Original barrier tags are retained as
  `ogv:original_barrier` in the derivative. This avoids GH11's ignored-junction
  barrier behavior without closing unrestricted gates or altering the source PBF.

GH11's stock [snap filter](https://github.com/graphhopper/graphhopper/blob/11.0/core/src/main/java/com/graphhopper/routing/util/SnapPreventionEdgeFilter.java)
supports motorway/trunk, not primary or arbitrary road classes, and
[ViaRouting](https://github.com/graphhopper/graphhopper/blob/11.0/core/src/main/java/com/graphhopper/routing/ViaRouting.java)
falls back to unrestricted snapping. The model alone cannot fix those snaps.
[WaySegmentParser](https://github.com/graphhopper/graphhopper/blob/11.0/core/src/main/java/com/graphhopper/reader/osm/WaySegmentParser.java)
ignores barrier nodes at junctions. These are the reasons for the isolated overlay
and preprocessing, rather than config flags that GH11 does not implement.

No elevation graph is enabled; GraphHopper times are not DEM/Tobler estimates.
The app computes Tobler time and gain/loss from the returned line
and a DEM; the catalog computes its records independently. A successful HTTP
response is not a validated hike: Lehigh still needs a road detour with these endpoints. See the
[measured run and remaining blockers](../../docs/vnext/research/trail-catalog-run-2026-10-28.md).

## Checks and fixed probes

```sh
/mnt/wsl/ogv-data/ghbuild-hike/venv/bin/python infra/graphhopper/test_hike_access.py \
  --integration /mnt/wsl/ogv-data/ghbuild-hike/graphhopper-web-11.0.jar \
  /mnt/wsl/ogv-data/ghbuild-hike/snap-overlay-v3/hike-snap.jar
python3 infra/graphhopper/measure-hike.py \
  --out /mnt/wsl/ogv-data/ghbuild-hike/probes-after.jsonl
python3 infra/graphhopper/measure-hike.py --trails-only \
  --out /mnt/wsl/ogv-data/ghbuild-hike/probes-trails-only.jsonl
```

The integration fixture imports a temporary hike graph with no web listener. It
checks 16 access/barrier/SAC/road corridors, the 2 km snap cap, a nearer road versus
a trail, nested hiking-network preference, a longer trail beating a short road, and
motorway/trunk transit being forbidden between otherwise eligible trail endpoints.
The probe script retains complete responses, geometry and details, reports
length-weighted path/track and all-trail percentages, snaps, and maximum road class.
`--trails-only` disables every non-trail class to diagnose graph connectivity;
it does not establish legal access or authorize changes to OSM geometry.

The v3 before/after measurements and browser evidence are recorded in
[the app integration report](../../docs/vnext/research/hike-planning-2026-10-28.md).

# Motorcycle router v2

Everything for the motorcycle router lives in [`moto/`](moto/); production's own
config and models were only in the frozen `switchback` repo until RM-1. Version 2 is
production's router (same GraphHopper 11.0 jar, same `pa-nj-motorcycle.osm.pbf`, same
four profiles, byte-identical custom models) plus three values the graph computes
for itself during the import:

| Value | What it means |
|---|---|
| `og_curve` (0 to 1) | How bendy the road is around this edge: weighted bend metres (the same road-bends-v1 maths as `src/domain/geometry/road-bends.ts`) within 500 m either way along the same road, over the metres covered, with 20% reading as 1. Town streets, service roads, links and roundabouts read 0. |
| `og_through` | Not dead-end territory: the edge sits in a part of the road network with at least 20 km of roads once every only-way-in road is removed, or on the road between two such parts. Roads a motorcycle may legally use only. |
| `og_through_street` | The same without unpaved roads and without tracks rougher than grade 1. |

`osm_way_id` is added too, so our own facts can be joined to roads later. The custom
models do not read the new values yet (RM-2 does), so v2 routes exactly like production.

How it works: `moto/build-og-ext.sh` builds `og-ext.jar`, a classpath overlay (pinned
upstream `GraphHopperManaged.java`, sha256-checked, one-line patch to use
`com.opengravel.gh.OgGraphHopper`). `OgGraphHopper` registers the three values and
computes them in `postImportOSM()`, after the engine's own town density and speed limits
and before landmarks. The upstream jar is never modified.

```sh
# Windows PC, WSL. A new folder each time; the script refuses an existing graph.
infra/graphhopper/moto/build-graph.sh /mnt/wsl/ogv-data/ghbuild-moto-v2/build-N
infra/graphhopper/moto/serve-v2.sh    /mnt/wsl/ogv-data/ghbuild-moto-v2/build-N   # 127.0.0.1:8989, -Xmx4g

# Checks
java -cp BUILD/og-ext/og-ext.jar:BUILD/graphhopper-web-11.0.jar com.opengravel.gh.OgChecks tests/fixtures/road-bends
npx vitest run tests/unit/geometry/road-bend-fixtures.test.ts
# docker-dev, with the v2 router tunnelled to 8988 and production on 8989:
ssh -N -L 8988:127.0.0.1:8989 windows-zac
GRAPHHOPPER_URL=http://127.0.0.1:8988 node --conditions=react-server --import tsx scripts/scorecard/field-check.ts
python3 infra/graphhopper/moto/probe-graph.py --url http://127.0.0.1:8988 --prod http://127.0.0.1:8989 \
  --atlas data/scorecard/gravel-atlas-v3.sqlite --field-json scorecard-out/field-check.json \
  --turn-costs-bytes <size of graph-cache-v2/turn_costs> --memory-cmd '<prints the v2 java RSS in bytes>'
```

`build-graph.sh` writes `import.log`, `gc.log`, `SHA256SUMS` of the graph folder and
`build-summary.txt` (input hashes, time, peak memory, the passes' own summary lines,
graph size). On the Windows PC a process started from an ssh session dies with it, and
`systemd --user` units stop too (no linger): start long runs from a Windows scheduled
task that keeps its own `wsl.exe` open, and keep the PC awake with the bar's
"Stay awake" holder.

The road-bend fixtures in `tests/fixtures/road-bends/` are written by
`scripts/geometry/write-road-bend-fixtures.ts` and read by both the vitest pin and
`OgChecks`, so the app and the graph count the same bends. If `road-bends.ts` changes,
rewrite them and re-run both.

`moto/prepare-motorcycle-osm.mjs` and `moto/lib/motorcycle-osm.mjs` are byte-for-byte
copies of the switchback scripts that made the map file (sha256 `3bbe1c95…a515` and
`c50f9173…2108`), kept so the whole recipe lives here. They were not re-run for v2: it
uses the same map file as production. Note that `prepare-motorcycle-osm.mjs` resolves its
project root as the folder above its own, so run from a copy laid out as in switchback.
