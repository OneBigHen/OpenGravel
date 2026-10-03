# OpenGravel connector and surface inventory

Audit date: 2026-10-02  
Baseline: `main@87a7b8aad1ac4d788cd8ec6b9e22f0fb2b2de928`

This document is the connector/data-plane inventory for the stack-closeout campaign. It distinguishes code that exists from code that is configured, surfaced, authoritative, or actually production-ready.

## Status vocabulary

- **live**: implemented on `main`, composed into a rider-facing path, and usable when normal deployment requirements are met.
- **configured**: implemented and surfaced, but requires a key, local dataset, generated artifact, or explicit feature flag.
- **hidden**: implemented on `main` but not clearly surfaced or is off by default.
- **branch**: implemented outside `main`.
- **legacy**: existed in SwitchBack/opengravel-vnext but is not present in current OpenGravel.
- **spec**: documented target with no complete implementation.

## Routing, geocoding and basemaps

| Capability | Main implementation | Surface | Status | Closeout action |
| --- | --- | --- | --- | --- |
| GraphHopper primary routing | `src/infrastructure/routing/graphhopper/*`, `src/server/planning/plan-service.ts` | Planner, reroute, road match | live | Preserve as routing authority. Add provider health visibility. |
| Hosted GraphHopper fallback | `fallback-provider.ts` | planner fallback | configured | Document `GRAPHHOPPER_API_KEY` and hosted budget. Verify coverage/failure telemetry. |
| Photon geocoding | `src/infrastructure/geocoding/photon.ts`, `/api/geocode` | planner search, Home, reverse geocode | live | Add to provider inventory/health. |
| OpenFreeMap | `src/infrastructure/map/basemap.ts` | map default without Mapbox | live | Keep token-free fallback. |
| Mapbox Outdoors | same | optional basemap | configured | Correct docs that imply Standard v3 where implementation uses Outdoors v12 through MapLibre. |
| Mapbox satellite | same | satellite presentation | configured | Keep; make explicit basemap/preset model. |
| OSM raster | same | fallback basemap | live | Keep as fallback only. |
| Offline PMTiles/basemap | `src/server/offline/*`, `src/infrastructure/offline/*` | Settings / offline navigation | live | Extend manifest to carry connector snapshot/freshness metadata as authoritative layers become offline-capable. |

## Terrain and elevation

| Capability | Main implementation | Surface | Status | Closeout action |
| --- | --- | --- | --- | --- |
| Terrarium elevation | `src/infrastructure/elevation/terrarium-source.ts` | elevation profile + 3D terrain | live | Keep as global fallback. |
| USGS 3DEP topo products | none | none | spec | Build PA/NJ first: DEM derivatives, contours, hillshade, slope, grade. |
| Mapterhorn terrain | none on main | none | planned externally | Evaluate as higher-resolution US terrain source, but do not create a second untracked elevation truth path. |
| OpenGravel Topo | docs only | none | spec | Build one first-party topo composition from OSM vectors + 3DEP derivatives. |

## Traffic, weather and cameras

| Capability | Main implementation | Surface | Status | Closeout action |
| --- | --- | --- | --- | --- |
| TomTom route flow | `src/infrastructure/traffic/tomtom.ts` | route preparation | configured | Centralize key/config and provider health. |
| TomTom flow raster | `src/server/map-layers/handler.ts` | map | configured | Same provider registry as route flow. |
| TomTom incidents | `src/server/map-layers/providers.ts` | map | configured | Reconcile with normalized road-authority closure evidence. |
| NWS forecast | `src/infrastructure/weather/nws.ts` | route preparation | live | Unify transport/parsing with map-alert path. |
| NWS alerts | `src/server/map-layers/providers.ts` | map | live | Avoid duplicate independent NWS implementations. |
| State traffic cameras | `src/server/traffic-cameras/*` | map + playback | configured | Keep PA/NJ/NY/DE/MD/VA/WV/OH registry. Add source health and expiry diagnostics. |
| StormScope fallback | `src/server/traffic-cameras/stormscope.ts` | map fallback | configured/off by default | Keep as fallback only; show provenance. |
| Weather radar | none | none | spec | NWS radar GIS; timestamp every frame. |
| Active fire | none | none | spec | NASA FIRMS; never interpret hotspot as closure. |
| Air quality | none | none | spec | AirNow adapter; separate point AQI from smoke geometry. |
| Snow | none | none | spec | NOAA/NOHRSC or equivalent authoritative source. |
| Flood/water risk | partial NWS alert semantics only | none as dedicated layer | spec | Keep derived risk conservative; never infer road closure from watershed polygons. |

## Roads, access and authority

| Capability | Main implementation | Surface | Status | Closeout action |
| --- | --- | --- | --- | --- |
| Curvature catalogue | `src/server/roads/known-roads-db.ts` | routing evidence + Great Roads layer | configured | Missing DB must be visible in provider health instead of silently looking like zero good roads. |
| Gravel Atlas | same | routing evidence + gravel layer | configured | Same health/freshness requirement. |
| USFS MVUM | `src/infrastructure/route-intelligence/usfs-mvum/mvum-source.ts` | route legality/evidence | hidden/off by default | Expose same canonical records on map and in road detail. Do not rebuild a parallel MVUM layer. |
| USDOT WZDx registry | `src/infrastructure/route-intelligence/wzdx/*` | route work-zone evidence | hidden/off by default | Project canonical WZDx evidence into map conditions. |
| PA Turnpike WZDx | `src/server/planning/road-authority.ts` | route evidence | configured | Document key; expose provider status. |
| OSM construction | `src/server/map-layers/providers.ts` | map | live | Treat as supplementary context, not authoritative closure truth. |
| OSM public land | same | map | live | Replace US primary with PAD-US; retain OSM fallback/context. |
| OSM forest roads | same | map | live | Retain context, but distinguish from legal MVUM access. |
| PA DCNR seasonal roads | PR #60 | Explore/route authority work | branch | Finish UX integration and merge into canonical authority model. |
| PA Game Commission roads | PR #60 | same | branch | Same. |
| NJ WMA roads | PR #60 | same | branch | Same. |
| PennDOT local-road recon source | PR #60 | road discovery | branch | Validate source semantics/freshness before routing influence. |
| PASDA PA unpaved roads | legacy SwitchBack `src/lib/roads/pa-unpaved.ts` | legacy map/evidence | legacy | Port as supporting evidence, not sole gravel truth. |
| USFS roads/trails | none | none | spec | Ingest USDA EDW separate from MVUM designation. |
| Gates/access controls | none as unified layer | none | spec | OSM barriers + authority records with unknown preserved. |
| PAD-US | none | none | spec | Build official US public/protected-land layer. |
| private parcels | none | none | spec | Keep disabled until lawful, redistributable source exists. |
| road surface | evidence exists in routing/catalogues | no dedicated map layer | spec | Project canonical surface/confidence to map. |
| road grade | elevation machinery exists | no dedicated layer | spec | Derived, source-resolution disclosed. |
| fords/water crossings | none | none | spec | OSM ford + optional hydrology context. |

## Places, events and discovery

| Capability | Main implementation | Surface | Status | Closeout action |
| --- | --- | --- | --- | --- |
| Generic Places contract | `src/infrastructure/places/*`, `src/server/places/handler.ts` | planner/ride places | configured | Treat as provider-neutral boundary. |
| events.henning.rodeo | explicit in old vnext; PR #60 restores first-party semantics | Things/route opportunities | branch/configured | Make it the intended first-party provider without coupling UI vocabulary to provider. |
| OSM Discover index | `src/infrastructure/discover/osm-places-source.ts`, `infra/discover/*` | Ride Discover | configured | Automate index build/deploy and expose missing-index health. |
| Wikipedia/Wikidata/Commons | `wikimedia-source.ts` | Discover enrichment/photos | live | Keep as enrichment, not authority. |
| TomTom POI Search | `src/server/map-layers/providers.ts` | map fuel/food/coffee/etc. | configured | Fix displayed provenance: catalog currently claims OSM for layers served by TomTom. |
| Google Places | legacy SwitchBack | none | legacy | Do not restore by default. Re-evaluate only if first-party/OSM sources cannot meet rider-place quality. |
| web ride research / YOU API | legacy SwitchBack | none | legacy | Keep out of routing truth. Optional evidence enrichment only if restored. |

### Product projection required

One underlying place/road record may appear differently by context:

- **Explore / Ride**: motorcycle roads, legal trails, gravel/unimproved, seasonal windows, ready-made rides.
- **Explore / Things**: sparse rider-worthy events, destinations and stops over a broad radius.
- **Planned route / Along this ride**: detour-aware road/place/event opportunities.
- **Active ride**: at most one or two attention-worthy opportunities and never competing with guidance.

PR #60 already documents this direction; its temporary separate Openings lens should be folded into Ride before production merge.

## Community, local data and media

| Capability | Main implementation | Surface | Status | Closeout action |
| --- | --- | --- | --- | --- |
| Catalog routes | `data/catalog/routes.json.gz` | Explore | live | Add source-build provenance/freshness checks. |
| Community ratings/comments/condition reports | `src/server/contributions/*`, `RouteCommunity.tsx` | route detail | live/foundation | Verify moderation/abuse controls before broader exposure. |
| local ride history | IndexedDB/repositories | Roads/New to Me/personalization | live | Preserve local-first behavior. |
| Spotify native | `apps/ios/OpenGravelSpotify`, native bridge | Ride Focus | live | Open issue #11 is stale after merged #23/#26; regression-verify then close. |
| Spotify web | `src/server/spotify/*`, web player | Settings/Ride | live | Same. |
| cross-device encrypted sync | no complete OpenGravel main implementation | none | legacy/incomplete branch | Reuse proven SwitchBack concepts; do not build a second ad-hoc crypto scheme. |
| Passkey identity | absent from OpenGravel main | none | legacy | Evaluate with sync work; keep credential storage minimal. |
| telemetry destination | abstract bridge only | none | hidden | Decide whether hosted telemetry is needed. Do not imply PostHog exists on main. |

## Native/navigation

| Capability | Main implementation | Surface | Status | Closeout action |
| --- | --- | --- | --- | --- |
| Ferrostar/native iOS navigation | iOS package + `ferrostar-bridge.ts` | iPhone navigation | live foundation | Keep one OpenGravel route/session authority. |
| resume-mid-route recovery | merged PR #15 | Ride | live | Issue #9 is stale; regression-verify then close. |
| native/web screen choice | merged PR #16; stat strip #20 | Ride | live | Issue #10 is stale; regression-verify then close. |
| CarPlay | PR #46 | none production | branch | Merge only after entitlement/device verification and shared-session invariants pass. |
| Live Activity | native navigation package | native | built foundation | Verify lifecycle with reroute/resume/CarPlay. |

## Known implementation drift

### 1. Wrong stop-layer provenance

`src/application/map-layers/catalog.ts` says fuel/food/coffee/camping/lodging/repair/viewpoints are OpenStreetMap. The actual map-layer implementation in `src/server/map-layers/providers.ts` serves those through TomTom Search. Fix the UI source/caveat or change the provider; never knowingly display the wrong provenance.

### 2. Authoritative route data is weaker on the map

MVUM and WZDx can influence route evidence while the visible map presents OSM forest-road/construction approximations. The map, planner, Explore and Free Ride must project from the same normalized evidence records.

### 3. Silent configuration failures

Several local/configured sources deliberately degrade to empty/unavailable. That is correct for rider safety, but operators currently have no single view showing which sources are active. Build a provider registry + health endpoint before adding many more connectors.

### 4. Duplicate provider implementations

NWS and TomTom responsibilities are split across preparation, map-layer and tile paths. Preserve separate product queries where needed, but centralize provider identity, credentials, freshness and health.

### 5. Environment documentation is incomplete

Main code reads deployment settings that are missing or incomplete in `.env.example`, including at minimum:

```
TOMTOM_API_KEY
TOMTOM_TRAFFIC_API_KEY
OVERPASS_URL
NWS_USER_AGENT
OGV_DISCOVER_OSM_PLACES
WIKIMEDIA_USER_AGENT
OGV_ROAD_AUTHORITY
OGV_ROAD_AUTHORITY_CACHE_DIR
PTC_WZDX_API_KEY
CURVATURE_DB_PATH
GRAVEL_ATLAS_DB_PATH
GRAPHHOPPER_HOSTED_DAILY_BUDGET
```

PR #60 also introduces/aliases event-provider settings. The closeout campaign must make `.env.example` an authoritative deployment contract.

## Target rule

Every external dataset should have exactly one registered descriptor containing:

- stable provider/source id;
- authority class: regulatory / operational / community / derived / enrichment;
- facets supplied;
- coverage;
- configured/unconfigured state;
- freshness/TTL;
- current health;
- credentials/config keys;
- whether it affects hard routing policy;
- whether it may be shown on map;
- whether it can be cached/offlined;
- rider-facing attribution/caveat.

Product modules consume normalized evidence and capability state. They should not independently rediscover provider configuration.
