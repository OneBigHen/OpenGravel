# Trail catalog pipeline

Offline job for HIKE-MODE-PLAN **H1 item 4**: turn a regional OSM extract plus
USFS and NPS trail data into the two artifacts the hike surfaces read.

| Output | Shape | Used by |
|---|---|---|
| `trails.geojson` | `FeatureCollection` of `LineString`/`MultiLineString`, one feature per physical trail | map layers, trail page geometry |
| `hikes.json` | compact index: id, name, length, bbox, ends, trailheads, every source, honest `null`s | Explore hikes, the API, offline packs |

Inputs are read once and merged by geometry; every source that described a trail
is kept on it.

## Exact command

```sh
npm run catalog:trails -- \
  --osm infra/maps/data/source/pa-nj.osm.pbf \
  --usfs infra/trails/data/source/usfs-nfs-trails.geojson \
  --nps infra/trails/data/source/nps-trails.geojson \
  --out infra/trails/data/out
```

`--osm` is required, `--out` is required, `--usfs` and `--nps` are optional.
`--dem-cache DIR` enables elevation and Tobler measurements; `--dem-zoom 12|13|14`
selects resolution (default 12). Without a DEM, measurements remain null.

The measured Pennsylvania build on powerplex uses the existing source PBF:

```sh
TMPDIR=/mnt/wsl/ogv-data/trails node --max-old-space-size=24000 --import tsx \
  infra/trails/build-trails.ts \
  --osm /mnt/wsl/ogv-data/trails/pennsylvania-latest.osm.pbf \
  --out /mnt/wsl/ogv-data/trails/2026-10-28 \
  --dem-cache /mnt/wsl/ogv-data/dem-cache --dem-zoom 12
```

Use the osmium PATH/library settings in [the hike router README](../graphhopper/README.md)
on this machine. No packages are installed into shared `node_modules`.
`--trailhead-radius METERS` overrides the 300 m default. The script prints its
progress and the output paths to stderr, so `--out` can be the only file it
writes.

Run it directly if you prefer (`tsx` is already a dev dependency):

```sh
node --import tsx infra/trails/build-trails.ts --osm <input> --out <dir>
```

## Reading the OpenStreetMap extract

There is no OSM protobuf reader in `node_modules`, so the job never parses a
`.osm.pbf` itself. It runs `osmium-tool` — the same tool
`infra/maps/scripts/fetch-osm.sh` already needs — and reads the GeoJSON sequence
osmium writes. Five commands, exactly as printed by the script:

```sh
# 1. hiking/foot routes and walking ways, plus every object they reference
osmium tags-filter --overwrite \
  -o "$WORK/trails.osm.pbf" region.osm.pbf \
  r/route=hiking,foot \
  w/highway=path,footway,track,steps,bridleway,cycleway,pedestrian

# 2. route relation member lists (route relations are not exported as lines)
osmium cat --overwrite -t relation -f opl -o "$WORK/relations.opl" "$WORK/trails.osm.pbf"

# 3. those trails as lines, with the OSM type and id kept as properties
osmium export --overwrite --no-progress -f geojsonseq \
  --geometry-types=linestring -a type,id \
  -o "$WORK/trails.geojsonseq" "$WORK/trails.osm.pbf"

# 4. trailheads and parking only, so the point export does not carry every
#    node of every trail way
osmium tags-filter --overwrite \
  -o "$WORK/trails-places.osm.pbf" region.osm.pbf \
  n/highway=trailhead n/amenity=parking \
  w/highway=trailhead w/amenity=parking a/amenity=parking

# 5. those places as points (and parking areas as polygons; the centroid is used)
osmium export --overwrite --no-progress -f geojsonseq \
  --geometry-types=point,polygon -a type,id \
  -o "$WORK/trails-places.geojsonseq" "$WORK/trails-places.osm.pbf"
```

The script runs these into a temporary directory and deletes it afterwards, so
there is no need to run them by hand. One sequence is read into memory at a time
(a state-sized walking-way export is a few hundred MB of JSON), so this is sized
for the build host, not for a phone or a laptop session. To reuse an existing export, pass a
`.geojsonseq`, `.geojson`, `.geojsonl` or `.ndjson` file as `--osm` instead of a
PBF; it is read as it is, and `--osm-places` can carry a second sequence of
trailhead/parking features.

## What counts as a trail

From OSM:

- every `route=hiking` and `route=foot` relation (direct member ways assembled in
  member order into continuous lines; a gap between members stays a gap, it is
  never bridged. Nested relation members are not expanded);
- every **named** `highway=path|footway|track` way (as a `LineString`).

Backward member roles reverse the child geometry. A branch-local ancestor set
terminates cycles without dropping repeated siblings. Missing ways/relations and
cycles are counted in the build log; a missing member never creates a straight
connector. A clipped state extract can still leave long routes incomplete.

A trail whose whole line is already part of a strictly longer OSM trail is
absorbed into it instead of being listed again — that covers a named member way
of a route relation and a sub-relation of a longer route. Because the comparison
is on the OSM nodes themselves, it only fires when two records really are built
from the same ways; two overlapping but separately digitized lines both stay.

From USFS/NPS GeoJSON: every feature with a line geometry and a name or ref.
Attributes are mapped from the agency's own spelling (`TRAIL_NAME`, `TRAIL_NO`,
`ADMIN_ORG`, `SURFACE`, `NAME`, `OBJECTID`, …). Features whose status says
`PROPOSED`, `PLANNED` or `DECOMMISSIONED` are skipped and counted: a proposed
alignment is not a trail on the ground. Agency data has no per-record page, so
`url` stays `null` rather than pointing at a guessed address.

USFS: *National Forest System Trails* (EDW). NPS: *Trails*. Both are public
domain; download them as GeoJSON, or convert a shapefile with:

```sh
ogr2ogr -f GeoJSON usfs-nfs-trails.geojson NFS_Trails.shp
```

## Merging

Two records are the same trail when

- their vertex sequences are equal once rounded to 5 decimals (≈1 m) in either
  direction and in any member order (both sources came from the same OSM nodes),
  or
- both ends are within 75 m of each other and the lengths differ by at most 10 %
  (or 50 m, whichever is larger) — the same trail digitized twice.

Anything else stays separate. A false merge would credit one trail's access or
surface to another, which is worse than listing a trail twice.

The merged feature keeps:

- **every source** in `sources` (`sourceId`, `sourceLabel`, `recordId`, `url`);
- the **most complete geometry** (longest primary line; ties to the
  higher-priority source);
- the **id of the highest-priority source**, so a rebuild cannot renumber a trail
  when an agency redigitizes it: `osm:way/123`, `osm:relation/45`, `usfs:F-101`;
- the **highest-priority value** for each attribute, in the order OSM → USFS →
  NPS, falling through to a lower-priority source when the higher one is silent;
- the more descriptive name when two records of the same priority both name it.

When two sources disagree, the disagreement is recorded in `conflicts`
(`{ field, kept: { sourceId, value }, other: { sourceId, value } }`). Nothing is
silently overwritten.

`lengthMeters` is measured on the retained geometry with the app's haversine
implementation. It is a measurement of the line, not a claimed official distance.

## Trailheads

A `highway=trailhead` node or `amenity=parking` node/area counts for a trail only
when it is within **300 m of an end** of the trail's retained geometry
(`--trailhead-radius` changes this). Each match records the real distance, which
line and end it serves, and its own source. Parking in the middle of a loop is
not a trailhead, and a trail with nothing mapped near its ends gets
`trailheads: []` — unknown, not "no parking". At most ten are kept per trail,
nearest first.

## Unknown stays unknown

Every attribute and every hike field is `null` when no source said anything:
`name`, `ref`, `operator`, `sacScale`, `surface`, `trailVisibility`, `dog`,
`access`, `elevationGainMeters`, `elevationLossMeters`. A consumer must read
`null` as "not mapped", never as easy, open, flat or paved.

With `--dem-cache`, both artifacts carry `elevationGainMeters`,
`elevationLossMeters`, `maxGradePercent` (signed; largest absolute grade),
`toblerMinutes`, `elevationMeasuredShare`, `elevationSource` and `timeMethod`.
Tiles come from [Mapterhorn](https://mapterhorn.com/), decoded with the existing
`sharp` dependency: Terrarium RGB, **512 px** per tile, bilinear interpolation
across tile boundaries. WebP originals are cached at
`<dem-cache>/mapterhorn/<z>/<x>/<y>.webp`; decoded tiles use a bounded memory cache
and at most six concurrent downloads. Tile errors are retried three times,
reported, and left unknown rather than converted to sea level.

Every geometry vertex is retained and long segments are densified to at most
30 m. Each continuous part uses `src/domain/hike`’s `computeHikeStats` (exported from
`stats.ts`) and its **100 m** grade window; shorter measured runs use their average,
and a run under 5 m has null grade. Parts are measured separately: no distance,
gain, grade or time crosses a geometry gap. A partial DEM keeps full-trail
measurements null and records the measured share.

Time sums the domain's Tobler function per measured segment, in the recorded
geometry direction: `6 * exp(-3.5 * abs(slope + 0.05))` km/h. It excludes rests and
personal pace. No surface/SAC multiplier is invented from missing tags; this is an
explicitly labeled terrain baseline, not a calibrated promise of completion time.
Gain/loss sum DEM changes without a noise deadband; source resolution and DEM
noise affect the estimates. Multipart totals describe the retained pieces, not a
verified continuous itinerary. Short closed loops retain their vertices rather
than collapsing to identical endpoints during sampling.

**Still outside this job:** surface/SAC distance mixes, calibrated terrain
multipliers, loop/out-and-back classification and features along the way (water,
viewpoints, summits). The catalog includes restricted trails as source records;
record presence is not permission to enter or a routing eligibility decision.

The output is deterministic: no build clock and no random ids, so the same inputs
always produce identical bytes and a rebuild diff only shows real data changes.

## Tests

```sh
npx vitest run --maxWorkers=8 tests/unit/infra/trails
```

The fixtures under `tests/fixtures/trails/` are a tiny hand-written
`osm-trails.geojsonseq` (the osmium output shape, with `members` on the relations
so assembly is exercised) plus one USFS and one NPS `FeatureCollection`. They
cover: relation assembly and gaps, absorbing member ways, unnamed/non-walking
ways being dropped, exact and near duplicates, a three-source merge with a
recorded conflict, unknown attributes staying `null`, trailheads inside and
outside the radius, and byte-identical rebuilds.

The hike index includes a geometry-derived `shape` for continuous lines using
`src/domain/hike/shape.ts`. Disconnected multipart records are `unknown`; no
connector is invented. Shape describes the mapped line and is not proof of a
walkable itinerary. Older catalogs lack this field and do not match shape filters.

## Rich catalog (2026-10-28)

Keep input/export/cache/output files on `/mnt/wsl/ogv-data`. Export open OSM
context once with `infra/trails/export-context.sh REGION.osm.pbf context.geojsonseq`,
then run `node --max-old-space-size=20000 --import tsx infra/trails/enrich-trails.ts
--base MEASURED_CATALOG --context context.geojsonseq --out NEW_CATALOG` (on one
line). Repeat `--context` for another region. The input catalog is never changed.

Features use segment-to-segment or point-to-segment distance within **100 m**,
including crossings between vertices. Lake polygons use their shorelines. Each
OSM object appears at most once per trail at its closest encounter (earliest
encounter on an exact tie). Features retain coordinates, OSM id/link, ODbL licence,
kind, offset and distance along the stored geometry. Multipart offsets sum only
retained lines, never gaps, and retain a line index. Proximity does not establish
access or a connecting path. A peak alone does not establish a view: Views matches
mapped viewpoints and observation/fire towers only. Missing features do not
match positive filters. No claim of feature completeness is made.

The compact on-disk artifacts carry details; `/api/hikes` drops full feature
lists unless an `id` is requested. Batched geometry drops features too. Cards use
only kinds/count; detail pages show the attributed feature list.
