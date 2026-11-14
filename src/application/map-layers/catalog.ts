/**
 * The rider's map layers (UX rework phase 8; SwitchBack parity for the layer
 * studio in `switchback/src/lib/client/map-layers.ts`).
 *
 * Each layer is information *about* the map, never ride state: turning one on
 * changes what the rider sees, not what the planner routes. Every definition
 * names its source and its limits, because a layer that looks authoritative but
 * is community-mapped is how a rider ends up on a closed forest road.
 */

import { WIND_ATTRIBUTION } from "./wind";

export type MapLayerCategory = "view" | "roads" | "conditions" | "stops" | "access";

export type MapLayerId =
  | "trails" | "trailheads" | "water-sources" | "shelters" | "summits" | "hunting-season" | "trail-closures"
  | "terrain-3d"
  | "hillshade"
  | "contours"
  | "slope"
  | "traffic-flow"
  | "live-traffic"
  | "traffic-cameras"
  | "weather"
  | "weather-radar"
  | "wind"
  | "active-fire"
  | "great-roads"
  | "gravel"
  | "rider-picked"
  | "road-history"
  | "fuel"
  | "food"
  | "coffee"
  | "camping"
  | "lodging"
  | "repair"
  | "viewpoints"
  | "public-land"
  | "mvum"
  | "work-zones";

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
  /**
   * The zoom above which the layer stops drawing, when its data cannot honestly
   * say anything finer than the arrow grid it came from.
   */
  readonly maxZoom?: number;
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
  { id: "trails", name: "Trails", category: "roads", kind: "features", legend: "Paths and hiking route relations", source: "OpenStreetMap", caveat: "Volunteer-mapped, so some trails are missing and conditions are not checked.", minZoom: 11, color: "#a34d38", glyph: "∿" },
  { id: "trailheads", name: "Trailheads", category: "stops", kind: "features", legend: "Mapped trailheads", source: "OpenStreetMap", caveat: "Volunteer-mapped; parking and facilities are not checked.", minZoom: 11, color: "#52704b", glyph: "▲" },
  { id: "water-sources", name: "Water sources", category: "stops", kind: "features", legend: "Springs and drinking water", source: "OpenStreetMap", caveat: "Volunteer-mapped; whether the water is running or safe to drink is not checked.", minZoom: 11, color: "#397c96", glyph: "●" },
  { id: "shelters", name: "Shelters and campsites", category: "stops", kind: "features", legend: "Mapped shelters and campsites", source: "OpenStreetMap", caveat: "Volunteer-mapped; whether a spot is open or allowed is not checked.", minZoom: 11, color: "#796446", glyph: "⌂" },
  { id: "summits", name: "Summits", category: "stops", kind: "features", legend: "Mapped peaks", source: "OpenStreetMap", caveat: "Volunteer-mapped, so some peaks may be missing.", minZoom: 11, color: "#7b4fa0", glyph: "▲" },
  { id: "hunting-season", name: "PA State Game Lands", category: "access", kind: "features", legend: "Season dates: check PGC", source: "Pennsylvania Game Commission", caveat: "Boundaries are simplified and season dates are not shown, so check the Pennsylvania Game Commission before you go.", minZoom: 9, color: "#b45309", glyph: "!" },
  { id: "trail-closures", name: "Trail closures", category: "access", kind: "features", legend: "Closures reported by land managers", source: "Not connected yet", caveat: "Not connected to a data source yet. Check with the land manager before you go.", minZoom: 9, color: "#a83e32", glyph: "!" },
  {
    id: "mvum", name: "Forest Service roads", category: "access", kind: "features",
    legend: "Green open to motorcycles, red closed",
    source: "US Forest Service motor vehicle use maps",
    caveat: "Roads missing from the map and dates not published stay unknown. A road being listed does not mean it is passable today, so check local Forest Service notices.",
    minZoom: 10, color: "#243a35", colorToken: "--og-deep-spruce", glyph: "⟋",
  },
  {
    id: "work-zones", name: "Road work", category: "conditions", kind: "features",
    legend: "Work zones and lane closures from the state",
    source: "State transportation departments (USDOT work zone data)",
    caveat: "Reports can be late or missing, which leaves a road unknown, not clear.",
    minZoom: 8, color: "#d65a36", colorToken: "--og-ember", glyph: "⚒",
  },
  {
    id: "active-fire", name: "Wildfires", category: "conditions", kind: "features",
    legend: "Fires seen by satellite in the last two days",
    source: "NASA satellite fire detections",
    caveat: "Hotspots are not road closures. Clouds and satellite timing can leave gaps.",
    minZoom: 5, color: "#bf4829", colorToken: "--og-ember-strong", glyph: "!",
  },
  {
    id: "weather-radar", name: "Rain radar", category: "conditions", kind: "raster",
    legend: "Rain now, the last two hours, and a 30-minute nowcast",
    source: "RainViewer, using NOAA and other national radar",
    caveat: "Stale frames are labelled. Radar can miss showers in gaps or behind hills, so no rain shown does not guarantee clear weather.",
    minZoom: 4, color: "#397c96", colorToken: "--og-signal-blue", glyph: "☂",
  },
  {
    id: "wind", name: "Wind", category: "conditions", kind: "features",
    legend: "Arrows point downwind; size and colour mean speed",
    source: WIND_ATTRIBUTION,
    caveat: "Covers the US only. A missing arrow means no reading, not calm air.",
    minZoom: 8, maxZoom: 12, color: "#397c96", glyph: "➤",
  },
  {
    id: "hillshade", name: "Hill shading", category: "view", kind: "view",
    legend: "Shaded hills so valleys and ridges pop", source: "Mapzen Terrarium terrain tiles",
    caveat: "Elevation resolution is roughly 100 to 300 ft, so small features do not show.",
    minZoom: 6, color: "#65745d", colorToken: "--og-trail-moss", glyph: "⛰",
  },
  {
    id: "contours", name: "Contour lines", category: "view", kind: "features",
    legend: "Elevation lines; closer lines mean steeper ground", source: "Mapzen Terrarium terrain tiles",
    caveat: "Elevation resolution is roughly 100 to 300 ft. Lines are drawn for the area on screen, and the spacing is shown on each line. Steep ground is not the same as a steep road.",
    minZoom: 6, color: "#776353", colorToken: "--og-trail-brown", glyph: "⛰",
  },
  {
    id: "slope", name: "Steep ground", category: "view", kind: "features",
    legend: "Amber is steep, red is very steep", source: "Mapzen Terrarium terrain tiles",
    caveat: "Elevation resolution is roughly 100 to 300 ft. It shows the ground, not the road. A road can be gentler than the hill beside it.",
    minZoom: 6, color: "#c99a46", colorToken: "--og-golden-hour", glyph: "⛰",
  },

  {
    id: "terrain-3d",
    name: "3D terrain",
    category: "view",
    kind: "view",
    legend: "Tilt the map to see the ridges you will climb",
    source: "Mapzen Terrarium terrain tiles",
    caveat: "Elevation resolution is roughly 100 feet. Drag with two fingers or right-click to tilt and turn.",
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
    source: "TomTom",
    caveat: "Live speeds on major roads. Smaller roads are often not covered.",
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
    source: "TomTom",
    caveat: "Only what has been reported. A road with no report is not guaranteed clear.",
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
    source: "State transportation departments (511)",
    caveat: "Coverage differs by state, and a camera shows only the spot it points at.",
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
    legend: "Storm, flood and wind warnings at the map center",
    source: "National Weather Service",
    caveat: "Covers the US only. It checks the map center, not every visible point, so move the map to check somewhere else.",
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
    source: "OpenGravel road shape analysis",
    caveat: "Scored from the shape of the road, so it is approximate and not ridden-checked.",
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
    source: "OpenGravel Gravel Atlas, built on OpenStreetMap surface tags",
    caveat: "Closed, private and seasonal roads are left out. A road not drawn is unknown, not paved, and dirt does not mean passable today.",
    minZoom: 8,
    color: "#776353",
    glyph: "⋯",
  },
  {
    id: "rider-picked",
    name: "Rider-picked rides",
    category: "roads",
    kind: "features",
    legend: "Thin plum lines: real rides picked by people who ride here. Tap one.",
    source: "From PA Adventure Bike Rides",
    caveat: "These rides come from the group that published them, drawn as a simplified outline when zoomed out. Their surface and distance summary is copied, not checked. Tap a line to read it; nothing opens until you tap \"Ride this\".",
    minZoom: 6,
    maxZoom: 10,
    color: "#8f6fa6",
    glyph: "≋",
  },
  {
    id: "road-history",
    name: "Roads you’ve ridden",
    category: "roads",
    kind: "features",
    legend: "Good roads from your saved rides",
    source: "Your saved rides and OpenGravel road data",
    caveat: "An estimate from rides on this device, not a full riding history.",
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
    caveat: "Hours and prices are not checked. Call ahead in remote areas.",
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
    caveat: "Hours are not shown and listings can be out of date.",
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
    caveat: "Hours are not shown and listings can be out of date.",
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
    caveat: "Parking and access are not checked.",
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
    caveat: "Fees, seasons and availability are not checked.",
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
    caveat: "Rates and availability are not shown.",
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
    caveat: "Services and hours are not checked, and not every listed shop works on motorcycles.",
    minZoom: 9,
    color: "#334155",
    glyph: "🔧",
  },
  {
    id: "public-land",
    name: "Public land",
    category: "access",
    kind: "features",
    legend: "Parks, forests and game lands open to visit",
    source: "USGS PAD-US (OpenStreetMap fallback)",
    caveat: "Includes private protected land. Public land does not grant motorized access, and boundaries are simplified.",
    minZoom: 9,
    color: "#9da98f", colorToken: "--og-topo-sage",
    glyph: "▲",
  },
];

/**
 * The one rider sentence for each layer in its info sheet: what it is and what
 * it is for. Where the data comes from, and its limits, live under "About this
 * data" (`source` and `caveat`), also in plain words.
 */
const LAYER_ABOUT: Readonly<Record<MapLayerId, string>> = {
  "trails": "Paths and hiking trails you can follow.",
  "trailheads": "Where trails start.",
  "water-sources": "Springs and drinking water along the way.",
  "shelters": "Shelters and campsites you can stop at.",
  "summits": "Named peaks and high points.",
  "hunting-season": "State game lands, where hunting seasons can affect when you should ride.",
  "trail-closures": "Trail closures.",
  "mvum": "National Forest roads where motorcycles are allowed (green) or not (red).",
  "work-zones": "Road work and lane closures, so you can avoid slow or blocked roads.",
  "active-fire": "Wildfires spotted by satellite in the last two days.",
  "weather-radar": "Where it is raining now, the last two hours, and the next 30 minutes.",
  "wind": "Which way the wind is blowing and how hard.",
  "hillshade": "Shaded hills so ridges and valleys stand out.",
  "contours": "Elevation lines in feet: the closer together, the steeper the ground.",
  "slope": "Steep ground in amber and very steep in red.",
  "terrain-3d": "Tilt the map to see the ridges you will climb.",
  "traffic-flow": "How fast traffic is moving: green is moving, amber is slow, red is stopped.",
  "live-traffic": "Crashes and closures reported right now.",
  "traffic-cameras": "Live views of the road from highway cameras. Tap one to look.",
  "weather": "Storm, flood and wind warnings for the middle of the map.",
  "great-roads": "Roads with the most bends; hotter, thicker lines are twistier.",
  "gravel": "Dirt and gravel roads, thicker where the dirt is better.",
  "rider-picked": "Rides picked by people who ride here. Tap a line to read it.",
  "road-history": "Good roads from your saved rides.",
  "fuel": "Gas stations.",
  "food": "Restaurants, diners and fast food.",
  "coffee": "Coffee shops.",
  "camping": "Campgrounds.",
  "lodging": "Hotels, motels and guest houses.",
  "repair": "Motorcycle dealers and repair shops.",
  "viewpoints": "Scenic overlooks worth a stop.",
  "public-land": "Parks, forests and game lands you can visit.",
};

export function layerAbout(id: MapLayerId): string {
  return LAYER_ABOUT[id];
}

/** Layers with no working data source yet: kept in the catalog, never offered to a rider. */
const UNAVAILABLE_LAYERS: ReadonlySet<MapLayerId> = new Set<MapLayerId>(["trail-closures"]);

export function isLayerAvailable(id: MapLayerId): boolean {
  return !UNAVAILABLE_LAYERS.has(id);
}

/** The layers a rider can actually turn on. */
export const RIDER_MAP_LAYERS: readonly MapLayerDefinition[] = MAP_LAYERS.filter((layer) => isLayerAvailable(layer.id));

/**
 * Every string a rider can read about a layer, for the copy test: name, legend,
 * the one-sentence about, and the data-source detail.
 */
export function layerRiderCopy(layer: MapLayerDefinition): readonly string[] {
  return [layer.name, layer.legend, layerAbout(layer.id), layer.source, layer.caveat];
}

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
  // Riding first: the four sets a rider asks for are always in this order.
  { id: "fun", name: "Fun roads", hint: "Twisty, dirt and views", glyph: "∿", layers: ["great-roads", "gravel", "viewpoints", "hillshade"] },
  { id: "weather", name: "Weather", hint: "Rain, wind and alerts", glyph: "☂", layers: ["weather-radar", "wind", "weather"] },
  { id: "stops", name: "Gas and food", hint: "Fuel, food, coffee", glyph: "⛽", layers: ["fuel", "food", "coffee"] },
  { id: "traffic", name: "Traffic", hint: "Slowdowns and road work", glyph: "≋", layers: ["traffic-flow", "live-traffic", "work-zones"] },
  // The hiking surface (frozen) keeps its whole set, listed only when the
  // rider's planning activity is Hike.
  { id: "hiking", name: "Hiking", hint: "Trails, terrain and trail stops", glyph: "▲", layers: ["trails", "trailheads", "water-sources", "shelters", "summits", "viewpoints", "hillshade", "contours"] },
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
