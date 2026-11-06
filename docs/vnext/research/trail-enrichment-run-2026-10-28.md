# Rich PA / NJ trail catalog — 2026-10-28

Built locally on `build/hike-enrich`, starting at `origin/main@8fb650dc` after the requested branch reset. No push, PR, merge or deployment was performed. Existing source catalogs were read without modification. Bulk sources, exports, caches and artifacts stay under `/mnt/wsl/ogv-data`; screenshots use the requested `~/sol/shots/hike-enrich/` directory.

Output: `/mnt/wsl/ogv-data/trails/2026-10-28-rich/` (`hikes.json`, `trails.geojson`, source metadata, hashes and audit reports). These are source records, not vetted day hikes or a verification of permission/access.

## Sources and merging

| Source | Catalog records retaining source | Accepted agency input records |
|---|---:|---:|
| OpenStreetMap | 23,489 | — |
| PA DCNR (explicit PA Open Data release) | 656 | 656 |
| National Park Service | 964 | 998 |
| USDA Forest Service | 272 | 293 |
| NJDEP | 2,678 | 3067 |

Total **27,594 records**. Source columns overlap. The overlay matched 909 agency input records to existing geometry clusters, retaining all source references; this includes duplicates within an agency. The OSM base combines 16,433 PA and 7,075 NJ records with 19 shared IDs; five shared geometries gained additional segments. No invented connectors cross gaps.

DCNR is specifically [PA Open Data’s Trails Simple Geometry release](https://data.pa.gov/Services-Near-You/Trails-Simple-Geometry/hguq-h588), whose publisher metadata declares `USGOV_WORKS` / public domain. Its complete portal declaration is preserved. Of 683 records, 27 marked water trails are excluded. This grant is not extended to different DCNR downloads. Restricted legacy exports and the personal/non-commercial Explore PA Trails website were excluded. The accepted release has simplified geometry and sometimes old update dates; it is partial coverage of park systems and major forest trails, rather than the complete current DCNR network.

Federal sources use the canonical agency services and public-domain attribution. NJDEP’s full layer/item/XML metadata, distribution terms, CRS statement and required secondary-product disclaimer are retained and linked on the trail page. The original broad-bbox downloads contained 2,913 NPS, 471 USFS and 3,068 NJDEP rows; Census PA/NJ boundaries select intersecting records before normalization (1,169 / 293 / 3,067 respectively). Lines are selected rather than clipped.

Official readable attributes win over OSM when present, with per-field provenance and conflicts retained. OSM IDs/geometry/DEM remain stable on matches. Matching requires comparable length and ≥85% reciprocal sampled geometry coverage within 25 m, rather than shared endpoints alone. Different segmentation and nearby parallel alignments remain limitations. Unknown official operators are not replaced by the publisher’s name.

## Along-trail features and derived facts

| Kind | Trail–feature matches | Unique OSM objects |
|---|---:|---:|
| water | 18,976 | 7,406 |
| campsite | 3,375 | 1,570 |
| shelter | 3,403 | 1,645 |
| parking | 24,795 | 13,546 |
| waterfall | 464 | 182 |
| toilets | 3,228 | 1,421 |
| peak | 691 | 331 |
| viewpoint | 2,454 | 945 |
| observation-tower | 204 | 73 |
| historic | 6,795 | 2,390 |
| drinking-water | 1,002 | 420 |
| trailhead | 1,116 | 482 |
| cave | 23 | 9 |

**66,526 matches**, involving 30,420 mapped OSM objects; 13,683 records have at least one feature. These counts describe OSM objects and trail associations, not independently verified distinct facilities. Observation/watchtowers are not falsely classified as fire towers. Features retain source/licence, coordinates, part index, distance from the line and distance along retained parts. The 100 m threshold uses segments, including crossings; water polygons use shorelines. Proximity does not establish an accessible connecting path.

17,777 records have a majority-length mapped area; all containing area names remain searchable. Primary area selection favors coverage, then smaller bounding area. Polygon holes and osmium’s line-plus-polygon representations are handled. 27,594 have a mapped town/city/village point within 50 km of the stored start. The nearest-town comparison is bounded by the source extracts, not a road-distance calculation.

Difficulty basis: official 2,528; OSM 503; derived 24,337; unknown 226. The fallback is `sqrt(2 × gain_ft × distance_miles)` with documented Shenandoah bands and limitations. It requires complete DEM gain and only applies without an official/OSM rating; undecoded official rating codes withhold it. It measures exertion in the stored direction, not scrambling, exposure, conditions or a presumed return journey. All 27,594 records have complete DEM coverage; 11,430 have a nearby mapped end-based trailhead/parking match. 1,642 retain `no`/`private` access tags.

## Text and photos

11,715 records (42.5%) have attributed Wikipedia/Wikidata descriptions, labelled as trail, park or nearby feature. Explicit mapped identities are used; article titles are not guessed from trail names. Introductory Wikipedia extracts retain contributors, CC BY-SA 4.0 and revision links; Wikidata descriptions retain entity links and CC0.

6,773 records (24.5%) have photos: 23,679 attachments using 9,977 distinct Commons files, maximum six per record. Every stored image is a thumbnail within 300 m, with author/attribution, licence and Commons page link. Original-size URLs are never a fallback and no full-size originals were downloaded.

The final regional search requested 1,010 cells, with cached/successful responses for 1,008; 349 result lists saturated their 500- or fallback 100-file limit. The final stats retain 5 unresolved request entries: Wikidata replication lag and deferred Commons searches. Earlier refresh attempts also encountered HTTP 429. Full fetch and refresh evidence is preserved in `media-fetch-stats.json` / `media-refresh-stats.json`; the final run uses per-record cached credits, a request throttle, and a per-host stop on 429. Candidate photo metadata is capped at 30 per trail. Coverage is not exhaustive, and photos may show nearby places rather than current trail conditions.

No Mapillary stage was implemented or run; no token was configured. Missing linked descriptions, photos, features, ratings and areas remain unknown. In particular, River of Rocks has credited photos and mapped features but no linked encyclopedia description in this snapshot.

## Artifact and payload audit

| File | Bytes | Reference gzip bytes |
|---|---:|---:|
| `hikes.json` | 140,418,612 | 11,230,136 |
| `trails.geojson` | 204,575,063 | 33,326,667 |

`hikes.json` retains detail on disk; the list API projects summaries. Full features, area lists, descriptions, photo arrays, trailheads, conflicts and field provenance are omitted from lists; a credited thumbnail and searchable area names remain. Full detail is returned by ID. Batched geometry also omits enrichment arrays.

| API sample area | Records | JSON bytes | Reference gzip bytes |
|---|---:|---:|---:|
| Hawk Mountain | 64 | 128,786 | 12,071 |
| Ricketts Glen | 54 | 112,537 | 9,704 |
| Delaware Water Gap | 185 | 464,413 | 36,808 |
| NJ northwest | 1,519 | 3,326,924 | 238,826 |

Gzip numbers are reproducible compression references from the audit script, not a claim about every hosting/proxy configuration. The audit rejects missing source/photo licences, original image URLs, feature offsets beyond bounds, duplicate IDs, geometry/index mismatches, oversized photo lists, or leaked detail fields.

```text
4123141d5b94cf51c63eee5aca94921f0bcf2da2258eeb0e4704dcd4f0767646  /mnt/wsl/ogv-data/trails/2026-10-28-rich/hikes.json
0f7660dd29ef8997929cc7ec02e06d1119b8110306afb026b4a0b0d5678bfe43  /mnt/wsl/ogv-data/trails/2026-10-28-rich/trails.geojson
```

## Verification

- `npx tsc --noEmit` — passed.
- ESLint on every touched TS/TSX/MJS file — passed.
- `npx vitest run --maxWorkers=8` — 6,427 passed, 3 skipped, 573 passed files / 1 skipped file.
- `npm run build` — passed.
- Critical Explore (`explore`, `explore-browser`, `explore-catalog`) plus `hike-enrichment` — 8 passed on port 3342 against the production build. The new spec covers Waterfall/Views before paging and name grouping, unknown evidence, park aliases, and Back restoration.
- Real production browser on port 3341 with `OGV_HIKES_PATH` set to this catalog — passed for Hawk Mountain, Ricketts Glen and Delaware Water Gap, Day and Night at 393×852. No hike/geometry/media APIs were mocked. Actual photos loaded, metadata links returned 200, the NJDEP disclaimer was present, no page errors or horizontal overflow occurred.
- 26 final screenshots (lists in all three areas, filters, trail pages, feature lists and photos) are in `~/sol/shots/hike-enrich/`; `browser-evidence.json` records the six theme/area checks. Two earlier preview images are also present and are not the final evidence set.

## Local commits

- `2e67c567` feat(hikes): enrich trails with attributed OSM features and filters
- `19b58718` feat(hikes): add park context nearest towns and explained exertion
- `fe53f546` feat(hikes): merge open official trails by reciprocal geometry overlap
- `c796e247` feat(hikes): add credited Wikipedia text and Commons thumbnails
- `6e7c25a4` feat(hikes): extend the enriched catalog pipeline to New Jersey
- `79e29cbe` feat(hikes): ingest the explicitly public-domain PA DCNR portal release
- `0a67b1d2` fix(hikes): preserve park search matches and surface attributed trail facts
- `1ac56c11` fix(trails): retain park polygons when osmium also emits their outlines
- `d6221813` fix(trails): reuse Wikimedia records across batches and respect throttling

Bulk build/fetch/test logs remain under `/mnt/wsl/ogv-data/trails/`. The reusable job commands and attribution choices are documented in `infra/trails/README.md`. No dependencies were installed and no other process was terminated. Only this run’s own jobs/listener were stopped or restarted.
