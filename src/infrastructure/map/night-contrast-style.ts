/**
 * Night terrain: OpenGravel's own dark basemap, built on Mapbox Outdoors.
 *
 * It is a Mapbox style repainted at load time rather than authored in Mapbox
 * Studio: `mapbox://styles/mapbox/outdoors-v12` supplies the vector tiles, the
 * terrain and contour sources, the road hierarchy, the shields and the label
 * placement, and {@link toNightContrast} turns it into Night terrain. Building
 * it here keeps it in version control, needs only the public token, and lets
 * MapLibre apply it through `setStyle`'s `transformStyle` hook. With no token
 * the host falls back to OpenFreeMap `dark`.
 *
 * The look is green-black terrain, not the old flat grey: a bar-mounted screen
 * in the dark still has to show a rider where the ridges and the gravel are,
 * and `navigation-night-v1` drew almost nothing in the forest.
 *
 * - land is green-black; forest and public land lift clearly above it but stay
 *   darker than any road;
 * - hillshade is the hero and always on, with a cold shadow and a green
 *   highlight, so ridge-and-valley grain survives at night;
 * - contours are faint at 35% (index lines brighter), so a climb reads without
 *   a contour map's clutter;
 * - roads get *brighter* with importance, on near-black casings; gravel is tan
 *   and tracks are dashed, and a road with an unknown surface is grey and
 *   dotted, never painted as paved and never as gravel;
 * - labels sit in a dark halo: place names are the brightest ink on the map,
 *   road names a step quieter, and no colour is pure white;
 * - patterns (wetland, pedestrian, cliff) are dropped rather than recoloured,
 *   because a light sprite cannot be darkened;
 * - live traffic and incident layers are dropped: OpenGravel has its own
 *   traffic overlay, and coloured congestion would fight the ride line.
 *
 * Pure and dependency-free, so the repaint is unit-tested without a renderer.
 */

/** The hosted style Night terrain starts from. */
export const NIGHT_CONTRAST_BASE_STYLE_URL = "mapbox://styles/mapbox/outdoors-v12";

/** The basemap looks a rider can choose (satellite is drawn as a layer on Map). */
export type BasemapLook = "map" | "night" | "satellite";

export const BASEMAP_LOOKS: readonly BasemapLook[] = ["map", "night", "satellite"];

export function isBasemapLook(value: unknown): value is BasemapLook {
  return value === "map" || value === "night" || value === "satellite";
}

/**
 * The palette, exported so tests, the legend and the tokens agree on one value.
 *
 * Every entry is at or below 92% lightness: there is no pure white on Night
 * terrain, and the brightest ink is the place label.
 */
export const NIGHT_CONTRAST = {
  land: "#0f1512",
  forest: "#15251c",
  parkEdge: "#3f6b52",
  hillshadeShadow: "#04070a",
  hillshadeHighlight: "#3a4d43",
  contour: "#4a5c53",
  contourIndex: "#5f7268",
  water: "#0c1c26",
  waterLine: "#1d3a4a",
  builtUp: "#171c1a",
  casing: "#0b100e",
  motorway: "#8e9994",
  primary: "#b9c2bd",
  minor: "#7a857f",
  unpaved: "#d6a862",
  path: "#6d7a73",
  rail: "#3a443f",
  boundary: "#46504b",
  muted: "#2b3833",
  label: "#dfe6e2",
  labelSoft: "#a2aea8",
  roadLabel: "#aab4ae",
  waterLabel: "#6f9bb3",
  halo: "#0b100e",
  shieldPlate: "#1d2724",
} as const;

interface StyleLayer {
  id: string;
  type: string;
  source?: string;
  paint?: Record<string, unknown>;
  layout?: Record<string, unknown>;
  [key: string]: unknown;
}

interface StyleDocument {
  sources?: Record<string, unknown>;
  layers?: StyleLayer[];
  [key: string]: unknown;
}

const DROPPED_LAYER = /^(traffic-|incident-)|road-intersection|turning-feature/;
const DROPPED_SOURCES = ["mapbox-traffic", "mapbox-incidents"];

const UNPAVED: unknown = ["==", ["get", "surface"], "unpaved"];
const HAS_SURFACE: unknown = ["has", "surface"];
const SOLID: unknown = ["literal", [1, 0]];
const DOTTED: unknown = ["literal", [0.4, 1.2]];
const TRACK_DASH: unknown = ["literal", [3, 2]];

/** One hex colour laid over the map at an alpha, for hillshade and depth. */
function wash(hex: string, alpha: number): string {
  const value = Number.parseInt(hex.slice(1), 16);
  return `rgba(${(value >> 16) & 255}, ${(value >> 8) & 255}, ${value & 255}, ${alpha})`;
}

/** The paved colour, swapped for tan only when the data says `unpaved`. */
function surfaceAware(paved: string): unknown {
  return ["match", ["get", "surface"], "unpaved", NIGHT_CONTRAST.unpaved, paved];
}

/** A dotted line wherever the tiles do not say the surface is known. */
function unknownDots(): unknown {
  return ["case", HAS_SURFACE, SOLID, DOTTED];
}

/**
 * Gravel is drawn half a pixel wider than the paved road of its class. The
 * zoom interpolation has to stay the top-level expression, so the `unpaved`
 * test goes into each stop's value rather than around the whole width.
 */
function gravelWidth(width: unknown): unknown {
  if (!Array.isArray(width) || width[0] !== "interpolate") return width;
  const widened: unknown[] = [...width];
  for (let index = 4; index < widened.length; index += 2) {
    const stop = widened[index];
    if (typeof stop === "number") widened[index] = ["case", UNPAVED, stop + 0.5, stop];
  }
  return widened;
}

/**
 * Outdoors draws every road twice: a `*-case` line whose gap width is the road
 * body, and a body line on top. The body layer's class, stripped of its
 * `road-` / `bridge-` / `tunnel-` prefix.
 */
function roadBase(id: string): string {
  return id.replace(/^(road|bridge|tunnel)-/, "").replace(/-case$/, "");
}

function roadColour(base: string): unknown {
  if (/motorway|trunk|major-link/.test(base)) return NIGHT_CONTRAST.motorway;
  if (/^primary$|^minor-link$/.test(base)) return NIGHT_CONTRAST.primary;
  if (/^secondary|^tertiary/.test(base)) return surfaceAware(NIGHT_CONTRAST.primary);
  if (base === "minor") {
    return ["match", ["get", "class"], "track", NIGHT_CONTRAST.unpaved, surfaceAware(NIGHT_CONTRAST.minor)];
  }
  return surfaceAware(NIGHT_CONTRAST.minor);
}

/**
 * Tracks are dashed tan; secondary/tertiary and service roads are dotted where
 * the tiles do not say the surface is known. Paved-by-class roads (motorways,
 * primaries) keep a solid line.
 */
function roadDash(base: string): unknown | undefined {
  if (/path|steps|pedestrian|cycleway|piste|trail/.test(base)) return undefined;
  if (/motorway|trunk|major-link|^primary$|^minor-link$|^street/.test(base)) return undefined;
  if (/^secondary|^tertiary|^construction/.test(base)) return unknownDots();
  if (base === "minor") {
    return ["case", ["==", ["get", "class"], "track"], TRACK_DASH, unknownDots()];
  }
  return undefined;
}

/** Hillshade keeps its own zoom fade; only the two ends are recoloured here. */
function hillshadeColour(): unknown {
  const shadow = wash(NIGHT_CONTRAST.hillshadeShadow, 0.55);
  const highlight = wash(NIGHT_CONTRAST.hillshadeHighlight, 0.3);
  const shadowOff = wash(NIGHT_CONTRAST.hillshadeShadow, 0);
  const highlightOff = wash(NIGHT_CONTRAST.hillshadeHighlight, 0);
  return [
    "interpolate",
    ["linear"],
    ["zoom"],
    14,
    ["match", ["get", "class"], "shadow", shadow, highlight],
    16,
    ["match", ["get", "class"], "shadow", shadowOff, highlightOff],
  ];
}

function isRoadLine(layer: StyleLayer): boolean {
  return (
    layer.type === "line" &&
    /^(road|bridge|tunnel)-/.test(layer.id) &&
    !/-(rail|rail-tracks)$/.test(layer.id)
  );
}

/**
 * Mutes a sprite icon. Icons are raster, so opacity is the only lever, and a
 * zoom-based opacity cannot be scaled inside another expression: those layers
 * lose the sprite and keep their text instead.
 */
function iconOpacity(id: string, opacity: unknown): unknown {
  if (/poi|natural|transit|airport/.test(id)) return 0;
  if (typeof opacity === "number") return opacity * 0.5;
  if (opacity !== undefined) return 0;
  return 0.4;
}

function repaintLine(layer: StyleLayer, paint: Record<string, unknown>): void {
  const id = layer.id;
  const base = roadBase(id);
  delete paint["line-pattern"];
  if (/^rail/.test(base)) {
    paint["line-color"] = NIGHT_CONTRAST.rail;
  } else if (/^waterway/.test(id)) {
    paint["line-color"] = NIGHT_CONTRAST.waterLine;
  } else if (/^ferry/.test(base)) {
    paint["line-color"] = NIGHT_CONTRAST.waterLine;
  } else if (id === "contour-line") {
    // 35% contours, index lines brighter, so a climb reads at night.
    paint["line-color"] = [
      "match",
      ["get", "index"],
      [5, 10],
      NIGHT_CONTRAST.contourIndex,
      NIGHT_CONTRAST.contour,
    ];
    paint["line-opacity"] = ["match", ["get", "index"], [5, 10], 0.55, 0.35];
  } else if (/national-park/.test(id)) {
    // Public land edge: one quiet dashed green line, not a bright band.
    paint["line-color"] = NIGHT_CONTRAST.parkEdge;
    paint["line-opacity"] = 0.5;
    paint["line-width"] = 1;
    paint["line-blur"] = 0;
    paint["line-dasharray"] = ["literal", [2, 2]];
  } else if (/admin|boundary/.test(id)) {
    paint["line-color"] = /-bg$/.test(id) ? NIGHT_CONTRAST.land : NIGHT_CONTRAST.boundary;
  } else if (isRoadLine(layer)) {
    const caseLine = /-case$/.test(id) || /-bg$/.test(id);
    if (caseLine) {
      paint["line-color"] = NIGHT_CONTRAST.casing;
    } else if (/path|pedestrian|cycleway|piste|trail|steps/.test(base)) {
      paint["line-color"] = NIGHT_CONTRAST.path;
    } else {
      paint["line-color"] = roadColour(base);
      const dash = roadDash(base);
      if (dash !== undefined) paint["line-dasharray"] = dash;
      else delete paint["line-dasharray"];
      if (/^secondary|^tertiary|^minor$/.test(base) && paint["line-width"] !== undefined) {
        paint["line-width"] = gravelWidth(paint["line-width"]);
      }
    }
    // Tunnels recede a step, as they do on every road map.
    if (/^tunnel-/.test(id)) paint["line-opacity"] = 0.55;
  } else if (/building/.test(id)) {
    paint["line-color"] = NIGHT_CONTRAST.casing;
  } else if (/land-structure/.test(id)) {
    paint["line-color"] = NIGHT_CONTRAST.land;
  } else {
    paint["line-color"] = NIGHT_CONTRAST.muted;
  }
}

/** Forest classes inside the shared landcover/landuse fills. */
function landCoverColour(): unknown {
  return [
    "match",
    ["get", "class"],
    ["wood", "scrub", "grass", "park", "cemetery", "crop", "agriculture"],
    NIGHT_CONTRAST.forest,
    NIGHT_CONTRAST.builtUp,
  ];
}

function repaintFill(layer: StyleLayer, paint: Record<string, unknown>): void {
  const id = layer.id;
  delete paint["fill-pattern"];
  switch (id) {
    case "water":
    case "water-shadow":
    case "wetland":
    case "wetland-pattern":
      paint["fill-color"] = NIGHT_CONTRAST.water;
      break;
    case "water-depth":
      paint["fill-color"] = wash(NIGHT_CONTRAST.water, 0.35);
      break;
    case "hillshade":
      paint["fill-color"] = hillshadeColour();
      break;
    case "landcover":
      paint["fill-color"] = landCoverColour();
      break;
    case "landuse":
      paint["fill-color"] = landCoverColour();
      break;
    case "national-park":
      paint["fill-color"] = NIGHT_CONTRAST.forest;
      break;
    case "building":
    case "building-underground":
    case "aeroway-polygon":
    case "road-pedestrian-polygon-fill":
    case "road-pedestrian-polygon-pattern":
      paint["fill-color"] = NIGHT_CONTRAST.builtUp;
      break;
    case "land-structure-polygon":
      paint["fill-color"] = NIGHT_CONTRAST.land;
      break;
    default:
      paint["fill-color"] = NIGHT_CONTRAST.land;
      break;
  }
  if (paint["fill-outline-color"] !== undefined) paint["fill-outline-color"] = NIGHT_CONTRAST.casing;
}

function repaintSymbol(layer: StyleLayer, paint: Record<string, unknown>): void {
  const id = layer.id;
  const hasText = paint["text-color"] !== undefined || layer.layout?.["text-field"] !== undefined;
  if (/shield/.test(id)) {
    // Outdoors' shield sprites are light lozenges; at night the plate is a
    // dark halo around the ref text instead.
    paint["text-color"] = NIGHT_CONTRAST.roadLabel;
    paint["text-halo-color"] = NIGHT_CONTRAST.shieldPlate;
    paint["text-halo-width"] = 2;
    paint["icon-opacity"] = 0;
  } else if (hasText) {
    if (/contour/.test(id)) {
      paint["text-color"] = NIGHT_CONTRAST.contourIndex;
      paint["text-halo-color"] = NIGHT_CONTRAST.halo;
      paint["text-halo-width"] = 1;
    } else {
      const water = /water|ferry/.test(id);
      const road = /^(road|path-pedestrian)-/.test(id);
      const place = /settlement|state|country|continent/.test(id);
      const soft = /poi|natural|transit|airport|subdivision|building|block|gate|golf/.test(id);
      paint["text-color"] = water
        ? NIGHT_CONTRAST.waterLabel
        : road
          ? NIGHT_CONTRAST.roadLabel
          : place
            ? NIGHT_CONTRAST.label
            : soft
              ? NIGHT_CONTRAST.labelSoft
              : NIGHT_CONTRAST.label;
      paint["text-halo-color"] = NIGHT_CONTRAST.halo;
      paint["text-halo-width"] = 1.5;
      paint["text-halo-blur"] = 0.4;
    }
  }
  if (layer.layout?.["icon-image"] !== undefined && !/shield/.test(id)) {
    paint["icon-opacity"] = iconOpacity(id, paint["icon-opacity"]);
  }
}

function repaint(layer: StyleLayer): StyleLayer {
  const paint: Record<string, unknown> = { ...(layer.paint ?? {}) };
  switch (layer.type) {
    case "background":
      paint["background-color"] = NIGHT_CONTRAST.land;
      break;
    case "fill":
      repaintFill(layer, paint);
      break;
    case "line":
      repaintLine(layer, paint);
      break;
    case "symbol":
      repaintSymbol(layer, paint);
      break;
    case "circle":
      paint["circle-color"] = NIGHT_CONTRAST.muted;
      paint["circle-stroke-color"] = NIGHT_CONTRAST.casing;
      break;
    default:
      break;
  }
  return { ...layer, paint };
}

/**
 * Repaints an Outdoors style document into Night terrain. Layers and sources
 * this map does not want are dropped; everything else keeps its geometry,
 * filters, zoom ranges and layout. The input is not mutated.
 */
export function toNightContrast<T extends StyleDocument>(style: T): T {
  const sources = { ...(style.sources ?? {}) };
  for (const id of DROPPED_SOURCES) delete sources[id];
  const layers = (style.layers ?? [])
    .filter((layer) => !DROPPED_LAYER.test(layer.id))
    .filter((layer) => layer.source === undefined || layer.source in sources)
    .map(repaint);
  return { ...style, sources, layers };
}
