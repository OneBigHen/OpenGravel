# OpenGravel Adventure World

Status: design / implementation work order  
Target branch: `feat/gaia-goat-layer-parity`  
Depends on: map-layer parity, Discover, ride-interest corridor, Ride Focus  
Rider-facing working name: **Adventure** or **World**  
Internal model name: **WorldLayer**

## Why this exists

OpenGravel already has the beginnings of something more interesting than a conventional motorcycle GPS:

- a terrain-aware map stack
- Great Roads and Gravel Atlas
- Discover/Wikimedia places
- ride-along interest points
- a Free Ride copilot
- route recording
- surface, curvature, access and elevation evidence
- an offline-first architecture

The next step should not be "more pins." It should make riding through the map feel like uncovering a real world.

The reference feeling is the best part of location games such as Pokémon GO: the physical world has state, nearby things reveal themselves, visiting somewhere changes the map, and the rider builds a personal history of places and roads.

The product must still feel like motorcycle software, not a cartoon game.

## Product rule

> Ride first. World second. Game third.

The map is safety-critical while moving. Gamification may motivate where a rider goes, but it must never reward speed, risky riding, staring at the screen, unsafe check-ins, illegal access, or riding farther than the rider intended.

That implies:

- no speed leaderboards
- no timed "race to this point" objectives
- no interaction requirement to earn a discovery while moving
- no celebratory full-screen takeover during navigation
- no XP spam over maneuver guidance
- no territorial ownership mechanic that encourages repeated riding of the same place
- no rewards for entering roads whose legality/access is unknown
- no default public sharing of exact ride history or home location

## Core concept: the world has state

Normal map applications render a database.

Adventure renders a **world state** on top of the same database.

A road can be:

- not yet ridden
- ridden
- ridden recently
- ridden in another season
- verified by the rider
- part of a completed collection

A place can be:

- unknown to this rider
- visible but undiscovered
- discovered automatically by proximity
- visited while stopped
- saved
- verified
- part of a collection
- spatially mapped for a richer 3D/AR experience

The state belongs to the rider. The underlying feature remains provider-neutral and attributable.

## Do not make every POI a collectible

The biggest failure mode is turning OSM into thousands of glowing dots.

Create a derived object called a **World Node**. Only features that earn attention become nodes.

Candidate sources:

- OpenGravel Discover
- Wikidata / Wikipedia / Wikimedia
- OSM
- viewpoints
- historic sites
- unusual roadside features
- waterfalls
- covered bridges
- ferries
- mountain passes
- fire towers
- trailheads / forest entrances
- scenic pull-offs
- iconic diners and rider stops
- Great Roads
- Gravel Atlas
- public-land entrances
- selected events
- community-submitted discoveries later

Do not promote ordinary businesses or every tagged feature.

## World object model

Keep provider models unchanged. The world layer is a derived application model.

```ts
type WorldNodeKind =
  | "viewpoint"
  | "waterfall"
  | "bridge"
  | "historic"
  | "quirky"
  | "pass"
  | "summit"
  | "fire-tower"
  | "forest-gate"
  | "ferry"
  | "roadside"
  | "camp"
  | "rider-stop"
  | "event";

interface WorldNode {
  id: string;
  kind: WorldNodeKind;
  name: string;
  coordinate: Coordinate;

  // Why OpenGravel believes this deserves space on the map.
  adventureScore: number;       // 0..1
  confidence: number;           // 0..1
  rarity: "common" | "notable" | "rare" | "iconic";

  // Routing / riding context.
  roadId?: string;
  routeable: boolean;
  accessStatus: "known-open" | "known-restricted" | "unknown";
  detourMinutes?: number;

  // Rendering.
  visualTier: 1 | 2 | 3;
  minZoom: number;
  modelRef?: string;
  splatRef?: string;
  spatialSiteRef?: string;

  // Provenance remains mandatory.
  sourceIds: readonly string[];
}
```

Roads need their own world state rather than pretending they are points:

```ts
interface WorldSegment {
  id: string;
  roadId: string;
  geometry: LineString;

  surface: SurfaceEvidence;
  funScore?: number;
  curvatureScore?: number;
  gradeClass?: string;
  legalAccess: "known-open" | "known-restricted" | "unknown";

  regionIds: readonly string[];
  collectionIds: readonly string[];
}
```

Rider progress is separate:

```ts
interface RiderWorldState {
  nodeProgress: Record<string, NodeProgress>;
  segmentProgress: Record<string, SegmentProgress>;
  collectionProgress: Record<string, CollectionProgress>;
  patches: readonly EarnedPatch[];
}
```

That separation is important. A user's progression must never contaminate route authority, legal-access evidence, or the canonical map data.

## Adventure Score

A World Node should be selected because it is worth seeing, not because an API returned it.

Suggested first-pass score:

```text
adventureScore =
    0.22 * sourceNotability
  + 0.18 * riderRelevance
  + 0.15 * visualInterest
  + 0.15 * roadQualityNearby
  + 0.10 * rarity
  + 0.10 * sourceConfidence
  + 0.10 * routeFit
  - detourPenalty
  - duplicatePenalty
  - accessUncertaintyPenalty
```

This is deterministic evidence scoring, not an AI-generated truth.

The scoring weights can change later; the important contract is explainability.

Example explanation:

> Covered bridge · 0.4 mi off route  
> Rare locally · on a Great Road · Wikimedia photo · access known

## Discovery mechanics

### Automatic discovery

A rider should not tap anything while moving.

A node is discovered automatically when all applicable conditions are met:

- GPS accuracy is acceptable
- rider comes within the node's radius
- location is not obviously map-matched to a distant parallel road
- optional minimum dwell only for features that require being stopped
- node is not access-restricted

Suggested radii:

- roadside object: 50–100 m
- overlook / bridge: 100–200 m
- large landmark: 200–400 m
- road / pass: crossing the segment geometry

The exact radii belong in data/config, not UI code.

### Passive feedback

While moving:

- one subtle haptic
- optional short audio cue
- one transient compact chip
- no modal
- no required acknowledgement

Example:

> Covered bridge discovered

The existing one-at-a-time ride-interest chip is the correct UX primitive. Extend it rather than stacking notifications.

### Parked/stopped reveal

When the rider is stopped, the app can expose richer content:

- photo
- history
- why it is interesting
- source attribution
- nearby good road
- add to ride
- "I've been here"
- field verification
- 3D / AR button when available

## Roads are the real game board

The strongest mechanic for a motorcycle app is not collecting POIs. It is **discovering roads**.

Every traversable segment can carry local rider state:

- first ridden date
- times ridden
- last ridden
- direction(s) ridden
- season(s)
- surface experienced
- rider verification
- whether it was part of a saved ride

The map can then show a restrained "explored" treatment.

Do not black out unexplored roads. That is unsafe and destroys navigation usefulness.

Instead:

- unexplored: normal cartography
- previously ridden: a faint secondary halo or texture at planning zoom
- newly ridden this ride: slightly warmer accent
- favorite: explicit rider-controlled mark

During active navigation, exploration styling yields to route clarity.

## Progress that feels like motorcycling

Avoid coins, stars, gems, energy, loot boxes, cartoon characters and daily-login mechanics.

Prefer motorcycle/outdoor language:

### Collections

Examples:

- Covered Bridges of Bucks County
- PA Fire Towers
- Delaware River Crossings
- Allegheny Mountain Passes
- PA State Forests
- Historic Turnpikes
- Dirt Roads of Michaux
- Pine Barrens
- Catskills Passes
- Appalachian Overlooks

A collection is mostly a reason to ride somewhere new.

### Patches

Completion earns a small visual patch in the rider's profile / garage.

Think jacket patch, rally stamp or passport mark.

Examples:

- Ridge Runner
- Forest Roads
- Covered Bridges
- River Crossings
- First 100 Gravel Miles
- Five State Forests

Do not use skill/status language that implies the rider is safer or more capable than they are.

### Expeditions

A collection can generate a ride:

> Build me a 3-hour loop that gets 3 new covered bridges.

> Give me a ride with 30+ miles of roads I haven't ridden.

> Take me to one rare discovery and maximize twisty roads.

This is where gamification improves the core routing product instead of becoming a side quest.

### Completion map

Post-ride, show:

- new road miles
- new gravel miles
- new World Nodes
- collections advanced
- regions explored
- field notes contributed

No speed-based achievement should be displayed.

## Post-ride is where the game can breathe

While moving: almost nothing.

After stopping: make it satisfying.

Suggested post-ride card:

```text
TODAY'S RIDE

82.4 mi
26.1 mi new roads
8.7 mi new gravel

3 discoveries
  ✓ Sheard's Mill Covered Bridge
  ✓ Haycock Mountain overlook
  ✓ Forest Road 157

Covered Bridges of Bucks County
6 / 12

+ 2 road-condition verifications
```

Then render the newly explored road segments animating onto the map.

This is a much better place for richer graphics than the navigation screen.

## Community contribution as progression

OpenGravel can reward useful evidence rather than popularity.

After a rider has stopped or ended a ride, ask optional one-tap questions:

- Still gravel?
- Gate open/closed?
- Paved now?
- Construction?
- Water crossing passable?
- Road sign says public/private?
- Photo worth adding?

A verification should record source, time and confidence and feed the evidence system.

Potential rider-facing metric:

**Field Notes** or **Verified Roads**, not "karma."

Never treat one report as legal authority.

## World layer rendering

There should be three progressively richer render modes sharing one world model.

### 1. Standard map

Renderer:
- current MapLibre GL JS on web/PWA
- MapLibre Native in native ride surfaces

Use:
- vector/raster layers
- symbols
- lines
- fill extrusions
- hillshade
- terrain
- route / road state
- World Nodes

This is the default and must work offline.

### 2. Immersive terrain

Still MapLibre-based.

This is the key recommendation.

Use the native Metal backend for iOS and custom Metal style layers where standard style layers are insufficient.

Ideas:

- high-quality 3D terrain
- subtle atmospheric horizon
- stronger terrain lighting at useful pitch
- buildings only where they help orientation
- route ribbon draped over terrain
- road-surface treatment on route segments
- grade/curvature visualization available during planning
- selected World Nodes as restrained vertical beacons
- terrain-aware shadows/relief
- richer selected-place geometry
- animated but low-motion "newly discovered" ring
- custom destination landmark meshes where available

The current OpenGravel architecture already keeps the renderer behind `MapHost`; preserve that boundary.

### 3. Spatial scene

Optional. Only entered intentionally or while stopped.

Possible implementations:
- Niantic NSDK / VPS
- Scaniverse mesh
- Scaniverse Gaussian splat
- native AR
- Unity prototype
- web 3D viewer for splats/meshes

Use it for:

- a scanned covered bridge
- an overlook
- a famous road landmark
- trailhead / forest entrance orientation
- historic structure
- rally / event destination

Do not make this the route renderer.

## Speed-adaptive visualization

The map should become simpler as speed rises.

Suggested state machine, tuned later with real testing:

### Parked / walking
- full World Node labels
- photos/cards available
- discovery interactions
- 3D landmarks
- field verification
- collection progress

### Low speed
- route
- road character
- selected nearby nodes
- access warnings
- richer terrain

### Riding speed
- route
- maneuver
- terrain silhouette
- one upcoming discovery
- critical closures/access/weather
- minimal labels

No arbitrary hard-coded mph thresholds should ship without ride testing. The application can derive a bounded presentation state from motion and navigation state.

## The "route ribbon"

This is a high-value visual and does not require Unity.

Instead of a flat navigation polyline, render a route ribbon that can encode information without adding widgets.

Potential channels:

- width: route emphasis only, not data
- casing: selected route / reroute
- dash/texture: surface evidence
- small edge marks: upcoming gravel transition
- subtle height/lighting in immersive terrain
- local pulse: next maneuver / route reacquisition

Do not encode more than two data dimensions simultaneously while riding.

Planning mode can be richer.

## "Adventure vision" layer

A toggle can make the map answer:

> Where is the good stuff?

At regional zoom, do not draw individual points.

Render a derived field / heat layer based on:

- Great Road density
- gravel density
- topographic relief
- public-land access
- scenic nodes
- low junction density
- low major-road density
- rider's unexplored roads

The result should look like regions of opportunity, not a precise claim that every highlighted road is good.

Zooming in resolves the field into actual roads/nodes with evidence.

This becomes an excellent planner affordance:

> Drag the destination into the brighter adventure area.

## "Unexplored" routing preference

Add an optional planning modifier:

```text
Explore:
[ Off ] [ Some new roads ] [ Prefer new roads ]
```

It must remain subordinate to:

1. legality/access
2. surface constraints
3. route feasibility
4. rider-selected road style

Do not allow "unexplored" to force obviously worse or uncertain roads without showing the tradeoff.

The route explanation can say:

> +18 minutes · 24 mi of roads you haven't ridden · 2 new discoveries

## Free Ride integration

Free Ride is the ideal surface for Adventure.

The copilot can occasionally offer one high-value opportunity:

> FIRE TOWER  
> 4.2 mi · +11 min  
> New to you  
> TAKE

or:

> GREAT ROAD  
> 6.8 mi ahead  
> 8 mi of curves · new to you  
> TAKE

The existing single-offer model should remain. Do not create a scrolling quest feed.

## Offline contract

The feature should still feel complete with no signal.

Region packs should eventually contain:

- base vector map
- terrain
- contours/hillshade
- road intelligence
- static World Nodes
- collection definitions
- public-land/access context
- local rider progress

Dynamic content can degrade:

- live event disappears/stales
- weather/traffic stale
- image may be unavailable unless cached
- spatial asset only appears when downloaded

World Nodes should compile into PMTiles or another region-bounded static artifact rather than requiring API calls while riding.

## Privacy model

Adventure should be local-first.

By default, store:

- discovered node ids
- ridden segment ids
- completion state
- personal collections
- visit timestamps if required for the feature

locally with the rider's existing ride data.

If community sync arrives later:

- exact home-adjacent history is private by default
- social sharing is opt-in
- aggregate exploration statistics are coarse
- do not expose another rider's live location
- do not create public exact "last visited by" feeds

## Renderer decision: MapLibre first

OpenGravel currently uses MapLibre GL JS and already has a renderer boundary.

That is an asset, not a limitation.

For the actual riding UI, MapLibre Native can supply:

- vector tiles
- raster imagery
- DEM / hillshade
- fill extrusion
- offline regions / PMTiles
- Metal rendering on iOS
- custom Metal style layers for specialized geometry/effects

That is sufficient for a significantly more "game-world" feeling map without turning the whole app into a game engine.

## Where Unity fits

Unity is useful, but it should be an **optional lab / spatial scene**, not the default navigation renderer.

Reasons:

- Unity-as-a-Library on iOS is full-screen rather than an arbitrary embedded partial view.
- it adds another runtime and rendering lifecycle
- unloading retains substantial runtime memory
- only one Unity runtime can be loaded
- native/WebView ↔ Unity state synchronization becomes another product-critical path
- offline map packaging would need a parallel implementation
- CarPlay still needs a native map/navigation path

A Unity prototype is still worth doing if the goal is to answer:

> Is a fully 3D real-world motorcycle map materially better than our MapLibre/Metal terrain view?

If we run that experiment, isolate it under `tools/maplab-unity/` or a separate prototype app.

Do not introduce it into production navigation before that comparison wins.

## Unity geospatial options

### Do not use the old Niantic Maps SDK

Niantic's Maps SDK for Unity was sunset and its endpoints were shut down in October 2025.

Current Niantic Spatial products are useful for VPS/localization and spatial assets, not as OpenGravel's base cartography stack.

### Mapbox Unity

Mapbox's published Unity SDK v2.1.1 is currently not actively developed and Mapbox says v3 is still in development.

Do not make OpenGravel depend on v2.

Re-evaluate v3 when it is released and stable.

### Cesium for Unity

If a 3D world prototype is desired now, Cesium for Unity is a much stronger research candidate than old Niantic Maps or Mapbox Unity v2:

- WGS84 globe
- terrain
- imagery
- buildings / photogrammetry
- 3D Tiles
- custom geospatial content
- open-source plugin

Use it for the prototype only until mobile thermal, memory, offline, licensing and integration costs are measured.

## Where Niantic Spatial fits

Niantic Spatial should be treated as a **spatial landmark provider / localization system**.

Current useful pieces:

- Scaniverse site capture
- VPS maps
- meshes
- Gaussian splats
- VPS 2 localization
- NSDK support for Unity and native platforms

That suggests:

```text
OpenGravel world node
        |
        +-- ordinary node ----------> MapLibre symbol / geometry
        |
        +-- 3D asset ---------------> mesh / splat viewer
        |
        +-- spatial site -----------> Niantic VPS / AR experience
```

The entire Adventure system must work if `spatialSiteRef` is null.

### Good Niantic examples

- scan a famous covered bridge
- scan a fire tower / overlook
- scan an event venue
- anchor historical annotations to a structure
- let a stopped rider view a persistent AR marker
- use VPS to improve orientation at a complex landmark

### Bad Niantic examples

- every gas station
- base road rendering
- turn-by-turn route line
- terrain for the whole country
- anything required for navigation

## Gaussian splats are especially interesting

Scaniverse can produce Gaussian splats and meshes.

Niantic's SPZ format is open and is becoming more practical for web/mobile delivery.

OpenGravel could use a splat as a **3D postcard**:

1. rider opens a discovered landmark while stopped
2. tap "View in 3D"
3. stream or load the site's optimized splat
4. orbit the actual location
5. optionally enter AR/VPS mode

That gives us some of the visual magic the user is after without requiring Unity to own navigation.

A later offline region pack could optionally contain a tiny set of high-value landmark assets.

## CarPlay

Gamification on CarPlay should be far more conservative than on the phone.

Use the custom map for:

- route
- terrain/cartography
- critical access/closure state
- at most one relevant upcoming discovery

Do not draw custom interactive game UI over the CarPlay base map.

CarPlay's framework owns interaction through its templates. The game/progression detail belongs on the phone or post-ride.

## Architecture seam

Do not add "gamification" conditions throughout React.

Add an application module:

```text
src/application/world/
  types.ts
  score.ts
  discovery.ts
  progress.ts
  collections.ts
  scene.ts
  events.ts
```

Infrastructure:

```text
src/infrastructure/world/
  compiled-world-source.ts
  rider-world-repository.ts
```

Later native bridge:

```text
apps/ios/OpenGravelNavigation/
  World/
  Spatial/
```

Possible persisted events:

```ts
type WorldEvent =
  | { type: "node-discovered"; nodeId: string; at: string }
  | { type: "node-visited"; nodeId: string; at: string }
  | { type: "segment-first-ridden"; segmentId: string; at: string }
  | { type: "segment-ridden"; segmentId: string; at: string }
  | { type: "field-note"; segmentId: string; note: FieldNote; at: string }
  | { type: "collection-completed"; collectionId: string; at: string };
```

Events make progress reconstructable and keep it separate from provider data.

## Reuse the existing ride-interest system

Do not replace `src/application/ride-interest`.

Instead:

```text
Discover + map layers + places
          |
          v
   canonical World Nodes
          |
          +---- planning scene
          |
          +---- ride-interest corridor
          |
          +---- world progression
          |
          +---- post-ride summary
```

The ride-interest corridor already solves the hard "what matters ahead of me?" problem.

World adds persistence and significance.

## P0 experiment

Before building social systems, badges or Unity:

1. compile a PA/NJ World Node set from existing Discover + map sources
2. rank it and cap density
3. create local rider progress storage
4. auto-discover nodes and ridden road segments
5. add an "Unexplored" planning visualization
6. show a post-ride new-road/new-place summary
7. add one understated discovery cue to Ride Focus
8. verify everything works offline with a PA/NJ pack

Success criterion:

> A normal ride through familiar roads should feel calm. A ride into a new area should visibly and audibly reveal that the rider is exploring without requiring screen interaction.

## P1 immersive map

After P0 works:

- native MapLibre/Metal prototype
- richer 3D terrain
- route ribbon
- speed-adaptive world-node LOD
- explored-road visualization
- one high-quality selected landmark mesh
- measure FPS, thermals, memory and battery on a real iPhone

Gate:

The immersive view must remain readable in sunlight and cannot compromise navigation or thermal stability.

## P2 spatial landmark prototype

Pick 3–5 locations in the PA/NJ test region.

For each:

- Scaniverse scan
- generate mesh / splat / VPS map
- attach spatial asset metadata to World Node
- provide "View in 3D"
- test native NSDK/VPS when parked

This proves whether spatial capture produces enough rider value before any broad content program.

## P3 Unity / Cesium research spike

Only after MapLibre/Metal P1 exists.

Build the same 5–10 mile sample area in Unity + Cesium and compare against the native immersive map.

Compare:

- terrain quality
- building quality
- route readability
- World Node presentation
- cold launch
- memory
- thermal behavior
- battery
- offline feasibility
- iOS integration complexity
- visual quality at motorcycle glance durations

Unity only graduates into the app if it clearly wins a use case that MapLibre/Metal cannot deliver.

## Things to actively reject

- a second independent POI provider framework
- duplicate map authority for MVUM/access
- scraping Pokémon GO / Ingress map databases
- game mechanics that encourage speeding
- giant floating pins everywhere
- route-critical information hidden behind a game state
- rendering every discovery as 3D
- always-on AR while riding
- Unity as the only map renderer
- cloud-only progression
- gamification that breaks self-hosting
- AI-generated fake landmarks or fake road conditions
- a public leaderboard of "fastest roads"

## First code slices

### Slice A — world model

- `WorldNode`
- `WorldSegment`
- deterministic adventure score
- provider provenance
- density / zoom tier
- tests

### Slice B — progress

- local IndexedDB repository
- discovery event reducer
- segment-first-ridden reducer
- collection reducer
- import/export with other local rider data

### Slice C — scene

- world-node scene builder
- explored-road scene builder
- speed/motion presentation state
- max density budgets
- ride-interest adapter

### Slice D — post-ride

- compute newly ridden roads
- compute discoveries
- compute collection changes
- post-ride summary panel

### Slice E — routing

- optional unexplored-road objective
- optional World Node objective
- explicit tradeoff in route explanation
- no impact on legality/access authority

### Slice F — immersive

- native MapLibre/Metal lab
- route ribbon
- terrain lighting
- high-value node beacon
- one landmark model/splat

## Acceptance principles

A build is going in the right direction when:

- navigation remains instantly legible
- unexplored areas make the rider curious
- revisiting an area shows personal history without visual noise
- post-ride feels rewarding
- the rider can understand why a thing is highlighted
- all authority/provenance remains inspectable
- static world state is usable offline
- the feature still works without Niantic, Unity, Mapbox or any proprietary provider
- optional spatial assets make a few locations special instead of making the whole app dependent on them
