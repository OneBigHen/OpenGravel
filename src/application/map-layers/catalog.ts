/**
 * The rider's map layers (UX rework phase 8; SwitchBack parity for the layer
 * studio in `switchback/src/lib/client/map-layers.ts`).
 *
 * Each layer is information *about* the map, never ride state: turning one on
 * changes what the rider sees, not what the planner routes. Every definition
 * names its source and its limits, because a layer that looks authoritative but
 * is community-mapped is how a rider ends up on a closed forest road.
 */

export type MapLayerCategory = "view" | "roads" | "conditions" | "stops" | "access";

export type MapLayerId =
  | "terrain-3d"
  | "hillshade"
  | "contours"
  | "slope"
  | "traffic-flow"
  | "live-traffic"
  | "traffic-cameras"
  | "weather"
  | "weather-radar"
  | "active-fire"
  | "closures"
  | "great-roads"
  | "gravel"
  | "road-surface"
  | "road-history"
  | "fuel"
  | "food"
  | "coffee"
  | "camping"
  | "lodging"
  | "repair"
  | "viewpoints"
  | "public-land"
  | "forest-roads"
  | "mvum"
  | "work-zones"
  | "cell-towers";

/**
 * How the layer is drawn: a camera/view change (3D terrain), a raster tile
 * overlay, or features from `/api/map-layers`.
 */
export type MapLayerKind = "view" | "raster" | "features";

export interface MapLayerDefinition {
  readonly id: MapLayerId;
  readonly name: string;
  readonly category: MapLayerCategory;
  readonly kind: MapLayerKind;
  /** The one-line "what am I looking at". */
  readonly legend: string;
  readonly source: string;
  /** The honest limit of the data, shown in the layer's detail. */
  readonly caveat: string;
  /** The zoom below which the layer does not load (the view would be too big). */
  readonly minZoom: number;
  /** A palette colour name the map and the panel both use for this layer. */
  readonly color: string;
  /** Optional existing theme token for SVG swatches and presentation accents. */
  readonly colorToken?: string;
  /** A short glyph for the panel swatch and point markers. */
  readonly glyph: string;
}

export const MAP_LAYER_CATEGORIES: readonly { readonly id: MapLayerCategory; readonly name: string }[] = [
  { id: "view", name: "Map view" },
  { id: "conditions", name: "Live conditions" },
  { id: "roads", name: "Roads" },
  { id: "stops", name: "Stops" },
  { id: "access", name: "Land and access" },
];

export const MAP_LAYERS: readonly MapLayerDefinition[] = [
  {
    id: "mvum", name: "Forest Service roads", category: "access", kind: "features",
    legend: "Green open to motorcycles, red closed",
    source: "USFS MVUM · canonical routing authority",
    caveat: "Published motorcycle designations and seasonal windows, evaluated by UTC date. Missing roads and unpublished dates stay unknown. Check current local MVUM and restrictions; designation does not prove passability. Requires the routing authority connector. Online only.",
    minZoom: 10, color: "#243a35", colorToken: "--og-deep-spruce", glyph: "⟋",
  },
  {
    id: "work-zones", name: "Road work", category: "conditions", kind: "features",
    legend: "Work zones and lane closures from the state",
    source: "USDOT WZDx registry / state DOT · canonical routing authority",
    caveat: "Uses the same normalized snapshots as routing. Feed gaps, unknown dates and stale reports remain visible; no report is not proof of a clear road. Requires the routing authority connector. Online only.",
    minZoom: 8, color: "#d65a36", colorToken: "--og-ember", glyph: "⚒",
  },
  {
    id: "active-fire", name: "Wildfires", category: "conditions", kind: "features",
    legend: "Fires seen by satellite in the last two days",
    source: "NASA FIRMS VIIRS SNPP NRT",
    caveat: "Hotspots are not road closures. Nominal 375 m VIIRS footprint; clouds and satellite timing leave gaps. Acquisition time and confidence on each detection. Online only.",
    minZoom: 5, color: "#bf4829", colorToken: "--og-ember-strong", glyph: "!",
  },
  {
    id: "weather-radar", name: "Rain radar", category: "conditions", kind: "features",
    legend: "Where it is raining right now",
    source: "NOAA NEXRAD / Iowa Environmental Mesonet",
    caveat: "CONUS mosaic, roughly 1 km resolution. Frame valid time shown. Stale after 15 minutes. Radar gaps and beam blockage do not mean clear weather. Online only.",
    minZoom: 4, color: "#397c96", colorToken: "--og-signal-blue", glyph: "☂",
  },
  {
    id: "hillshade", name: "Hill shading", category: "view", kind: "view",
    legend: "Shaded hills so valleys and ridges pop", source: "AWS Terrain Tiles (Mapzen Terrarium)",
    caveat: "DEM resolution roughly 30–90 m, varying by source region. Online only; source survey date unknown. Shares the existing terrain DEM without tilting the map.",
    minZoom: 6, color: "#65745d", colorToken: "--og-trail-moss", glyph: "⛰",
  },
  {
    id: "contours", name: "Contour lines", category: "view", kind: "features",
    legend: "Elevation lines; closer lines mean steeper ground", source: "AWS Terrain Tiles (Mapzen Terrarium)",
    caveat: "DEM resolution roughly 30–90 m, varying by source region. Derived contours and slope use a coarser visible-view grid; spacing shown when loaded. Terrain gradient is not road grade. Online only; source survey date unknown.",
    minZoom: 6, color: "#776353", colorToken: "--og-trail-brown", glyph: "⛰",
  },
  {
    id: "slope", name: "Steep ground", category: "view", kind: "features",
    legend: "Amber is steep, red is very steep", source: "AWS Terrain Tiles (Mapzen Terrarium)",
    caveat: "DEM resolution roughly 30–90 m, varying by source region. Derived contours and slope use a coarser visible-view grid; spacing shown when loaded. Terrain gradient is not road grade. Online only; source survey date unknown.",
    minZoom: 6, color: "#c99a46", colorToken: "--og-golden-hour", glyph: "⛰",
  },

  {
    id: "terrain-3d",
    name: "3D terrain",
    category: "view",
    kind: "view",
    legend: "Tilt the map to see the ridges you will climb",
    source: "AWS Terrain Tiles (Mapzen Terrarium)",
    caveat: "Elevation at roughly 30 m resolution; drag with two fingers or right-click to tilt and turn.",
    minZoom: 0,
    color: "#65745d",
    glyph: "⛰",
  },
  {
    id: "traffic-flow",
    name: "Traffic speed",
    category: "conditions",
    kind: "raster",
    legend: "Green moving, amber slow, red stopped",
    source: "TomTom Traffic Flow",
    caveat: "Live speeds relative to free flow on major roads; minor roads are often not covered.",
    minZoom: 6,
    color: "#3e6b55",
    glyph: "≋",
  },
  {
    id: "live-traffic",
    name: "Crashes and closures",
    category: "conditions",
    kind: "features",
    legend: "Reported right now",
    source: "TomTom Traffic Incidents",
    caveat: "Provider reports only; a road with no report is not proof that it is clear.",
    minZoom: 8,
    color: "#a83e32",
    glyph: "!",
  },
  {
    id: "traffic-cameras",
    name: "Traffic cameras",
    category: "conditions",
    kind: "features",
    legend: "Tap one to see the road now",
    source: "State DOT and 511 camera feeds",
    caveat: "Coverage and playback differ by state. Cameras load only for the visible region; video opens only on demand.",
    // Hundreds of highway cameras buried the ride at overview zooms (owner review 2026-10-04).
    minZoom: 11,
    color: "#6b4f8a",
    glyph: "◉",
  },
  {
    id: "weather",
    name: "Weather alerts",
    category: "conditions",
    kind: "features",
    legend: "Storm, flood and wind warnings here",
    source: "National Weather Service",
    caveat: "US only. This layer checks the map center, not every visible point; pan or recenter to check another area. Alert polygons follow NWS cadence and precision.",
    minZoom: 4,
    color: "#1e5aa8",
    glyph: "☂",
  },
  {
    id: "great-roads",
    name: "Twisty roads",
    category: "roads",
    kind: "features",
    legend: "Hotter, thicker line = more bends",
    source: "OpenGravel road-shape analysis",
    caveat: "Scored from road geometry by bend density; approximate, not ground-truthed.",
    minZoom: 8,
    color: "#d65a36",
    glyph: "∿",
  },
  {
    id: "gravel",
    name: "Dirt and gravel roads",
    category: "roads",
    kind: "features",
    legend: "Dashed brown; thicker = better dirt",
    source: "OpenGravel Gravel Atlas",
    caveat: "Surface evidence only; not proof of legal access or current passability. Regional coverage.",
    minZoom: 8,
    color: "#776353",
    glyph: "⋯",
  },
  {
    id: "road-history",
    name: "Roads you’ve ridden",
    category: "roads",
    kind: "features",
    legend: "Good roads from your saved rides",
    source: "Your saved rides + OpenGravel road catalogues",
    caveat: "Estimated from local recordings and partial mapped-road coverage; it is not a complete riding history.",
    minZoom: 8,
    color: "#3d8495",
    glyph: "↗",
  },
  {
    id: "fuel",
    name: "Fuel",
    category: "stops",
    kind: "features",
    legend: "Gas stations",
    source: "TomTom Search",
    caveat: "Provider POI data; hours, prices and ethanol-free pumps are not verified. Call ahead in remote areas.",
    minZoom: 10,
    color: "#0f766e",
    glyph: "⛽",
  },
  {
    id: "food",
    name: "Food",
    category: "stops",
    kind: "features",
    legend: "Restaurants, diners and fast food",
    source: "TomTom Search",
    caveat: "Provider POI data; hours are not shown and listings can be stale.",
    minZoom: 11,
    color: "#b45309",
    glyph: "🍴",
  },
  {
    id: "coffee",
    name: "Coffee",
    category: "stops",
    kind: "features",
    legend: "Cafés",
    source: "TomTom Search",
    caveat: "Provider POI data; hours are not shown and listings can be stale.",
    minZoom: 11,
    color: "#7c4a2d",
    glyph: "☕",
  },
  {
    id: "viewpoints",
    name: "Viewpoints",
    category: "stops",
    kind: "features",
    legend: "Scenic overlooks",
    source: "TomTom Search",
    caveat: "Provider POI category; access, parking and current availability are not checked.",
    minZoom: 9,
    color: "#7b4fa0",
    glyph: "◭",
  },
  {
    id: "camping",
    name: "Camping",
    category: "stops",
    kind: "features",
    legend: "Campgrounds",
    source: "TomTom Search",
    caveat: "Provider POI data; fees, seasons, site types and current availability are not verified.",
    minZoom: 9,
    color: "#4d7c0f",
    glyph: "⛺",
  },
  {
    id: "lodging",
    name: "Lodging",
    category: "stops",
    kind: "features",
    legend: "Hotels, motels and guest houses",
    source: "TomTom Search",
    caveat: "Provider POI data; rates and current availability are not shown.",
    minZoom: 10,
    color: "#9d174d",
    glyph: "⌂",
  },
  {
    id: "repair",
    name: "Motorcycle shops",
    category: "stops",
    kind: "features",
    legend: "Motorcycle dealers and repair",
    source: "TomTom Search",
    caveat: "Provider POI data; services and hours are not verified, and not every listed shop works on motorcycles.",
    minZoom: 9,
    color: "#334155",
    glyph: "🔧",
  },
  {
    id: "public-land",
    name: "Public land",
    category: "access",
    kind: "features",
    legend: "Parks, forests and game lands",
    source: "USGS PAD-US (OpenStreetMap fallback)",
    caveat: "Includes private protected land. Protection and general public access do not grant motorized access. Boundaries are generalized; survey dates vary. If PAD-US fails, OSM centres are explicitly labeled as fallback. Online only.",
    minZoom: 9,
    color: "#9da98f", colorToken: "--og-topo-sage",
    glyph: "▲",
  },
];

/**
 * One-tap sets of layers that answer one rider question together. A lens is
 * on when every one of its layers is on.
 */
export interface MapLayerLens {
  readonly id: string;
  readonly name: string;
  readonly hint: string;
  readonly glyph: string;
  readonly layers: readonly MapLayerId[];
}

export const MAP_LAYER_LENSES: readonly MapLayerLens[] = [
  { id: "fun", name: "Fun roads", hint: "Twisty, dirt and views", glyph: "∿", layers: ["great-roads", "gravel", "viewpoints", "hillshade"] },
  { id: "weather", name: "Weather", hint: "Rain and alerts", glyph: "☂", layers: ["weather-radar", "weather"] },
  { id: "traffic", name: "Traffic", hint: "Slowdowns and road work", glyph: "≋", layers: ["traffic-flow", "live-traffic", "work-zones"] },
  { id: "stops", name: "Gas and food", hint: "Fuel, food, coffee", glyph: "⛽", layers: ["fuel", "food", "coffee"] },
];

const LAYER_IDS = new Set<string>(MAP_LAYERS.map((layer) => layer.id));

export function isMapLayerId(value: string): value is MapLayerId {
  return LAYER_IDS.has(value);
}

export function mapLayer(id: MapLayerId): MapLayerDefinition {
  const found = MAP_LAYERS.find((layer) => layer.id === id);
  if (found === undefined) throw new Error(`Unknown map layer ${id}`);
  return found;
}

/** The feature layers among `ids`: what `/api/map-layers` is asked for. */
export function featureLayerIds(ids: readonly MapLayerId[]): readonly MapLayerId[] {
  return ids.filter((id) => mapLayer(id).kind === "features");
}
