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
  | "traffic-flow"
  | "live-traffic"
  | "weather"
  | "closures"
  | "great-roads"
  | "gravel"
  | "fuel"
  | "food"
  | "coffee"
  | "camping"
  | "lodging"
  | "repair"
  | "viewpoints"
  | "public-land"
  | "forest-roads"
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
    id: "terrain-3d",
    name: "3D terrain",
    category: "view",
    kind: "view",
    legend: "Tilt the map and see the ridges your ride climbs",
    source: "AWS Terrain Tiles (Mapzen Terrarium)",
    caveat: "Elevation at roughly 30 m resolution; drag with two fingers or right-click to tilt and turn.",
    minZoom: 0,
    color: "#65745d",
    glyph: "⛰",
  },
  {
    id: "traffic-flow",
    name: "Traffic flow",
    category: "conditions",
    kind: "raster",
    legend: "Green flows, amber slows, red crawls",
    source: "TomTom Traffic Flow",
    caveat: "Live speeds relative to free flow on major roads; minor roads are often not covered.",
    minZoom: 6,
    color: "#3e6b55",
    glyph: "≋",
  },
  {
    id: "live-traffic",
    name: "Incidents and closures",
    category: "conditions",
    kind: "features",
    legend: "Crashes, closures and road works reported now",
    source: "TomTom Traffic Incidents",
    caveat: "Provider reports only; a road with no report is not proof that it is clear.",
    minZoom: 8,
    color: "#a83e32",
    glyph: "!",
  },
  {
    id: "weather",
    name: "Weather alerts",
    category: "conditions",
    kind: "features",
    legend: "Active National Weather Service alert areas",
    source: "National Weather Service",
    caveat: "US only. Alert polygons follow NWS cadence and precision.",
    minZoom: 4,
    color: "#1e5aa8",
    glyph: "☂",
  },
  {
    id: "closures",
    name: "Construction",
    category: "conditions",
    kind: "features",
    legend: "Mapped road construction",
    source: "OpenStreetMap",
    caveat: "Community-mapped, not a live closure feed; a mapped zone may have reopened.",
    minZoom: 10,
    color: "#bf4829",
    glyph: "⚒",
  },
  {
    id: "great-roads",
    name: "Great riding roads",
    category: "roads",
    kind: "features",
    legend: "Warmer and heavier line = twistier road",
    source: "OpenGravel road-shape analysis",
    caveat: "Scored from road geometry by bend density; approximate, not ground-truthed.",
    minZoom: 8,
    color: "#d65a36",
    glyph: "∿",
  },
  {
    id: "gravel",
    name: "Known gravel",
    category: "roads",
    kind: "features",
    legend: "Dashed tan = surveyed gravel corridor",
    source: "OpenGravel Gravel Atlas",
    caveat: "Surface evidence only; not proof of legal access or current passability. Regional coverage.",
    minZoom: 8,
    color: "#776353",
    glyph: "⋯",
  },
  {
    id: "fuel",
    name: "Fuel",
    category: "stops",
    kind: "features",
    legend: "Gas stations",
    source: "OpenStreetMap",
    caveat: "Hours, prices and ethanol-free pumps are not tracked. Call ahead in remote areas.",
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
    source: "OpenStreetMap",
    caveat: "Community-mapped; hours are not tracked.",
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
    source: "OpenStreetMap",
    caveat: "Community-mapped; hours are not tracked.",
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
    source: "OpenStreetMap",
    caveat: "Community-mapped; access and parking are not checked.",
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
    source: "OpenStreetMap",
    caveat: "Fees, seasons and site types are not tracked.",
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
    source: "OpenStreetMap",
    caveat: "Rates and availability are not tracked.",
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
    source: "OpenStreetMap",
    caveat: "Services and hours are not tracked; not every shop works on motorcycles.",
    minZoom: 9,
    color: "#334155",
    glyph: "🔧",
  },
  {
    id: "public-land",
    name: "Parks and public land",
    category: "access",
    kind: "features",
    legend: "Protected areas and nature reserves",
    source: "OpenStreetMap",
    caveat: "Mapped boundaries are approximate and are not a legal determination.",
    minZoom: 9,
    color: "#3f6212",
    glyph: "▲",
  },
  {
    id: "forest-roads",
    name: "Forest roads",
    category: "access",
    kind: "features",
    legend: "Mapped Forest Service roads",
    source: "OpenStreetMap",
    caveat: "Always check the current Motor Vehicle Use Map before riding one.",
    minZoom: 9,
    color: "#166534",
    glyph: "⟋",
  },
  {
    id: "cell-towers",
    name: "Cell towers",
    category: "access",
    kind: "features",
    legend: "Mapped towers, a hint of coverage",
    source: "OpenStreetMap",
    caveat: "Tower locations only; not signal strength or carrier coverage.",
    minZoom: 9,
    color: "#64748b",
    glyph: "⌁",
  },
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
