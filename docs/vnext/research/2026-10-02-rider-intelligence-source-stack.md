# Rider Intelligence Source Stack

Date: 2026-10-02  
PR: #60  
Status: working architecture

## Why this exists

OpenGravel should be aggressive about discovery and conservative about truth.

The same external source must not be allowed to become all of these at once:

- legal motorcycle-access authority;
- road-surface truth;
- evidence that a road is worth riding;
- popularity evidence;
- an event calendar;
- a routing instruction.

That coupling is how a harmless "motorized trail" tag turns into an unsafe motorcycle route.

This design keeps four lanes separate until OpenGravel deliberately combines them at the product layer.

```text
                  ┌────────────────────────────┐
                  │  1. Access authority       │
                  │  legal / seasonal / closed │
                  └──────────────┬─────────────┘
                                 │ hard gate
                                 ▼
Road recon ───────────────► Canonical road identity ◄──────── Rider history
(candidate evidence)               │
                                   │ character/value
                                   ▼
                            Ride opportunity
                                   │
                                   │ rider chooses
                                   ▼
                              Route planner

Durable destinations ────┐
                         ├────► Things / Along this ride / Ride Interest
Time-bound events ───────┘
```

## Lane 1 — access authority

Only sources that actually describe motor-vehicle/motorcycle access belong here.

| Source | Coverage | What it may prove | Runtime treatment |
| --- | --- | --- | --- |
| USFS MVUM | USFS lands | designated motor-vehicle use + seasons | hard gate |
| PA Game Commission Game Lands roads | PA | open / closed / seasonal vehicle road | hard gate / seasonal warning |
| PA DCNR seasonal forest roads | PA | exact temporary vehicle-opening windows | hard gate + calendar |
| NJ Fish & Wildlife WMA roads | NJ | explicit public / closed WMA-road access | hard gate where semantics are explicit |
| Wharton Visiting Vehicle Use Map | Wharton, NJ | designated legal street-vehicle network | planned P0 adapter |
| Bald Eagle Dual Sport system | PA | explicit licensed-motorcycle roads/trails + season | planned managed-area authority |
| Catawissa South | PA | permitted dual-sport-only seasonal system | planned managed-area authority |

Rules:

1. Source outage is unknown, never clear.
2. A dated 2026 opening does not automatically recur in 2027.
3. "Seasonal" without dates stays undated.
4. "Motorized" does not mean "motorcycle" unless the authority actually says so.
5. Surface evidence never overrides an access closure.

## Lane 2 — road recon

Recon sources answer:

> "Is this road/trail worth investigating?"

They cannot independently answer:

> "May a plated motorcycle legally ride it?"

### Implemented

#### PennDOT Local Roads 2026

Adapter: `pa-penndot-local-roads-2026`

Signals:

- `GRAVEL_MIL > 0`
- `UNIMPROVED > 0`
- road owner
- traffic count
- geometry

Important semantic decision:

PennDOT's gravel/unimproved mileage belongs to the local-road record. It is **not treated as a meter-by-meter classification of every point in the returned geometry**.

The adapter therefore emits:

- `gravel-present`
- `unimproved-present`

not "this entire line is gravel."

That record must be canonicalized to OpenGravel road segments and corroborated before becoming strong surface evidence.

#### NJ Statewide Trails

Adapter: `nj-statewide-trails-recon`

Candidate filter:

- `MOTORIZED_USE_ALLOWED = Y`

Useful attributes:

- paved/unpaved surface
- trail difficulty
- park
- manager
- source method
- source age

NJ explicitly describes the statewide layer as a compiled dataset accepted as-is and not field-verified. It therefore stays recon-only.

`MOTORIZED_USE_ALLOWED=Y` is **not** mapped to motorcycle access.

### Next recon sources

#### OpenStreetMap road character

Build-time extraction should retain:

- `surface`
- `tracktype`
- `smoothness`
- `winter_service`
- `snowplowing`
- `seasonal`
- `barrier=gate`
- `access`
- `vehicle`
- `motor_vehicle`
- `motorcycle`
- conditional access tags

Access tags can corroborate authority, but ambiguous OSM tags do not outrank an official closure/designation.

#### PA Dirt & Gravel Road Studies

Use as corroboration that a road has historically had dirt/gravel-road work.

Do not treat a project site as legal motorcycle access.

#### Explore PA Trails

Potential candidate source only until its trail-use relationships are resolved to an explicit motorcycle-compatible use.

Its published terms also need a source-policy review before OpenGravel bundles any bulk extract.

#### Scenic byways / known rider roads

Useful character evidence and ready-made-riding-area seeds.

Never legal-access authority.

## Canonicalization before scoring

Road recon should not render raw GIS polylines directly as the final road model.

Target pipeline:

```text
source geometry
    │
    ▼
candidate road span
    │
    ├─ name normalization
    ├─ geometry fingerprint
    ├─ GraphHopper / OSM edge overlap
    ├─ direction independence
    └─ split at material evidence changes
    │
    ▼
CanonicalRoadSegment
    │
    ├─ source evidence[]
    ├─ access evidence[]
    ├─ rider traversal[]
    └─ derived character[]
```

A source can cover only part of a named road. Splitting evidence by actual overlap prevents "one gravel mile" from coloring a ten-mile road gravel.

## Lane 3 — durable rider destinations

This is the static-ish "Things worth riding to" corpus.

### OpenStreetMap

Already implemented as a regional build, not runtime Overpass.

Strengths:

- unusual mapped features;
- waterfalls;
- covered bridges;
- viewpoints;
- ruins;
- trailheads;
- campsites;
- mapped tags and Wikidata links.

### Wikimedia / Wikidata / Commons

Already implemented.

Best role:

- notability;
- explanation;
- structured facts;
- properly attributed image.

Do not use Wikipedia presence as a popularity metric.

### Overture Places

Added in this PR as a **regional build-time index**.

Why:

- very broad POI coverage;
- stable source IDs;
- source confidence;
- permissive Places licensing;
- no need for a live paid lookup on every Explore open.

Current build is deliberately conservative:

- museum
- history / landmark
- ruins / archaeological
- waterfall
- viewpoint / observation
- cave / natural formation
- lighthouse
- roadside/tourist attraction
- campground
- state/national park / reserve
- trailhead

Ordinary restaurants and businesses are intentionally excluded from the static Discover index.

### Overture schema pinning

The September 2026 release removed the old `categories` field in favor of:

- `basic_category`
- `taxonomy`

The regional builder is pinned to an explicit release/schema pair:

```text
OVERTURE_RELEASE=2026-09-23.1
OVERTURE_SCHEMA=v2.0.0
```

A release bump requires reviewing the build mapper.

Runtime never queries global Overture.

### Build model

```text
Overture GeoParquet (cloud)
           │
         DuckDB
           │ bbox PA/NJ/nearby region
           ▼
 regional GeoJSONSeq
           │
  conservative category mapper
           ▼
 overture-places.json
           │
   local coarse-grid index
           ▼
      DiscoverSource
```

This matches the existing OSM local-index architecture.

## Lane 4 — time-bound events and specials

The correct architecture is:

```text
ECEA ──────────────┐
AMA ───────────────┤
PA DCNR events ────┤
NJDEP park events ─┤
NPS / RIDB ────────┤
generic event APIs ┤
club calendars ────┤
                   ▼
           events.henning.rodeo
              normalization
              dedupe
              geocoding
              freshness
              provenance
                   │
         Places contract /api/v1
                   │
                   ▼
              OpenGravel
```

OpenGravel should **not** contain six web scrapers.

The events service owns provider quirks and emits one stable contract.

### Priority sources

#### P0 — motorcycle-specific

1. **ECEA**
   - Dual Sport
   - Enduro
   - Hare Scramble
   - special motorcycle events
   - public subscribe/calendar surface

   Its event taxonomy is inherently relevant to OpenGravel riders.

2. **AMA National Dual-Sport / AMA event finder**
   - sanctioned recreation events;
   - strong source classification;
   - useful nationwide expansion path.

3. **Local club calendars**
   - high relevance;
   - may contain registration/detail information earlier than aggregators.

Motorcycle-specific source data gets an explicit `motorcycle_specific=true` or normalized rider tag.

It is not inferred merely because an event name happens to contain "bike."

#### P1 — land/destination calendars

- PA DCNR Events
- NJ State Parks / Forests events
- NPS events
- Recreation.gov RIDB events

These can make an excellent ride destination, but they should normally rank below a strong motorcycle event with equal timing/detour.

#### P2 — generic event coverage

Examples:

- Ticketmaster
- PredictHQ
- other local event providers

Use these to fill geographic/category gaps.

Do not let them dominate the rider feed.

## Places contract — per-item provenance

This PR extends the provider-neutral Places contract additively with:

```text
source_id
source_label
source_url
motorcycle_specific
tags[]
```

Why:

A provider-wide attribution such as "events.henning.rodeo" is insufficient for ranking.

OpenGravel needs to know that one event came from ECEA and another from a generic commercial event source without coupling UI code to either provider.

Example:

```json
{
  "kind": "event",
  "name": "Hammer Run National Dual Sport",
  "source_id": "ecea",
  "source_label": "ECEA",
  "source_url": "https://ecea.org/...",
  "motorcycle_specific": true,
  "tags": ["dual-sport", "adventure-ride"]
}
```

## Event identity / dedupe upstream

`events.henning.rodeo` should preserve every source record but expose one canonical occurrence.

Recommended model:

```text
EventOccurrence
  canonical_id
  normalized_name
  starts_at
  ends_at
  timezone
  venue
  coordinate
  category
  motorcycle_specific
  tags[]

  sources[]
    source_id
    source_record_id
    source_url
    fetched_at
    source_priority
```

Candidate dedupe key:

1. exact provider alias if already linked;
2. same normalized name + same venue + overlapping occurrence time;
3. fuzzy name + nearby coordinate + same local date;
4. otherwise separate.

Do not dedupe two separate runs/classes at the same venue solely by location/date.

## Event freshness

Suggested cadence:

| Source | Fetch cadence | Stale tolerance |
| --- | ---: | ---: |
| ECEA / club calendar | 6 h | 24 h |
| AMA schedules | daily | 72 h |
| PA/NJ park calendars | 6–12 h | 24 h |
| NPS / RIDB | 12 h | 48 h |
| generic event APIs | 1–6 h | provider-specific |
| one-off HTML source | daily | visible stale marker |

Cancellation should propagate quickly. A cancelled event is more harmful than a temporarily missing event.

## Rider opportunity ranking

The source architecture feeds a deterministic ranker.

### Global Things mode

```text
score =
    rider-category prior
  + motorcycle-specific bonus
  + time relevance
  + actual popularity/rating evidence
  + source corroboration
  + destination distance sweet spot
  - stale/uncertain penalties
```

Distance is not nearest-first.

A destination 25–80 miles away can be ideal because the travel itself is the product.

### Planned-route mode

```text
score =
    rider value
  + motorcycle-specific bonus
  + timing fit
  + on-route / small-detour bonus
  - detour cost
  - stale/uncertain penalties
```

This PR now accepts:

- `routeDistanceMeters`
- `routeDurationSeconds`
- `departAt`

When a provider supplies `routeMile`, OpenGravel estimates arrival at that event.

Known-to-be-ended-before-arrival events are removed rather than merely ranked lower.

That is materially better than "event is within 10 miles of the route."

## Popularity is evidence, not a guess

Acceptable popularity inputs include:

- explicit provider popularity/rating;
- repeated rider visits/traversals;
- multiple independent rider-route-corpus overlaps;
- actual event-series significance;
- source-specific attendance/rank when its semantics are documented.

Do **not** treat these as popularity:

- Overture confidence;
- presence in Wikipedia;
- OSM feature existence;
- search-engine prominence;
- source count by itself.

Those signals can improve confidence/notability, not social popularity.

## Riding-area clustering

The Ride feed should eventually group dense candidate roads into useful riding areas.

Example:

```text
Hamburg / Blue Mountain
  9 interesting road sections
  4 currently open seasonal roads
  31 mi likely gravel/unimproved
  2 access records need verification
```

Proposed clustering:

1. canonical road sections only;
2. spatial graph or HDBSCAN-like clustering using road endpoints/centroids;
3. require meaningful total rideable length;
4. derive label from known geographic features/towns only after cluster exists;
5. store cluster membership as derived data, never as road evidence.

A cluster should not become a routing destination until the rider asks to ride there.

## Storage / serving recommendation

For the PA/NJ-first stage, keep the stack boring.

### Build time

Use:

- DuckDB for GeoParquet extraction/transforms;
- osmium for OSM filtering;
- small Node build scripts for normalization;
- SQLite/RTree or compact JSON/grid indexes for runtime serving.

### Runtime

Use:

- local regional indexes;
- bounded bbox/corridor queries;
- source TTL caches;
- no global Overpass;
- no global Overture scans;
- no live N-provider fan-out from the browser.

### Do not add PostGIS yet

PostGIS becomes justified when OpenGravel needs:

- multi-region server-side spatial joins over millions of mutable user records;
- concurrent write-heavy social data;
- complex server-side polygon/route analytics that no longer fit build-time indexes.

The current road/destination workload does not require that operational burden.

## Privacy

- Global Explore location is requested only after rider intent or existing granted permission.
- Server queries use only the spatial precision needed for the source.
- Route-mode opportunity search requires route geometry, not continuous rider GPS.
- Active Ride Interest uses the existing bounded ahead-of-rider flow.
- External static providers should not receive precise continuous rider movement.

## Source policy manifest

Every new adapter should document:

```text
source id
owner
purpose:
  access-authority | road-recon | destination | event

authority semantics
refresh cadence
stale policy
coverage
redistribution terms
runtime vs build-time
fields consumed
known ambiguity
failure behavior
```

A source may appear in more than one purpose only when the semantics are independently justified.

## Immediate next implementation sequence

1. Canonicalize PennDOT/NJ recon records against OSM/GraphHopper edge identity.
2. Build a regional Overture PA/NJ + neighboring-state index.
3. Wire `events.henning.rodeo` to emit per-item provenance and motorcycle tags.
4. Add ECEA as the first P0 motorcycle event source upstream.
5. Add PA DCNR and NJ park calendars as P1 destination-event sources.
6. Add managed motorcycle areas (Bald Eagle, Catawissa) as explicit access authorities.
7. Implement Wharton VVUM source.
8. Fold the experimental Openings/Weekend tab into Explore -> Ride.
9. Build Explore -> Things from `/api/rider-opportunities`.
10. Build lazy planned-route -> Along this ride.
