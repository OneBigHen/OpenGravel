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
