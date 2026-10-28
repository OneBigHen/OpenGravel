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

Park association samples segment midpoints at ≤250 m intervals, measures the
share of retained trail length inside OSM polygons (respecting holes), and chooses
the smallest bounding-box area among named parks/reserves/protected areas covering
at least 50%. A short trail crossing can be missed by the sampling resolution.
Nearest town is the nearest mapped city/town/village point within 50 km of the
stored line's start, by straight-line distance, not road distance.

When no mapped SAC rating exists, complete nonnegative DEM gain and positive
length permit the [Shenandoah exertion formula](https://www.nps.gov/shen/planyourvisit/how-to-determine-hiking-difficulty.htm):
`sqrt(2 * gain_feet * distance_miles)`. Bands use `<50`, `<100`, `<150`, `<200`,
then ≥200: Easiest, Moderate, Moderately strenuous, Strenuous, Very strenuous.
These are estimated exertion bands, not overall technical difficulty. They omit
surface, scrambling, exposure, weather and personal fitness; even the source
warns that steep short hikes can be underrated. No missing gain is treated as 0.
The existing domain's richer live difficulty model is unchanged. This catalog
fallback uses the retained line/direction, not a presumed return journey.

### Agency overlay

`python3 infra/trails/fetch-official.py /mnt/wsl/ogv-data/trails/src/official`
queries canonical USFS, NPS and NJDEP ArcGIS services. It first requests **all
object IDs**, then downloads bounded ID batches, refusing truncated/missing
batches. Metadata, dates, source URLs, CRS, hashes and licence terms accompany
exports. US Census public-domain PA/NJ boundaries select intersecting records;
lines remain complete rather than being silently clipped to the boundary.

Run `node --max-old-space-size=20000 --import tsx infra/trails/merge-official.ts
--base MEASURED_CATALOG --sources SOURCE_DIR --out NEW_BASE --dem-cache DEM_DIR`
on one line, then run `enrich-trails.ts` against that new base. Only new lines need
DEM measurement. Matched OSM IDs, geometry and DEM remain stable. Both directions
must have ≥85% sampled length within 25 m of the other geometry, with length ratio
≥0.8. Samples use ≤30 m spacing. Parallel trails closer than 25 m can still be
ambiguous; differently segmented official/OSM trails conservatively remain
separate. No partial-segment rating is projected onto an entire long relation.

An official name, operator, surface, rating or readable use overrides OSM when
present. First official value wins (DCNR, then NPS, USFS, NJDEP); conflicts and
field sources retain the evidence. Official difficulty is separate from SAC and
takes precedence over both SAC and derived exertion. Unknown agency values stay
null. Planned/proposed/decommissioned features are excluded. A mapped closed
status or explicit not-open-to-public becomes access=no, never open. Current
access still requires checking the agency. Numeric USFS allowed-use codes without
a decoded domain are withheld from readable uses.

Federal sources are public domain. NJDEP permits redistribution with **all
provided metadata** and the required GIS credit/disclaimer. The overlay copies
layer metadata, the item record and the complete XML metadata to
`public/data-attribution/trails/njdep/` and the catalog's `sources/njdep/`; every
NJDEP trail links those terms and metadata. The manifest links all supplied
metadata files. The guide includes the NJDEP secondary-product disclaimer. The
source CRS is documented and transformed correctly by ArcGIS `outSR=4326`.

**PA DCNR release selection:** use only the separate [PA Open Data portal
Trails Simple Geometry release](https://data.pa.gov/Services-Near-You/Trails-Simple-Geometry/hguq-h588).
Its publisher metadata explicitly declares `licenseId: USGOV_WORKS` / “Public
Domain U.S. Government”, with DCNR attribution. The fetcher requires that exact
public-domain declaration and publishes the complete `portal.json` and manifest.
The licence is recorded as the **PA portal's declaration**, not an assertion that
state data automatically count as federal works. This release has 683 records,
including park trail systems and major state forest routes, with simplified
geometry and sometimes old per-record update dates. It is partial official
coverage, not the complete current DCNR park/forest network.

Do not infer that grant for the different legacy PASDA `DCNR_All_Trails62023.zip`,
whose metadata include “Not for commercial resale”, or for the current Explore PA
Trails website, whose terms restrict use to personal/non-commercial purposes.
Those versions remain excluded. Later PASDA park metadata say no access/use
constraints, but this job uses the explicit portal grant rather than extending
it to a different download. Numeric DCNR ratings/statuses without an unambiguous
historical legend are preserved as codes; they are not translated by guesswork.
An undecoded official rating withholds derived exertion (a known OSM SAC rating
can still be shown). Source priority is DCNR, NPS, USFS, NJDEP, then existing OSM
values. Missing official operators remain unknown rather than naming the data
publisher as trail operator.

### Wikimedia enrichment

`node --max-old-space-size=20000 --import tsx infra/trails/enrich-media.ts --base
ENRICHED_BASE --context OSM_CONTEXT --out NEW_CATALOG --cache WIKIMEDIA_CACHE`
(on one line; repeat context for NJ) resolves explicit OSM Wikipedia/Wikidata
links on trails, containing parks and notable features. It does not guess an
article from a trail name. Up to four subjects retain their kind/name so a park
article cannot be mistaken for a trail description. Plain introductory extracts
retain Wikipedia contributors, article/revision links and CC BY-SA 4.0; Wikidata
fallback descriptions retain CC0 and entity links. Requests use identifying UA,
maxlag, at most two in flight, retries and a disk cache. Failed responses are
reported in `media-stats.json` and never cached as a genuine absence.

Commons geosearch checks occupied 0.15° × 0.10° cells with 10 km circles, then
matches actual photo coordinates to **every trail segment within 300 m**.
Only namespace-6 raster files with a 640 px **thumbnail URL**, author, recognized
CC BY/CC BY-SA/CC0/public-domain licence URL and Commons description page qualify.
An original URL is never a fallback, and no original bytes are downloaded.
At most six nearest qualifying photos are kept (metadata candidates capped at
30 per trail). Credits/attribution and per-file licences accompany every photo,
including the list thumbnail. Crowded cells saturating the 500-result provider
limit and unavailable calls are counted: coverage is not claimed complete.
Descriptions and photo arrays are detail-only in the list API; one fully credited
thumbnail remains on cards. Mapillary is omitted when no token is configured.

`--photo-cell-limit N` is an explicit checkpoint option for media runs; the final
run omits it. Stats distinguish total occupied cells, requested cells, successful
or failed calls, and saturated result lists. On a busy Commons backend, a query
may fall back from 500 to 100 candidates; its actual limit is cached and used
when counting saturation. Media coverage remains a bounded search, not proof
that a place has no freely licensed photos. The final regional pass also
recomputes end-based trailheads for new official trails from the combined OSM
context, using the existing 300 m matcher.

### New Jersey and cross-border records

The existing Geofabrik New Jersey PBF is under
`/mnt/wsl/ogv-data/trails/src/new-jersey-latest.osm.pbf`. Build it with the same
`build-trails.ts` and DEM settings, then run `combine-catalogs.ts --input PA_BASE
--input NJ_BASE --out COMBINED_BASE --dem-cache DEM_DIR` (all commands on one
line). It unions **matching OSM IDs**, keeps existing traversals including return
legs, removes exact shared edges from the additional extract, and joins only at
shared vertices. It preserves gaps rather than drawing connectors. Changed
geometries get new DEM measurements. The PA/NJ job shares 19 IDs; five gain
additional geometry. It does not presume that same-name trails in different
parks are one trail.

Overlay official sources onto this combined OSM base, then enrich with **both**
PA and NJ contexts, then run media enrichment without a cell limit. All job
outputs/caches and intermediate catalogs stay on the data volume. Existing
catalog directories are inputs only and remain unchanged.

`--cache-only` assembles media from successful cached responses without network
requests. Missing cached responses are explicit gaps in its stats. This supports
rebuilding around corrected catalog facts without repeating the provider search;
preserve the full fetch run's `media-stats.json` separately when doing so.
