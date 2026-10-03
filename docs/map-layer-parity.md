# Map layer parity: Gaia GPS / GOAT Maps benchmark and OpenGravel implementation plan

Status: implementation work order  
Target: OpenGravel mainline  
Reference implementation: OneBigHen/switchback legacy layer studio  
Research date: 2026-09-29

## Objective

Make OpenGravel's map useful enough for real ADV, dual-sport, gravel, and backroad planning that a rider does not need to open Gaia GPS or GOAT Maps just to answer:

- What does the terrain actually look like?
- Is this road paved, gravel, rough, seasonal, or probably gated?
- Is this road legal for a motorcycle?
- Whose land am I on?
- Is a forest road or trail designated for motorized use?
- Is weather, smoke, fire, flooding, snow, or traffic likely to affect this ride?
- Will I have mobile coverage?
- Can I keep the useful layers offline?

This is **functional parity**, not a requirement to clone every regional map in Gaia's 300+ source catalog. OpenGravel should cover the high-value outdoor map capabilities relevant to motorcycles, then exceed the general-purpose outdoor apps with rider-specific road intelligence.

## Competitive benchmark

### Gaia GPS

Current Gaia functionality relevant to OpenGravel:

- Gaia Topo plus satellite, hi-resolution satellite, recent satellite and many regional topo sources.
- Popular overlays include USFS MVUM, USFS Roads and Trails, Private Land, Public Land and Slope Angle.
- Adventure Modes expose activity-oriented map stacks such as Off-Road and Snow instead of forcing every user to build a layer stack manually.
- Custom mode allows multiple active layers, opacity controls and reordering.
- Layered map downloads retain multiple sources for offline use.
- Other catalog capabilities include wildfire, cell coverage, weather, air quality, snow depth/forecast, avalanche, geology and many specialized regional sources.

Official references:
- https://help.gaiagps.com/hc/en-us/articles/360036704533-Add-and-Manage-Overlays-MVUM-Private-Lands-Public-Lands-etc
- https://help.gaiagps.com/hc/en-us/articles/115003640128-Add-Layer-and-Change-Map-Sources-in-the-iOS-app
- https://help.gaiagps.com/hc/en-us/articles/360047131513-Download-Maps-for-Offline-Use
- https://help.gaiagps.com/hc/en-us/articles/39618062885655-Using-Adventure-Modes-on-gaiagps-com

### GOAT Maps

Current GOAT functionality relevant to OpenGravel:

- Topo, Satellite and Hybrid basemaps.
- Recent satellite imagery with "Most Recent" and cloud-reduced variants.
- Public land and private land ownership.
- Slope angle shading.
- Offline topo/satellite and offline-capable overlays.
- USFS Motor Vehicle Use Map.
- Historic wildfire overlays.
- USFS timber harvest history.
- Explicit separation between basemaps, overlays and user data.

Official references:
- https://www.goatmaps.com/
- https://help.goatmaps.com/hc/en-us/articles/41987112548755-How-to-configure-the-map
- https://help.goatmaps.com/hc/en-us/articles/38060370375315-Downloading-Maps

## What OpenGravel already has

Do not rebuild these from scratch:

### Existing map / view capabilities

- Mapbox Outdoors support when configured.
- OpenFreeMap fallback.
- Satellite rendering path.
- 3D terrain using Terrarium elevation.
- Offline OSM-derived vector basemap support.

### Existing rider layers

- Traffic flow.
- Live traffic incidents and closures.
- NWS weather alerts.
- Mapped construction.
- Great-road curvature.
- Gravel Atlas.
- Fuel, food, coffee, camping, lodging, repair and viewpoints.
- OSM protected/public-land context.
- OSM forest-road context.
- OSM cell towers.

### Existing authoritative access pipeline

OpenGravel already has a strong USFS MVUM ingestion implementation at:

`src/infrastructure/route-intelligence/usfs-mvum/mvum-source.ts`

That adapter uses the USDA Forest Service Enterprise Data Warehouse MVUM service, parses vehicle class and seasonal windows, and treats missing coverage as unknown rather than prohibited.

**The display layer must reuse this authority model. Do not build a second MVUM implementation from Overpass or OSM tags.**

Official USDA source:
- https://apps.fs.usda.gov/arcx/rest/services/EDW/EDW_MVUM_01/MapServer

The same USDA service explicitly describes vehicle classes and seasons of use, and the national Forest Service road/trail services are kept current from forest source geodatabases:
- https://apps.fs.usda.gov/arcx/rest/services/EDW/EDW_RoadBasic_01/MapServer
- https://apps.fs.usda.gov/ArcX/rest/services/EDW/EDW_TrailNFSPublishWithDataStatus_01/MapServer

## Product direction

OpenGravel should not become a GIS layer dump.

The rider-facing model is:

1. Pick a **map**: Road, Topo, Satellite, Hybrid, Recent Satellite.
2. Pick a **riding mode**: Road, ADV/Gravel, Forest/Backcountry, Weather.
3. Optionally open **Advanced layers** for full control.
4. Every overlay states its source, freshness, coverage and limitations.
5. Route-critical access information is visually stronger than decorative/context layers.
6. Dynamic layers fail honestly and never imply "clear" when a provider is unavailable.
7. Static/open datasets should become offline-capable whenever licensing and storage permit it.

## Basemap and topography parity

### P0 — OpenGravel Topo

Create an OpenGravel-owned topo presentation rather than relying on a provider style as the only terrain view.

Composition:

- OSM-derived roads/labels from the existing OpenGravel vector pipeline.
- USGS 3DEP-derived hillshade.
- USGS 3DEP-derived contours.
- Elevation tint only at low zoom / regional view.
- Trail and unpaved-road styling tuned for motorcycles rather than hiking.
- Forest boundaries and public-land tint kept quiet enough that the route remains dominant.
- High-contrast road casings at navigation zoom.

USGS 3DEP supports contours, hillshade, multidirectional hillshade, slope, aspect and elevation-tinted hillshade:
https://www.usgs.gov/3d-elevation-program/about-3dep-products-services

Implementation target:
- Generate/store terrain-derived products for offline regions instead of issuing expensive client-side DEM analysis.
- PA/NJ can be the first production region, then expand with the existing regional build pipeline.

### P0 — Contours

New overlay id: `contours`

- Source: USGS 3DEP derivatives.
- Type: raster or vector contour tiles depending build output.
- Offline: yes.
- Default: enabled in Topo preset; hidden in Road/Satellite.
- Zoom: visible from roughly z10; labels from z12+.
- Do not let contour labels compete with maneuver labels or route shields.

### P0 — Hillshade / relief

New overlay id: `hillshade`

- Source: 3DEP in the US; existing Terrarium fallback elsewhere.
- Offline: yes where region pack contains DEM/derived tiles.
- Rendering: preferably multidirectional hillshade for planning, simpler hillshade for low-power navigation.
- Must work independently from 3D camera tilt.

### P0 — Slope angle

New overlay id: `slope-angle`

- Source: 3DEP-derived slope.
- Offline: yes.
- Use case: not avalanche-oriented marketing; rider use is recognizing steep terrain, shelf roads, difficult approaches and likely drainage/grade problems.
- Default opacity: low.
- Provide a compact legend.
- Never imply that slope raster equals road grade.

### P1 — Aspect

New overlay id: `aspect`

- Source: 3DEP-derived aspect.
- Offline: yes.
- Useful mostly for snow/ice persistence, sun exposure and seasonal shoulder rides.
- Advanced layer only; not a quick toggle.

## Basemap parity

Add explicit basemap presets:

### Road

- Existing clean road-first vector map.
- Route and road names prioritized.
- Minimal terrain shading.

### Topo

- OpenGravel Topo composition above.
- Contours + hillshade default on.
- Trails/forest context visible.

### Satellite

- Existing satellite source where licensed/configured.
- Route casing and labels preserved over imagery.

### Hybrid

- Satellite imagery + OpenGravel roads/labels + route.
- This is not "satellite plus every vector layer"; keep labels selective.

### Recent Satellite

New premium/experimental-style capability, but do not couple it to a billing model.

Preferred architecture:
- Copernicus Sentinel-2 L2A through Copernicus Data Space STAC / Sentinel Hub interfaces.
- Server-side mosaic generation, never credentials in the client.
- Two variants:
  - Most recent acceptable scene.
  - Cloud-reduced recent mosaic.
- Show capture date in layer details.
- No offline promise in v1.

Official Copernicus APIs:
- https://documentation.dataspace.copernicus.eu/APIs.html
- https://dataspace.copernicus.eu/analyse/apis/catalogue-apis

GOAT updates its recent satellite offering on approximately a two-week cadence; OpenGravel does not need to claim faster refresh unless our actual mosaic pipeline proves it.

## Land and access parity

### P0 — Official public land

Replace the current OSM-only `public-land` implementation with an authority-aware merge:

1. USGS PAD-US primary for US public/protected land.
2. OSM protected areas as supplementary context and non-US fallback.

PAD-US is the USGS national inventory of protected areas and public open space:
https://www.usgs.gov/data/protected-areas-database-united-states-pad-us-4

Layer behavior:
- `public-land`
- show managing agency when available.
- distinguish federal/state/local/other ownership with subtle patterns or outlines.
- offline: yes after national/state preprocessing to PMTiles/GeoParquet-derived tiles.
- caveat: public ownership does not mean motor vehicle access.

### P0 — Official MVUM motorcycle access

New layer id: `mvum`

Reuse `createMvumSource` and its normalized `RoadAuthorityRecord` output.

Render:
- Open to highway-legal vehicles / motorcycles, year-round.
- Seasonal access.
- Special designation.
- Closed-to-motorcycle where authoritative records explicitly support that interpretation.
- Unknown/coverage gap must never be painted as closed.

Feature card:
- road/trail name or FS number.
- allowed vehicle class.
- season windows.
- forest/unit.
- source freshness.
- "Designation is legal access, not a guarantee of passable conditions."

Offline:
- yes for downloaded regions after ingestion/snapshotting.
- cache a source snapshot and include fetched-at/version metadata.

### P0 — USFS Roads and Trails

New layer ids:
- `usfs-roads`
- `usfs-trails`

Source:
- USDA EDW National Forest System Roads.
- USDA EDW National Forest System Trails.

These are separate from MVUM:
- Roads/trails answer "what exists?"
- MVUM answers "where motorized use is designated and under what restrictions?"

Do not merge them into one ambiguous "forest roads" toggle.

### P0 — Gates and access controls

New layer id: `access-controls`

Merge:
- OSM barrier=gate/lift_gate/swing_gate and access/motor_vehicle tags.
- USFS road closure/status attributes where authoritative and usable.
- Existing route-intelligence authority results when they carry an access-control record.

Display:
- gate icon at high zoom.
- color based on known access semantics.
- "unknown" is neutral, not red.

### P1 — Wilderness / restricted areas

New layer id: `restricted-areas`

Sources:
- PAD-US designation/management categories.
- federal wilderness boundaries.
- agency-specific closure polygons when an authoritative feed exists.

Goal:
- make areas where motorized travel is categorically restricted obvious before the rider plans deep into them.

### P1 — Private land

New layer id: `private-land`

Do **not** label OSM `access=private` as parcel ownership.

Architecture:
- provider interface supports parcel datasets, but this layer remains disabled unless an actual parcel/ownership source is configured.
- state/county open cadastral data may be ingested regionally where terms permit.
- a future commercial nationwide provider can implement the same interface without rewriting UI.
- show owner names only when source terms explicitly permit redistribution/display.
- offline eligibility is source-specific.

This is the one major area where Gaia/GOAT may have licensed nationwide data that OpenGravel cannot honestly duplicate using OSM alone.

## Road intelligence layers that should beat Gaia/GOAT

These are the differentiators.

### P0 — Surface

New layer id: `road-surface`

Sources:
- OSM `surface`, `tracktype`, `smoothness`, `highway`.
- OpenGravel Gravel Atlas evidence.
- graph evidence already produced during routing.

Render a road texture rather than loud categorical colors:
- paved.
- gravel.
- dirt/earth.
- unimproved/track.
- unknown.

Feature card must expose source/confidence.

### P0 — Road difficulty

New layer id: `road-difficulty`

Derived, not authoritative:
- surface.
- smoothness/tracktype.
- width/road class.
- local terrain slope near road.
- known seasonal/access metadata.
- optionally historical OpenGravel ride traces once privacy-safe aggregate evidence exists.

Output:
- Easy / rough / technical / unknown as descriptive map context.
- Never silently feed this display classification into route legality.

### P0 — Curvature / great roads

Keep existing `great-roads`, but make it composable with surface and grade.

### P1 — Road grade

New layer id: `road-grade`

Derived by sampling the route/road geometry against the same elevation source used by routing.

Render only above a threshold at useful zoom.
Feature card:
- approximate max grade.
- direction-sensitive grade when a route direction exists.
- elevation sampling resolution.

### P1 — Fords / water crossings

New layer id: `water-crossings`

Sources:
- OSM ford=* / highway=ford.
- bridge/culvert context.
- optionally USGS stream gauge context nearby.

Motorcycle value is high; visual density is low.

### P1 — Seasonal / unmaintained

New layer id: `seasonal-roads`

Sources:
- USFS management/MVUM records.
- OSM seasonal, winter_service, smoothness, tracktype where appropriate.
- state/local authority feeds only when semantics are explicit.

This is evidence, not a promise that a road is open today.

## Conditions parity

### P0 — Radar

New layer id: `weather-radar`

Source:
- NWS public GIS / radar OGC services.

NWS states radar products are available as OGC-compliant services:
https://radar.weather.gov/locations
https://www.weather.gov/gis/cloudgiswebservices

Behavior:
- animated frames are optional; first implementation can be latest mosaic.
- route must remain visible over radar.
- timestamp required.
- cache briefly.
- online only.

### P0 — Active fires

New layer id: `active-fire`

Source:
- NASA FIRMS VIIRS (NOAA-20 and NOAA-21 preferred).
- hotspot age/confidence shown.

NASA FIRMS provides APIs plus WMS/WFS and near-real-time detections:
https://firms.modaps.eosdis.nasa.gov/web-services/
https://firms.modaps.eosdis.nasa.gov/api/

Do not represent a hotspot pixel as a legal closure or precise fire perimeter.

### P1 — Fire perimeters / historic fires

New layer ids:
- `fire-perimeters`
- `historic-fires`

Goal:
- current perimeter if a suitable authoritative source is available.
- historic burn areas as context for scenery, washouts and regrowth.

GOAT currently exposes historic fires, so this is a parity item.

### P0 — Air quality / smoke

New layer id: `air-quality`

Use the AirNow API integration already available to the project for current AQI.
Official API:
https://docs.airnowapi.org/webservices

If smoke plume geometry is added later, keep it a separate `smoke` overlay rather than pretending point AQI is a continuous raster.

### P1 — Snow

New layer id: `snow-cover` or `snow-depth`

Useful for shoulder-season mountain riding, not a default motorcycle layer.

Source should be NOAA/NOHRSC or another authoritative national feed.
Do not ship until source and refresh semantics are explicit.

### P1 — Flood / water risk

New layer id: `flood-risk`

Combine only well-defined signals:
- NWS flood alerts.
- water forecast/gauge products where available.
- known ford points.

Avoid building a false "road flooded" conclusion from a watershed polygon.

## Connectivity parity

### P0 — Mobile coverage

Replace the current `cell-towers` layer as the primary connectivity product.

New layer id: `cell-coverage`

Source:
- FCC National Broadband Map mobile coverage downloads.
- Preprocess provider/state coverage into low-zoom-friendly tiles.

FCC mobile coverage data are available as GIS datasets, including H3 representations:
https://help.bdc.fcc.gov/hc/en-us/articles/43909220634651-How-to-Download-Mobile-Broadband-Coverage-Data-from-the-FCC-s-National-Broadband-Map-Step-by-Step-Instructions

UX:
- All-carrier summary by default.
- carrier-specific filter in Advanced.
- 4G/5G distinction only if supported by the dataset.
- label the data date prominently.
- keep `cell-towers` only as an advanced diagnostic layer.

Offline:
- yes for downloaded regions after preprocessing.

## Useful context layers

Retain existing:
- fuel.
- food.
- coffee.
- camping.
- lodging.
- repair.
- viewpoints.

Add:
- `trailheads`
- `water` (potable water where mapped).
- `restrooms`
- `ev-charging` for future electric motorcycle support.
- `ranger-stations` / visitor centers.
- `emergency-services` as advanced context, not route advice.

These should not dominate the Layers panel. Put them under "Stops" and use search/filter.

## Layer catalog target

### Map

- Road
- Topo
- Satellite
- Hybrid
- Recent Satellite

### Terrain

- 3D terrain
- Hillshade
- Contours
- Slope angle
- Aspect

### Roads

- Great riding roads
- Road surface
- Road difficulty
- Road grade
- Gravel Atlas
- Seasonal / unmaintained
- Fords / water crossings

### Access

- Public land
- Private land
- MVUM motorcycle access
- USFS roads
- USFS trails
- Access controls / gates
- Restricted areas / wilderness

### Conditions

- Traffic flow
- Incidents / closures
- Construction
- Weather alerts
- Weather radar
- Active fires
- Fire perimeters
- Historic fires
- Air quality
- Snow
- Flood risk

### Connectivity

- Mobile coverage
- Cell towers

### Stops

- Fuel
- Food
- Coffee
- Camping
- Lodging
- Repair
- Viewpoints
- Trailheads
- Water
- Restrooms
- Ranger / visitor centers

This is enough to match the outdoor-layer capability families that matter to OpenGravel while remaining a motorcycle product.

## Layer metadata contract

The current catalog is too small for a serious stack. Extend each definition with metadata similar to:

```ts
type LayerAuthority =
  | "authoritative-regulatory"
  | "authoritative-context"
  | "commercial-live"
  | "community"
  | "derived";

type LayerFreshness =
  | { kind: "live"; expectedLagMinutes: number }
  | { kind: "scheduled"; label: string }
  | { kind: "snapshot"; label: string }
  | { kind: "static" };

interface MapLayerDefinition {
  id: MapLayerId;
  name: string;
  category: MapLayerCategory;
  kind: "view" | "raster" | "features" | "derived";
  legend: string;
  source: string;
  caveat: string;
  minZoom: number;
  color: string;
  glyph: string;

  authority: LayerAuthority;
  freshness: LayerFreshness;
  coverageLabel: string;
  offline: "yes" | "no" | "regional" | "source-dependent";
  defaultOpacity: number;
  quick: boolean;
}
```

Do not expose vendor payloads through this interface.

## Restore the good part of SwitchBack's layer studio

SwitchBack already modeled:

- visible state.
- opacity.
- order.
- map packs.
- quick-layer selection.

Bring those concepts forward, not its weaker source assumptions.

Required behavior:

### Quick sheet

The default layer sheet remains simple:
- basemap cards.
- current mode/preset.
- 4–6 high-value toggles.
- "Advanced layers".

### Advanced layers

Add:
- per-layer opacity.
- reorder only where order matters.
- search.
- source/freshness badge.
- offline indicator.
- legend preview.
- "Available here" / "not covered here" state.

Avoid exposing 40 identical switches in one flat list.

### Riding presets

#### Road

- Road basemap.
- traffic incidents.
- weather alerts.
- fuel.
- great roads.

#### ADV / Gravel

- Topo basemap.
- hillshade.
- surface.
- Gravel Atlas.
- public land.
- MVUM.
- access controls.

#### Forest / Backcountry

- Topo.
- contours.
- slope.
- USFS roads/trails.
- MVUM.
- public land.
- gates.
- mobile coverage.

#### Weather

- Road or Topo.
- radar.
- weather alerts.
- fire.
- air quality.
- optional snow.

Presets modify presentation only. They must never silently change route preferences.

## Renderer architecture

Do not add one bespoke MapLibre codepath per layer.

### 1. Keep the current normalized feature path

`/api/map-layers` remains the normalized path for viewport feature layers.

Add providers:
- `usfs`
- `usgs-land`
- `firms`
- `airnow`
- `fcc`

### 2. Generalize raster overlays

Traffic flow is currently a special raster path.

Introduce a small raster-overlay registry:

```ts
interface RasterOverlaySpec {
  id: MapLayerId;
  tileUrl: string;
  minZoom: number;
  maxZoom?: number;
  opacity: number;
  attribution?: string;
  cachePolicy: "live" | "cacheable" | "offline";
}
```

Use this for:
- traffic flow.
- radar.
- hillshade.
- slope.
- recent satellite where tiled server-side.
- future snow/fire raster products.

### 3. Derived layers stay local when possible

Road surface/difficulty/grade should consume graph/elevation evidence already available to OpenGravel, not hit a third-party API on every pan.

### 4. One authority model for routing and display

MVUM, closures and future legal-access sources should normalize once, then feed:
- route intelligence.
- map display.
- feature card.
- offline snapshot.

No parallel "routing truth" and "map truth".

## Server and caching policy

Suggested defaults:

| Layer/source | Refresh | Server cache | Offline |
| --- | --- | --- | --- |
| MVUM | agency publish cadence | 7 days + stale | yes |
| USFS roads/trails | daily-ish agency refresh | 24 h | yes |
| PAD-US | release snapshot | versioned | yes |
| FCC mobile | release snapshot | versioned | yes |
| 3DEP derivatives | static per DEM build | immutable | yes |
| TomTom traffic | live | seconds/minutes | no |
| NWS alerts | live | minutes | no |
| NWS radar | live | minutes | no |
| NASA FIRMS | near real time | 5–15 min | optional recent snapshot |
| AirNow | live | 15–60 min | no |
| Copernicus recent sat | scene/mosaic | hours/day | no initially |

Every dynamic response must carry a fetched-at time or equivalent source timestamp.

## Offline behavior

OpenGravel should eventually beat the competitors here because the project controls its own regional builds.

A region pack should be able to include:

- OpenGravel vector basemap.
- contours.
- hillshade.
- slope.
- public land.
- FCC coverage.
- Gravel Atlas.
- USFS roads/trails.
- MVUM snapshot.
- OSM surface/access controls.
- selected POIs.

Dynamic online-only layers:
- traffic.
- radar.
- current fire.
- air quality.
- recent satellite.

When offline:
- hide online-only layers or show "Last downloaded <time>" only if a real snapshot exists.
- never silently continue showing stale dynamic data as current.

## Data build pipeline

Extend `infra/maps` into a modular region pack builder.

Suggested stages:

```
fetch-osm
fetch-terrain
derive-contours
derive-hillshade
derive-slope
fetch-padus
fetch-fcc
fetch-usfs-roads-trails
fetch-mvum
build-vector
build-overlays
write-manifest
validate-region
```

The manifest should include:
- dataset id.
- source.
- source version/date.
- build timestamp.
- geographic bounds.
- min/max zoom.
- checksum.
- attribution.
- license/terms note.
- offline size.

Do not commit generated national/state archives to Git.

## PA/NJ first implementation slice

Use PA/NJ as the proving ground because the current offline pipeline already targets it.

Phase 1 acceptance:

1. Topo basemap works in PA/NJ.
2. Contours, hillshade and slope work online and from an offline region pack.
3. Public land comes from PAD-US, not only OSM.
4. MVUM displayed from the same normalized authority data used by route intelligence.
5. USFS roads/trails are distinct layers.
6. Road surface is visible from OSM/Gravel Atlas evidence.
7. FCC mobile coverage is available as an overlay.
8. Layer choices, opacity and order persist per device.
9. ADV/Gravel and Forest/Backcountry presets work.
10. Existing route, traffic and POI layers still work.

Phase 2:
- radar.
- active fire.
- AirNow AQI.
- access controls.
- road grade/difficulty.
- Hybrid basemap.

Phase 3:
- Recent Satellite.
- fire perimeter/history.
- regional parcel providers.
- snow/flood context.
- nationwide region-pack generation.

## File-level implementation map

Likely changes:

### Domain / application

- `src/application/map-layers/catalog.ts`
  - expand ids/categories/metadata.
- `src/application/map-layers/types.ts`
  - provider ids, timestamps, coverage metadata.
- `src/application/map/preferences.ts`
  - basemap/preset/layer-stack persistence.
- new `src/application/map-layers/presets.ts`
  - Road / ADV / Forest / Weather presets.
- new normalized adapters for road-authority-to-display features.

### Infrastructure

- `src/infrastructure/map/maplibre/info-layers.ts`
  - semantic styling for access/surface/terrain features.
- new `src/infrastructure/map/maplibre/raster-overlays.ts`
  - generic raster registry.
- `src/infrastructure/route-intelligence/usfs-mvum/mvum-source.ts`
  - reuse; do not fork.
- new providers for PAD-US / FCC / FIRMS / NWS radar / AirNow as needed.

### Server

- `src/server/map-layers/providers.ts`
  - split before it becomes a mega-file.
- suggested:
  - `providers/tomtom.ts`
  - `providers/osm.ts`
  - `providers/usfs.ts`
  - `providers/usgs.ts`
  - `providers/nws.ts`
  - `providers/firms.ts`
  - `providers/airnow.ts`
- preserve the existing normalized API result.

### UI

- `src/ui/layers/MapLayersPanel.tsx`
  - quick/advanced split.
  - opacity/source/offline controls.
- new `LayerPresetPicker`.
- `InfoFeatureCard`
  - source date, authority badge, caveat and layer-specific details.

### Offline

- `infra/maps`
  - terrain + authority + connectivity build stages.
- `src/application/offline`
  - overlay availability manifest.
- `src/ui/settings/OfflineMapsSection.tsx`
  - estimated sizes by selected overlay.

## Testing requirements

### Unit

- catalog ids are unique.
- every visible layer has source, caveat, authority, coverage and offline semantics.
- presets contain only valid layer ids.
- MVUM normalized records render expected seasonal/open/closed semantics.
- unknown MVUM coverage never becomes closed.
- raster registry rejects credentials in client URLs.
- opacity clamps to 0..1.
- persisted old layer ids migrate safely.

### Integration

- provider outage marks only that provider unavailable.
- stale source metadata is surfaced.
- bbox clipping still prevents unbounded provider requests.
- region pack manifest advertises only files actually present.
- offline runtime never requests online-only raster layers.

### E2E

- change basemap Road → Topo → Satellite/Hybrid.
- enable ADV preset, pan, reload; choices persist.
- reorder/opacity persists.
- layer feature tap shows correct source and caveat.
- offline PA/NJ pack renders topo + public land + MVUM + surface with network disabled.
- failure of NWS/FIRMS/TomTom never blanks the map.
- route remains visually dominant with any supported overlay combination.
- navigation mode suppresses layer clutter that competes with maneuvers.

## Performance gates

Mobile-first limits:

- Turning a layer on must not rebuild the whole map.
- Avoid fetching viewport feature layers below their meaningful zoom.
- Debounce pan fetches as today.
- Vector overlay payloads should be clipped/simplified server-side.
- Prefer prebuilt PMTiles for nationwide/state static datasets.
- Keep raster sources bounded to visible tiles.
- Navigation mode should cap the number of simultaneously visible non-route labels/points.

Target:
- no visible frame drop from toggling a normal cached layer.
- no single overlay should add multi-megabyte viewport responses.
- offline region build reports each overlay's storage cost before download.

## Non-goals

- Do not copy Gaia/GOAT branding, cartography or proprietary datasets.
- Do not pretend OSM access tags are nationwide parcel ownership.
- Do not make display overlays silently affect route legality.
- Do not make a 40-layer panel the default experience.
- Do not add AI-generated terrain or "painted" map data.
- Do not ship a layer without source, freshness, coverage and caveat metadata.
- Do not expose API keys in raster tile URLs shipped to the client.

## Definition of done

This initiative is complete when:

- OpenGravel has Road, Topo, Satellite and Hybrid map experiences.
- The core Gaia/GOAT outdoor families are represented: terrain/slope, public land, private-land provider contract, MVUM, USFS roads/trails, recent conditions, wildfire, connectivity and offline layers.
- PA/NJ can download an offline map pack containing topo plus the high-value static overlays.
- Layer stack order and opacity are first-class and persist.
- Riders get curated presets rather than a wall of switches.
- Every authoritative/legal layer is sourced and caveated correctly.
- OpenGravel adds motorcycle-specific surface, difficulty, grade, gates and route-aware access context that the generic outdoor apps do not center.

## Layer closeout implementation (2026-10-03)

The Layers sheet now exposes the following online projections through the existing
catalog and `/api/map-layers` provider boundary. They change map presentation,
never route eligibility or scoring.

| Layer | Source and scope | Freshness / limits |
| --- | --- | --- |
| Hillshade | Existing AWS Mapzen Terrarium raster DEM | Roughly 30–90 m source resolution varies by region; source survey date unknown. Reuses 3D terrain DEM without tilting the map. |
| Contours | Same Terrarium elevation adapter; small browser worker | 20 m intervals, index lines every 100 m. A bounded 65 × 65 sampled view grid; actual sampling spacing is disclosed. Not survey contours. |
| Terrain slope | Same grid; derived gradient | Percent terrain gradient, not road grade. Tan below 10%, amber 10–25%, ember above 25%. Does not describe road passability. |
| Weather radar | NOAA NEXRAD mosaic through Iowa Environmental Mesonet WMS-T | One current available archive frame, exact valid time, refreshed each minute; stale after 15 minutes. CONUS only. Radar gaps remain unknown. |
| Active fire | NASA FIRMS VIIRS SNPP NRT area CSV | Last 48 hours, UTC acquisition time and source confidence on each detection, nominal 375 m footprint. **Hotspots are not road closures.** Requires server-only `NASA_FIRMS_MAP_KEY`. |
| Public/protected land | USGS PAD-US Public Access feature service | Generalized polygons including holes; bounded pagination. Ownership/protection is not motorized access. Source boundary survey dates unknown. If primary fails, row says unavailable and explicitly labeled OSM centres provide supplementary context. |
| Legal motorized access | Shared routing road-authority coordinator's USFS MVUM snapshots | Existing normalized designations, motorcycle classes and seasonal windows; unknown and stale states preserved. Seasonal evaluation uses the canonical UTC-date policy. Requires `OGV_ROAD_AUTHORITY=on`. |
| Authority work zones | Same coordinator's WZDx registry/state snapshots | Same records as routing, including reported closures and restrictions; expired/future records excluded with canonical active-date policy. Unreported roads/coverage gaps remain unknown. |
| Road surface evidence | Shared routing Gravel Atlas port | Surveyed gravel geometry and routing-model confidence only. A missing database is unavailable. Paved/dirt/smoothness beyond that catalogue remain unknown. Requires `GRAVEL_ATLAS_DB_PATH`. |

Every loaded layer shows retrieval time separately from observation time. Source
survey dates are not invented. The served area is capped to the central 1.6° × 1°
of the view (terrain detail has a smaller bounded view); coverage outside it is
unknown. Server snapshots are cached with a 32 MiB budget and concurrent identical
requests are coalesced. The existing public API guard meters map-layer requests.
No offline pack contains these overlays yet; they explicitly say online only.

Reviewer visual checks: open **Layers** on any `LayeredMap` planner/ride map in
Day and Night, both narrow and desktop widths. Check the new view, conditions,
roads and access rows, About disclosures, timestamp text, stale radar, unavailable
PAD-US with OSM fallback, and tapped contour/slope/fire/land/MVUM/work-zone/surface
cards. Component tests exercise disclosures and Escape focus return; visual
screenshots and physical-device acceptance remain reviewer checks.

Source references:

- [MapLibre contour worker reference](https://github.com/onthegomap/maplibre-contour) informed the choice of a small bounded GeoJSON worker rather than adding a vector-tile dependency.
- [IEM NEXRAD mosaic documentation](https://mesonet.agron.iastate.edu/docs/nexrad_mosaic/).
- [NASA FIRMS area API](https://firms.modaps.eosdis.nasa.gov/api/area/).
- [USGS PAD-US web services](https://www.usgs.gov/programs/gap-analysis-project/science/pad-us-web-services), using its maintained Public Access feature-layer view.

Deferred broader work-order items: PA/NJ 3DEP ingestion, USFS road/trail inventory
beyond MVUM, gates, PASDA evidence, actual road grade, topo preset, offline terrain
packaging, fire perimeters, snow and FCC coverage. AirNow is deliberately skipped.
