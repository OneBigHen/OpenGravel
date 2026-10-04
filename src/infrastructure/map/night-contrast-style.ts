/**
 * Night contrast: OpenGravel's own dark-gray, high-contrast basemap.
 *
 * It is a custom Mapbox map built at load time rather than in Mapbox Studio:
 * the hosted `navigation-night-v1` style supplies the vector tiles, the road
 * hierarchy, the shields and the label placement, and {@link toNightContrast}
 * repaints it. Building it here keeps it in version control, needs only the
 * public token, and lets MapLibre apply it through `setStyle`'s
 * `transformStyle` hook.
 *
 * The palette is meant for a bar-mounted screen in the dark and in glare:
 *
 * - neutral dark-gray land, darker blue-black water, so nothing glows;
 * - roads get *brighter* with importance (navigation-night draws them darker
 *   than the land), on near-black casings, so the road network reads at a glance;
 * - unpaved roads are tan, the one thing a gravel rider looks for;
 * - every label is near-white on a heavy dark halo;
 * - live traffic and incident layers are dropped: OpenGravel has its own
 *   traffic overlay, and colored congestion would fight the ride line.
 *
 * Pure and dependency-free, so the repaint is unit-tested without a renderer.
 */

/** The hosted style the night map starts from. */
export const NIGHT_CONTRAST_BASE_STYLE_URL = "mapbox://styles/mapbox/navigation-night-v1";

/** The basemap looks a rider can choose (satellite is drawn as a layer on Map). */
export type BasemapLook = "map" | "night" | "satellite";

export const BASEMAP_LOOKS: readonly BasemapLook[] = ["map", "night", "satellite"];

export function isBasemapLook(value: unknown): value is BasemapLook {
  return value === "map" || value === "night" || value === "satellite";
}

/** The palette, exported so tests and the legend agree on one value. */
export const NIGHT_CONTRAST = {
  land: "hsl(210, 5%, 13%)",
  landuse: "hsl(210, 5%, 16%)",
  park: "hsl(150, 14%, 17%)",
  water: "hsl(210, 42%, 22%)",
  waterLine: "hsl(210, 42%, 26%)",
  building: "hsl(210, 4%, 20%)",
  casing: "hsl(210, 6%, 6%)",
  motorway: "hsl(40, 30%, 90%)",
  primary: "hsl(0, 0%, 84%)",
  secondary: "hsl(0, 0%, 72%)",
  street: "hsl(0, 0%, 56%)",
  minor: "hsl(0, 0%, 44%)",
  path: "hsl(0, 0%, 40%)",
  unpaved: "hsl(34, 58%, 60%)",
  rail: "hsl(0, 0%, 32%)",
  boundary: "hsl(0, 0%, 46%)",
  label: "hsl(0, 0%, 94%)",
  labelSoft: "hsl(0, 0%, 78%)",
  waterLabel: "hsl(205, 40%, 70%)",
  halo: "hsl(210, 8%, 5%)",
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

/** Unpaved roads read tan; everything else keeps its class colour. */
function surfaceAware(color: string): unknown {
  return ["match", ["get", "surface"], "unpaved", NIGHT_CONTRAST.unpaved, color];
}

/** The fill colour of one road line layer, by the class its id names. */
function roadFill(id: string): unknown {
  if (/motorway|trunk/.test(id)) return NIGHT_CONTRAST.motorway;
  if (/major-link/.test(id)) return NIGHT_CONTRAST.primary;
  if (/primary/.test(id)) return NIGHT_CONTRAST.primary;
  if (/secondary|tertiary/.test(id)) return surfaceAware(NIGHT_CONTRAST.secondary);
  if (/street/.test(id)) return surfaceAware(NIGHT_CONTRAST.street);
  if (/construction/.test(id)) return NIGHT_CONTRAST.minor;
  if (/path|steps|pedestrian|trail/.test(id)) return surfaceAware(NIGHT_CONTRAST.path);
  return surfaceAware(NIGHT_CONTRAST.minor);
}

function isRoadLine(layer: StyleLayer): boolean {
  return layer.type === "line" && /^(road|bridge|tunnel)-/.test(layer.id) && !/rail/.test(layer.id);
}

function repaint(layer: StyleLayer): StyleLayer {
  const paint: Record<string, unknown> = { ...(layer.paint ?? {}) };
  const id = layer.id;
  switch (layer.type) {
    case "background":
      paint["background-color"] = NIGHT_CONTRAST.land;
      break;
    case "fill":
      if (id === "water") paint["fill-color"] = NIGHT_CONTRAST.water;
      else if (/national-park|park/.test(id)) paint["fill-color"] = NIGHT_CONTRAST.park;
      else if (/building/.test(id)) paint["fill-color"] = NIGHT_CONTRAST.building;
      else if (/landcover/.test(id)) paint["fill-color"] = NIGHT_CONTRAST.park;
      else if (/landuse|aeroway|pitch/.test(id)) paint["fill-color"] = NIGHT_CONTRAST.landuse;
      else paint["fill-color"] = NIGHT_CONTRAST.land;
      break;
    case "line":
      if (id === "waterway") paint["line-color"] = NIGHT_CONTRAST.waterLine;
      else if (/rail/.test(id)) paint["line-color"] = NIGHT_CONTRAST.rail;
      else if (/admin|boundary/.test(id)) {
        paint["line-color"] = /-bg$/.test(id) ? NIGHT_CONTRAST.land : NIGHT_CONTRAST.boundary;
      } else if (isRoadLine(layer)) {
        paint["line-color"] = /case/.test(id) ? NIGHT_CONTRAST.casing : roadFill(id);
        // Tunnels recede a step, as they do on every road map.
        if (/^tunnel-/.test(id)) paint["line-opacity"] = 0.55;
      } else if (/building/.test(id)) paint["line-color"] = NIGHT_CONTRAST.casing;
      else if (/land-structure/.test(id)) paint["line-color"] = NIGHT_CONTRAST.land;
      break;
    case "symbol":
      if (paint["text-color"] !== undefined || layer.layout?.["text-field"] !== undefined) {
        const water = /water/.test(id);
        const soft = /poi|natural|subdivision|ferry/.test(id);
        // Shields keep their own colours on their own plates.
        if (!/shield/.test(id)) {
          paint["text-color"] = water
            ? NIGHT_CONTRAST.waterLabel
            : soft
              ? NIGHT_CONTRAST.labelSoft
              : NIGHT_CONTRAST.label;
          paint["text-halo-color"] = NIGHT_CONTRAST.halo;
          paint["text-halo-width"] = 1.6;
          paint["text-halo-blur"] = 0.4;
        }
      }
      break;
    default:
      break;
  }
  return { ...layer, paint };
}

/**
 * Repaints a navigation-night style document into Night contrast. Layers and
 * sources this map does not want are dropped; everything else keeps its
 * geometry, filters, zoom ranges and layout. The input is not mutated.
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
