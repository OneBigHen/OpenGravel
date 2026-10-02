# Seasonal Road Intelligence and the Interesting Road Corpus

Date: 2026-10-02  
Branch: `feat/seasonal-road-intelligence`

## Goal

Make OpenGravel unusually good at finding the roads a dual-sport rider actually cares about:

- gravel and unimproved township roads;
- Game Lands and state-forest roads;
- legal WMA roads;
- seasonal roads that are normally gated;
- roads with limited/no winter maintenance;
- interesting connectors between known-good riding corridors; and
- roads whose access changes on a useful calendar.

This is not a new routing engine. GraphHopper remains the path generator. OpenGravel owns the evidence, candidate discovery, legality/access checks, seasonal planning, and route selection.

The key product change is that a road opening is not merely a map-layer fact. It is a **planning opportunity**:

> "These three dirt roads are open this weekend. Can OpenGravel build me a 2-hour loop that uses the best two?"

## Product surface

### Explore -> Openings

This PR adds a third Explore lens alongside **Rides** and **Roads**:

- **Open now**
- **Open this weekend**
- **Opening within 7 days**
- **Later**
- **Seasonal · dates not published**

The rider explicitly taps **Show openings near me** before location is requested. The initial search is 100 miles / 90 days. Results are source-backed and never infer permission from gravel surface.

The important UX rule is:

**An unpublished seasonal window is interesting, not routable proof.**

A PGC road whose authority record says "seasonal" but gives no date appears under "dates not published." OpenGravel can surface it as a discovery lead, but it does not silently invent a hunting-season date.

### Near-term: "Plan this weekend"

The opening calendar should feed the existing planner/AI Advisor rather than become a dead-end event browser.

Target interaction:

1. Rider opens **Explore -> Openings**.
2. OpenGravel summarizes the most valuable openings near the rider.
3. Rider taps a road/opening.
4. Actions:
   - **Build me a loop**
   - **Use this road**
   - **Show on map**
   - **Save for weekend**
5. The planner asks for a route that overlaps the selected canonical road span.
6. The ordinary route-authority pipeline still verifies access and rejects a candidate that is closed.

The same action should be available from AI Advisor:

> "What opens around Hamburg this weekend?"

The answer should be deterministic data first. An LLM may explain the choices but may not invent opening dates or legal access.

### Later: seasonal-riding calendar

Do not build a generic month-grid first. Motorcyclists care about opportunity, not calendar chrome.

The useful calendar views are:

- **This weekend** — Friday evening through Sunday night.
- **Next 30 days** — opening/closing transitions.
- **Season timeline** — horizontal windows for saved roads/regions.
- **Saved area watch** — "Blue Mountain / Hamburg" or "Pine Barrens".
- **Closing soon** — useful because a road about to disappear for months is often more actionable than one opening later.

An iCalendar export can follow, but the in-app view should remain route-aware.

## Implemented data model

`MotorcycleAccess` now supports both:

1. recurring month/day seasons, such as USFS MVUM `05/15-12/15`; and
2. **absolute year-specific windows**, such as a DCNR road opened from a specific October date through a specific November date.

Absolute windows can declare `outsideWindowStatus: "closed"`, which lets an authoritative source say:

> normally closed, open only during these published windows.

This avoids the dangerous shortcut of converting a 2026 opening into a fake annual recurring season.

`buildRoadOpeningCalendar()` projects the same authority records the router uses into UI calendar events. There is no second calendar truth database.

## Source lanes

OpenGravel should keep two lanes conceptually separate.

### Lane A — authority/access

These can influence eligibility because they speak directly about legal/operational motor-vehicle access.

| Source | Region | Evidence | Role | Status |
| --- | --- | --- | --- | --- |
| USFS MVUM | US | legal motor-vehicle designation + seasons | access hard gate | existing |
| PA Game Commission Seasonal Roads | PA | open / seasonal / closed Game Lands roads | access hard gate / unpublished-season warning | **implemented here** |
| PA DCNR Roads Opened for Deer Season | PA | normally closed forest roads + exact opening windows | dated access hard gate + calendar | **implemented here** |
| NJ Fish & Wildlife WMA Roads | NJ | public / restricted / closed + surface | explicit closed/public access | **implemented here** |
| Wharton Visiting Vehicle Use Map | NJ | legal street-vehicle network + hunting-only roads | access authority | next |
| WZDx feeds | multi-state | closures/work zones | operational closure gate | existing |

Authority data remains fail-closed in the existing sense: **unavailable is unknown, never clear**.

### Lane B — road character / candidate evidence

These sources should make a road more or less interesting, but must not independently prove legal access.

| Source | Useful fields | Proposed use |
| --- | --- | --- |
| PennDOT PA Local Roads 2026_07 | `UNIMPROVED`, `GRAVEL_MIL`, owner, traffic | statewide PA candidate backbone |
| NJGIN NG911 | unimproved surface, status, access | existing Gravel Atlas / corroboration |
| NJ Statewide Trails | `MOTORIZED_USE_ALLOWED`, surface, difficulty, manager | discovery; verify access against stronger authority |
| OpenStreetMap | surface, tracktype, smoothness, access, motorcycle, barriers, conditional tags | graph character + evidence |
| OSM `winter_service` / `snowplowing` | no / limited winter maintenance | road-character signal, never legal access |
| PA Dirt & Gravel Road Studies Mapper | project/site history | corroboration and "likely gravel" signal |
| Gravelmap / Roostlocker / TNJT / PTRA GPX | rider-known corridors | low-weight route-corpus candidate source |
| recorded OpenGravel rides | actual rider traversal | strong recency/character evidence |

## Current official source endpoints

### Pennsylvania Game Commission

Layer:

`https://pgcmaps.pa.gov/arcgis/rest/services/PGC/Seasonal_Roads/MapServer/0`

Important fields:

- `SGL`
- `STNAME`
- `USE_TYPE`: administrative/closed, open, seasonal
- `SURFACE`
- `CONDITION`
- `MAINTENANC`
- `OWNER`
- `MOD_DATE`
- `NOTES`
- `CURRENT_`

The live adapter queries only current records and normalizes the authority's access code. Surface/maintenance text is kept as rider-readable context; later corpus ingestion should preserve those as structured road-character evidence too.

### Pennsylvania DCNR

Production layer:

`https://maps.dcnr.pa.gov/agsprod/rest/services/BOF/HuntStateForest/MapServer/9`

The layer is explicitly "Roads Opened for Deer Season" and describes state-forest roads normally closed to vehicle traffic.

Important fields:

- `Name`
- `DistrictNumber`
- `Date_Opened`
- `Date_Closed`
- `Date_ReOpened`
- `Date_ReClosed`
- `Notes`
- `Miles`

The adapter retains these as absolute windows. It does **not** turn them into an annual season.

### New Jersey Fish & Wildlife WMA roads

Layer:

`https://mapsdep.nj.gov/arcgis/rest/services/Features/Transportation/MapServer/23`

Important fields:

- `PRIMENAME`
- `SURFACE`: paved / unpaved
- `WMA_NAME`
- `DFW_ACCESS`: Public / Restricted / Closed / other
- `DFW_TYPE`
- `DFW_NOTES`
- `UPDATEDATE`

Policy is intentionally conservative:

- Public -> open evidence.
- Closed -> closed evidence.
- Restricted/other -> unknown, not automatically open or closed.

### PennDOT Local Roads — next candidate source

`https://mapservices.pasda.psu.edu/server/rest/services/pasda/PennDOT/MapServer/3`

The current 2026_07 layer includes `UNIMPROVED` and `GRAVEL_MIL` plus owner, traffic and other pavement-mileage fields.

This should replace the old 2012 statewide PA unpaved inventory as the primary **candidate generator**, subject to a fresh source-use/redistribution review. Runtime querying and derived canonical evidence are preferred over bundling source geometry.

### NJ Statewide Trails — next candidate source

`https://mapsdep.nj.gov/arcgis/rest/services/Features/Land_lu/MapServer/121`

Useful fields include:

- `MOTORIZED_USE_ALLOWED`
- `SURFACE`
- `TRAIL_DIFFICULTY`
- `PARK_NAME`
- managing/source metadata

Treat this as discovery evidence. "Motorized allowed" on a trail dataset does not by itself establish that a plated motorcycle may legally use the segment.

### Wharton State Forest — next access source

Official page:

`https://dep.nj.gov/parksandforests/wharton-state-forest-visiting-vehicle-use-map/`

The current Visiting Vehicle Use Map defines the legal vehicle network. The official page says it includes:

- 175.5 miles of unimproved roads open to all street-legal vehicles;
- 37.2 miles of additional unimproved hunting-access roads; and
- paved connecting roads.

The map is explicitly described as a living map. Do not scrape a one-time PDF and treat it as permanent. Build an updater that fingerprints the current source and requires a fresh provenance date.

### OSM winter character

Approved key:

`winter_service=no|limited|yes`

Also collect:

- `snowplowing=*`
- `surface=*`
- `tracktype=*`
- `smoothness=*`
- `seasonal=*`
- `access=*`
- `vehicle=*`
- `motor_vehicle=*`
- `motorcycle=*`
- `access:conditional=*`
- `motor_vehicle:conditional=*`
- `barrier=gate`

`winter_service=no` means no winter service. It does **not** mean the road is legal, gravel, or currently passable.

### PA Dirt & Gravel Road Studies

Public GIS:

`https://dirtandgravel.psu.edu/general-resources/gis/`

The program tracks more than 16,000 potential and completed project sites. Use it as corroboration, not as a legal-access authority.

## Interesting Road Corpus

The target should be one canonical road-segment identity with independent evidence dimensions, not a giant "gravel yes/no" table.

```text
CanonicalRoadSegment
  identity
    osm way/direction or stable canonical segment
    geometry fingerprint

  surface[]
    value
    confidence
    observedAt
    source

  access[]
    status
    windows
    restrictions
    observedAt
    source

  maintenance[]
    maintained / not-maintained
    winter_service
    observedAt
    source

  character[]
    forest
    game-land
    WMA
    mountain
    remote
    traffic
    curvature
    elevation

  riderEvidence[]
    riddenAt
    feedback
    GPX corpus overlap
```

A route request never becomes evidence that the road has the properties the request asked for.

## Candidate scoring

Do not make "interesting" one opaque scalar too early. Keep the evidence vector and use Pareto/regret selection already being built in OpenGravel.

Useful candidate dimensions:

- verified legal motorcycle access;
- exact seasonal-window availability on the planned date;
- gravel/dirt/unimproved probability;
- surface confidence and source diversity;
- continuity of the interesting section;
- unmaintained / limited-winter-service character;
- low traffic;
- curvature;
- elevation/grade;
- remoteness/scenery proxies;
- novelty to this rider;
- connection value to another good corridor;
- distance/time detour required to collect it.

A seasonal road should get a **temporary opportunity bonus** when its window is narrow:

```text
opportunity =
  access_is_open_on_planned_date
  * interesting_road_value
  * scarcity_of_open_window
```

This is deliberately not a hard "hunt-season bonus." The authority's actual dates are the input.

## Route generators this unlocks

1. **Weekend opening loop**  
   Collect the best currently-open seasonal roads within a rider's time budget.

2. **Closing-soon ride**  
   Prefer roads that will close before the next likely riding opportunity.

3. **Best-section mosaic**  
   Join high-value road sections from the corpus, using ordinary GraphHopper links between them.

4. **Missing-link discovery**  
   Search for unknown/unridden connectors between two high-confidence corridors.

5. **Departure-and-rejoin excursion**  
   Replace a dull section of a known ride with an interesting seasonal/gravel detour, then rejoin.

6. **Hamburg / Blue Mountain probe region**  
   Use Berks/Schuylkill Game Lands, PennDOT local-road surface evidence, OSM character and rider GPX overlap as a regression region.

7. **Pine Barrens legality-first probe region**  
   Use Wharton VVUM + NJ WMA roads + NJGIN before optimizing for sand/unpaved character.

## Calendar intelligence

The calendar should derive transitions from authority records:

- opens_at
- closes_at
- reopens_at
- recloses_at
- recurring season
- seasonal but dates unpublished

Derived rider labels:

- Open now
- Open this weekend
- Opens in N days
- Closes in N days
- Only N riding weekends left
- Seasonal · exact dates unavailable

The product should eventually calculate **riding weekends left**, because "closes November 22" is less actionable than "two weekends left."

## Planning for a future date

The current route-authority coordinator evaluates at the planning instant. Before a "Plan for Saturday" button passes a future date into eligibility, split future access evaluation from closure confidence:

- seasonal access/designations may be evaluated at the rider's selected date;
- explicit future closures may be evaluated at that date;
- absence of a future closure report must **not** be represented as "clear";
- operational feeds should remain unknown for future periods outside their stated coverage horizon.

Do not simply change one global `now()` to Saturday; that would create false certainty for future closures.

## Data refresh and caching

Recommended defaults:

- PGC roads: 24 h cache, 7 d stale fallback.
- DCNR opening schedule: 6 h cache during active hunting/opening periods, 48 h stale fallback.
- NJ WMA roads: 24 h cache, 7 d stale fallback.
- MVUM: existing weekly cell cache.
- PennDOT/NJ candidate corpora: scheduled snapshot builds, not per-route statewide calls.
- OSM road character: derive during graph/corpus builds.

The Openings API returns `private, no-store` because the request encodes the rider's approximate location.

## Safety / truth rules

1. Surface never proves access.
2. A GPX track never proves access.
3. "Seasonal" without dates never becomes an invented date.
4. Restricted access is unknown unless the restriction semantics are explicit.
5. A gate report is time-sensitive.
6. Source outage is unknown, never clear.
7. A future plan cannot claim future closure conditions are clear merely because today's feed is empty.
8. Every rider-facing opening shows provenance.
9. Exact access should be rechecked close to departure.
10. Runtime source use and redistribution terms are reviewed per source; do not assume a public ArcGIS endpoint grants bulk redistribution rights.

## Release plan

### Wave A — this PR

- [x] absolute dated access-window model;
- [x] calendar projection from route-authority records;
- [x] PA Game Commission seasonal-road adapter;
- [x] PA DCNR seasonal forest-road adapter;
- [x] NJ WMA road-access adapter;
- [x] register new access sources in route intelligence;
- [x] `/api/road-openings` bounded nearby endpoint;
- [x] Explore -> Openings lens;
- [x] Open now / weekend / next-seven-days / later / unpublished grouping;
- [x] unit coverage for parsers, calendar and dated hard gate.

### Wave B — candidate corpus

- [ ] PennDOT Local Roads 2026_07 adapter.
- [ ] Structured road-character evidence for PGC surface/maintenance.
- [ ] NJ Statewide Trails discovery adapter.
- [ ] OSM winter-service/tracktype/smoothness extraction.
- [ ] CDGRS corroboration adapter.
- [ ] Wharton VVUM structured updater.
- [ ] source-policy/licensing manifest for every corpus source.

### Wave C — route-space search

- [ ] canonicalize new source geometry onto OSM/GraphHopper road identity;
- [ ] expose seasonal opportunity as a candidate dimension;
- [ ] weekend-opening loop generator;
- [ ] closing-soon generator;
- [ ] corridor-prize and missing-link probes;
- [ ] Hamburg/Blue Mountain and Pine Barrens regression fixtures.

### Wave D — rider workflow

- [ ] tap opening -> Build me a loop;
- [ ] date-aware route-access evaluation with honest future-closure uncertainty;
- [ ] save road/region watches;
- [ ] "two riding weekends left" and opening-soon notifications;
- [ ] optional iCalendar export;
- [ ] map overlay for open / opens soon / closed / dates unknown.

## Acceptance gates

- A closed authoritative road can never become eligible because another source calls it gravel.
- A PGC seasonal road with no published dates appears in discovery but never as a dated event.
- A DCNR 2026 opening does not recur automatically in 2027.
- A NJ WMA road marked Restricted does not silently become open.
- Explore does not request geolocation until the rider asks for nearby openings.
- Source outages are visible and do not become empty/clear claims.
- Opening dates shown in UI are exactly the normalized authority dates.
- Route planning remains functional with all new sources unavailable.
- No generated/bulk source geometry is committed to the repository.


## Weekend rider intelligence: events.henning.rodeo + popular stops

The road-opening calendar is now the first half of a broader **Weekend** lens. The other half reuses OpenGravel's existing Places/Discover/ride-interest seams rather than inventing a new destination system.

### Provider wiring

OpenGravel's existing Places contract already expects:

- `GET /api/v1/places?bbox=...&kinds=happy_hour,event&when=week`
- `POST /api/v1/places/along`

The canonical rider-facing provider is `https://events.henning.rodeo`.

Configuration accepts either the older compatibility names:

```text
OGV_PLACES_API_URL=
OGV_PLACES_API_KEY=
```

or the clearer aliases:

```text
OGV_EVENTS_API_URL=https://events.henning.rodeo
OGV_EVENTS_API_KEY=
```

If only `OGV_EVENTS_API_KEY` is present, the canonical `events.henning.rodeo` origin is used. A public provider may omit the key; OpenGravel then omits the Authorization header. No URL and no key means the provider remains honestly unavailable rather than adding a hidden network dependency.

### Browse mode: a riding radius, not "nearby"

When there is no selected route, Weekend asks for location only after the rider taps the call to action.

Default radius: **100 miles**.  
Hard maximum: **125 miles**.

The external events/places provider is queried as bounded geographic tiles:

- each tile <= 1.45 degrees per side;
- <= 12 tiles per request;
- <= 3 upstream tile requests concurrently;
- final results are clipped to the actual circular rider radius;
- duplicates are removed by stable provider id.

The OSM Discover index is local/server-side and can scan the full radius without an upstream Overpass call.

This is intentionally not nearest-first. For a motorcycle rider, a worthwhile destination 45 miles away can be better than a generic venue 2 miles away.

### Route mode: the route becomes the search spine

When Explore opens, it checks for route context in this order:

1. the process-wide `PlanningSession` selected route;
2. the active Ride Focus pointer and its persisted route geometry;
3. no route -> location-based browse mode.

With a selected route:

- seasonal road openings: **15-mile corridor**;
- events / happy hours from events.henning.rodeo: **10-mile corridor**;
- OSM/Wikimedia Discover destinations: **7.5 km corridor**.

The tab loads immediately from the planned route; it does not request GPS again merely to find route-side opportunities.

A full reload deliberately does not recreate an old planning answer. PlanningSession is attempt state, not authored ride truth. An active Ride Focus route can still be recovered because its geometry pointer is explicitly persisted for navigation.

### Rider opportunity ranking

The unified list is deterministic and deliberately small: at most **8** suggestions.

Inputs:

- event urgency;
- event/provider `popular` flag;
- provider rating;
- rider-interest prior for the destination kind;
- route detour when a route exists;
- broad destination distance when browsing;
- multi-source / Wikidata notability for Discover places.

Useful high-prior static destinations include:

- waterfalls;
- covered/interesting bridges;
- viewpoints;
- quirky roadside places;
- ruins;
- scenic/natural destinations;
- museums/history when they are actually worth a stop.

In route mode, detour dominates:

- <= 3 min: strong boost;
- <= 8 min: useful boost;
- <= 15 min: near-neutral;
- > 25 min: strong penalty.

In browse mode there is a wide rider destination sweet spot. Roughly 25–80 miles away is not penalized simply because it is farther from the rider.

### Minimal-result rule

The Weekend lens must not become an event feed.

Diversity caps:

- maximum 4 events;
- maximum 2 happy-hour / food-drink opportunities;
- maximum 5 static destinations;
- repeated categories receive a penalty;
- final list is capped at 8 across all kinds.

The UI shows one **Things & places — Worth stopping for** section rather than separate feeds for every provider.

### Separation from routing truth

Events and destinations remain discovery/recon evidence only.

They **do not**:

- change Best Ride on their own;
- make a road legal;
- override a closure;
- prove surface or access;
- silently insert themselves into a route.

When the rider chooses a destination, it becomes an ordinary rider-authored stop/road-span request and the normal routing/authority pipeline applies.

This preserves the earlier OpenGravel rule: discovery may recommend; routing still proves the path.

### Next interaction work

The next small interaction layer should add three actions to an opportunity:

- **Add stop**
- **Build a loop through here**
- **Save for weekend**

Do not add another destination editor. These actions should dispatch the existing typed stop/route commands.

For time-bound events, a route-to-event action should also pass an arrival target through the existing arrive-by model so a "6 PM bike night" can shape departure time without giving the event provider any routing authority.
