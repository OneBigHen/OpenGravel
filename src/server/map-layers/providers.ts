/**
 * Providers behind `/api/map-layers` (UX rework phase 8). Each one turns a
 * bounded view into `InfoFeature`s for the layers it owns and throws when it
 * cannot answer, so the handler can report it as unavailable instead of
 * pretending the view is empty.
 *
 * - TomTom Search (nearbySearch by category) for stops: fuel, food, coffee,
 *   lodging, camping, motorcycle dealers and viewpoints.
 * - TomTom Traffic Incidents v5 for live incidents and closures.
 * - The National Weather Service for active alerts.
 * - The local curvature and Gravel Atlas catalogues for great roads and gravel.
 * - OpenStreetMap through Overpass for land, forest roads, construction and
 *   towers; public mirrors are tried in turn because the main one is often busy.
 */

import type {
  InfoFeature,
  InfoGeometry,
  InfoProvider,
  LngLat,
  MapLayerBounds,
  MapLayerId,
} from "@/application/map-layers";
import { MIN_GREAT_ROAD_RATING, type KnownRoadsPort } from "@/application/roads/known-roads";

export interface ProviderContext {
  readonly fetch: typeof fetch;
  readonly signal?: AbortSignal;
  readonly env: Readonly<Record<string, string | undefined>>;
}

export interface LayerProvider {
  readonly id: InfoProvider;
  readonly layers: readonly MapLayerId[];
  /** How long an answer for one view stays good. */
  readonly ttlMs: number;
  load(bounds: MapLayerBounds, layers: readonly MapLayerId[], context: ProviderContext): Promise<readonly InfoFeature[]>;
}

function record(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function text(value: unknown): string | null {
  return typeof value === "string" && value.trim() !== "" ? value.trim() : null;
}

function finite(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function round(value: number): number {
  return Math.round(value * 1e5) / 1e5;
}

function lngLat(lon: unknown, lat: unknown): LngLat | null {
  return finite(lon) && finite(lat) && Math.abs(lon) <= 180 && Math.abs(lat) <= 90
    ? [round(lon), round(lat)]
    : null;
}

function inside(bounds: MapLayerBounds, point: LngLat): boolean {
  return point[0] >= bounds.west && point[0] <= bounds.east && point[1] >= bounds.south && point[1] <= bounds.north;
}

function withTimeout(signal: AbortSignal | undefined, ms: number): AbortSignal {
  const timeout = AbortSignal.timeout(ms);
  return signal === undefined ? timeout : AbortSignal.any([signal, timeout]);
}

function tomtomKey(env: ProviderContext["env"]): string | null {
  const key = env["TOMTOM_API_KEY"] ?? env["TOMTOM_TRAFFIC_API_KEY"];
  return key === undefined || key.trim() === "" ? null : key.trim();
}

/** Half the view's diagonal in metres: the search radius that covers it. */
function coveringRadiusMeters(bounds: MapLayerBounds): number {
  const midLat = ((bounds.south + bounds.north) / 2) * (Math.PI / 180);
  const dx = (bounds.east - bounds.west) * 111_320 * Math.cos(midLat);
  const dy = (bounds.north - bounds.south) * 110_540;
  return Math.hypot(dx, dy) / 2;
}

// --- TomTom stops -----------------------------------------------------------

/** TomTom Search allows about five queries a second per key; stay under it. */
const TOMTOM_SEARCH_SPACING_MS = 260;
let nextSearchSlot = 0;

function searchSlot(): Promise<void> {
  const now = Date.now();
  const at = Math.max(now, nextSearchSlot);
  nextSearchSlot = at + TOMTOM_SEARCH_SPACING_MS;
  return at === now ? Promise.resolve() : new Promise((resolve) => setTimeout(resolve, at - now));
}

/**
 * One TomTom Search request, paced process-wide and retried once after a
 * rate-limit answer, so a busy view or a long route never trips the limit.
 */
export async function tomtomSearch(
  fetcher: typeof fetch,
  url: string,
  signal: AbortSignal | undefined,
): Promise<unknown> {
  for (let attempt = 0; attempt < 2; attempt += 1) {
    await searchSlot();
    const response = await fetcher(url, { signal: withTimeout(signal, 8_000) });
    if (response.status === 429 && attempt === 0) {
      await new Promise((resolve) => setTimeout(resolve, 1_100));
      continue;
    }
    if (!response.ok) throw new Error(`TomTom search ${response.status}`);
    return response.json();
  }
  throw new Error("TomTom search rate-limited");
}

/** TomTom Search category ids per stop layer. */
export const TOMTOM_STOP_CATEGORIES: Partial<Record<MapLayerId, string>> = {
  fuel: "7311",
  food: "7315",
  coffee: "9376",
  lodging: "7314",
  camping: "7360",
  repair: "9910003",
  viewpoints: "7337",
};

const TOMTOM_MAX_RADIUS_METERS = 50_000;

function stopDetail(poi: Record<string, unknown>, address: Record<string, unknown> | null): string | null {
  const brand = (Array.isArray(poi["brands"]) ? poi["brands"] : [])
    .map((entry) => text(record(entry)?.["name"]))
    .find((name) => name !== null);
  const name = text(poi["name"]);
  const street = text(address?.["streetName"]);
  const town = text(address?.["municipality"]) ?? text(address?.["localName"]);
  const parts = [
    brand !== undefined && brand !== null && brand !== name ? brand : null,
    street === null ? town : town === null ? street : `${street}, ${town}`,
    text(poi["phone"]),
  ].filter((part): part is string => part !== null);
  return parts.length === 0 ? null : parts.join(" · ");
}

export function parseTomTomStops(payload: unknown, layerId: MapLayerId, bounds: MapLayerBounds): readonly InfoFeature[] {
  const results = record(payload)?.["results"];
  if (!Array.isArray(results)) throw new Error("TomTom search answered without results");
  return results.flatMap((entry): InfoFeature[] => {
    const result = record(entry);
    const poi = record(result?.["poi"]);
    const position = record(result?.["position"]);
    const point = lngLat(position?.["lon"], position?.["lat"]);
    const name = text(poi?.["name"]);
    if (result === null || poi === null || point === null || name === null || !inside(bounds, point)) return [];
    return [{
      id: `tomtom:${text(result["id"]) ?? `${point[0]},${point[1]}`}`,
      layerId,
      name,
      detail: stopDetail(poi, record(result["address"])),
      weight: null,
      geometry: { type: "Point", coordinates: point },
    }];
  });
}

export const tomtomStopsProvider: LayerProvider = {
  id: "tomtom",
  layers: Object.keys(TOMTOM_STOP_CATEGORIES) as MapLayerId[],
  ttlMs: 30 * 60_000,
  async load(bounds, layers, context) {
    const key = tomtomKey(context.env);
    if (key === null) throw new Error("No TomTom key");
    const lat = ((bounds.south + bounds.north) / 2).toFixed(5);
    const lon = ((bounds.west + bounds.east) / 2).toFixed(5);
    const radius = Math.round(Math.min(TOMTOM_MAX_RADIUS_METERS, coveringRadiusMeters(bounds)));
    const answers = await Promise.all(layers.map(async (layerId) => {
      const category = TOMTOM_STOP_CATEGORIES[layerId];
      if (category === undefined) return [];
      const url =
        `https://api.tomtom.com/search/2/nearbySearch/.json?key=${encodeURIComponent(key)}` +
        `&lat=${lat}&lon=${lon}&radius=${radius}&limit=100&categorySet=${category}&language=en-US`;
      return parseTomTomStops(await tomtomSearch(context.fetch, url, context.signal), layerId, bounds);
    }));
    return answers.flat();
  },
};

// --- TomTom incidents -------------------------------------------------------

const INCIDENT_FIELDS =
  "{incidents{type,geometry{type,coordinates},properties{id,iconCategory,magnitudeOfDelay,events{description},from,to,delay,roadNumbers}}}";

/** TomTom icon categories, as a rider would say them. */
const INCIDENT_CATEGORY: Record<number, string> = {
  1: "Crash",
  2: "Fog",
  3: "Dangerous conditions",
  4: "Rain",
  5: "Ice",
  6: "Traffic jam",
  7: "Lane closed",
  8: "Road closed",
  9: "Road works",
  10: "Wind",
  11: "Flooding",
  14: "Broken-down vehicle",
};

function lineOf(value: unknown): readonly LngLat[] | null {
  if (!Array.isArray(value)) return null;
  const line = value.map((pair) => (Array.isArray(pair) ? lngLat(pair[0], pair[1]) : null));
  return line.every((point): point is LngLat => point !== null) && line.length >= 1 ? line : null;
}

export function parseTomTomIncidents(payload: unknown): readonly InfoFeature[] {
  const incidents = record(payload)?.["incidents"];
  if (!Array.isArray(incidents)) throw new Error("TomTom incidents answered without incidents");
  return incidents.flatMap((entry): InfoFeature[] => {
    const incident = record(entry);
    const properties = record(incident?.["properties"]);
    const geometry = record(incident?.["geometry"]);
    if (properties === null || geometry === null) return [];
    const category = finite(properties["iconCategory"]) ? INCIDENT_CATEGORY[properties["iconCategory"]] : undefined;
    const event = (Array.isArray(properties["events"]) ? properties["events"] : [])
      .map((item) => text(record(item)?.["description"]))
      .find((description) => description !== null);
    const name = category ?? event ?? "Traffic incident";
    const where = [text(properties["from"]), text(properties["to"])].filter((part) => part !== null);
    const delay = finite(properties["delay"]) && properties["delay"] > 0
      ? `+${Math.max(1, Math.round(properties["delay"] / 60))} min`
      : null;
    const detail = [
      event !== undefined && event !== null && event !== name ? event : null,
      delay,
      where.length === 0 ? null : where.join(" → "),
    ].filter((part): part is string => part !== null).join(" · ");
    let shape: InfoGeometry | null = null;
    if (geometry["type"] === "Point") {
      const point = Array.isArray(geometry["coordinates"])
        ? lngLat(geometry["coordinates"][0], geometry["coordinates"][1])
        : null;
      shape = point === null ? null : { type: "Point", coordinates: point };
    } else if (geometry["type"] === "LineString") {
      const line = lineOf(geometry["coordinates"]);
      shape = line === null ? null : line.length === 1
        ? { type: "Point", coordinates: line[0]! }
        : { type: "LineString", coordinates: line };
    }
    if (shape === null) return [];
    return [{
      id: `tomtom-incident:${text(properties["id"]) ?? name}`,
      layerId: "live-traffic",
      name,
      detail: detail === "" ? null : detail,
      weight: finite(properties["magnitudeOfDelay"]) ? properties["magnitudeOfDelay"] : null,
      geometry: shape,
    }];
  });
}

export const tomtomIncidentsProvider: LayerProvider = {
  id: "tomtom",
  layers: ["live-traffic"],
  ttlMs: 2 * 60_000,
  async load(bounds, _layers, context) {
    const key = tomtomKey(context.env);
    if (key === null) throw new Error("No TomTom key");
    const bbox = [bounds.west, bounds.south, bounds.east, bounds.north].map((value) => value.toFixed(5)).join(",");
    const url =
      `https://api.tomtom.com/traffic/services/5/incidentDetails?key=${encodeURIComponent(key)}` +
      `&bbox=${bbox}&fields=${encodeURIComponent(INCIDENT_FIELDS)}&language=en-US&timeValidityFilter=present`;
    const response = await context.fetch(url, { signal: withTimeout(context.signal, 8_000) });
    if (!response.ok) throw new Error(`TomTom incidents ${response.status}`);
    return parseTomTomIncidents(await response.json());
  },
};

// --- NWS alerts ---------------------------------------------------------------

function polygonOf(value: unknown): readonly (readonly LngLat[])[] | null {
  if (!Array.isArray(value)) return null;
  const rings = value.map(lineOf);
  return rings.every((ring): ring is readonly LngLat[] => ring !== null && ring.length >= 4) && rings.length > 0
    ? rings
    : null;
}

export function parseNwsAlerts(payload: unknown): readonly InfoFeature[] {
  const features = record(payload)?.["features"];
  if (!Array.isArray(features)) throw new Error("NWS answered without features");
  return features.flatMap((entry, index): InfoFeature[] => {
    const feature = record(entry);
    const properties = record(feature?.["properties"]);
    const geometry = record(feature?.["geometry"]);
    const name = text(properties?.["event"]) ?? "Weather alert";
    const until = text(properties?.["ends"]) ?? text(properties?.["expires"]);
    const untilText = until === null
      ? null
      : `until ${new Date(until).toLocaleString("en-US", { weekday: "short", hour: "numeric", minute: "2-digit", timeZone: "America/New_York" })}`;
    const detail = [text(properties?.["severity"]), untilText].filter((part) => part !== null).join(" · ");
    const polygons = geometry?.["type"] === "Polygon"
      ? [polygonOf(geometry["coordinates"])]
      : geometry?.["type"] === "MultiPolygon" && Array.isArray(geometry["coordinates"])
        ? geometry["coordinates"].map(polygonOf)
        : [];
    return polygons.flatMap((rings, part): InfoFeature[] => rings === null ? [] : [{
      id: `nws:${text(feature?.["id"]) ?? index}:${part}`,
      layerId: "weather",
      name,
      detail: detail === "" ? null : detail,
      weight: null,
      geometry: { type: "Polygon", coordinates: rings },
    }]);
  });
}

export const nwsAlertsProvider: LayerProvider = {
  id: "nws",
  layers: ["weather"],
  ttlMs: 5 * 60_000,
  async load(bounds, _layers, context) {
    const lat = ((bounds.south + bounds.north) / 2).toFixed(4);
    const lon = ((bounds.west + bounds.east) / 2).toFixed(4);
    const response = await context.fetch(`https://api.weather.gov/alerts/active?point=${lat},${lon}`, {
      headers: {
        accept: "application/geo+json",
        "user-agent": context.env["NWS_USER_AGENT"] ?? "OpenGravel route planner",
      },
      signal: withTimeout(context.signal, 10_000),
    });
    if (!response.ok) throw new Error(`NWS ${response.status}`);
    return parseNwsAlerts(await response.json());
  },
};

// --- Local road catalogues ---------------------------------------------------

const MAX_ROAD_FEATURES = 700;

function curvinessWords(rating: number): string {
  return rating >= 1200 ? "Very twisty" : rating >= 900 ? "Twisty" : "Some good bends";
}

function miles(line: readonly { readonly lon: number; readonly lat: number }[]): string {
  let meters = 0;
  for (let index = 1; index < line.length; index += 1) {
    const a = line[index - 1]!;
    const b = line[index]!;
    const x = (b.lon - a.lon) * Math.cos(((a.lat + b.lat) / 2) * (Math.PI / 180)) * 111_320;
    const y = (b.lat - a.lat) * 110_540;
    meters += Math.hypot(x, y);
  }
  const value = meters / 1609.344;
  return `${value < 10 ? value.toFixed(1) : Math.round(value)} mi`;
}

export function knownRoadsProvider(roads: KnownRoadsPort): LayerProvider {
  return {
    id: "roads",
    layers: ["great-roads", "gravel"],
    ttlMs: 60 * 60_000,
    async load(bounds, layers) {
      const features: InfoFeature[] = [];
      if (layers.includes("great-roads")) {
        const curvy = [...roads.curvyRoadsNear(bounds)]
          .filter((road) => road.rating >= MIN_GREAT_ROAD_RATING)
          .sort((first, second) => second.rating - first.rating)
          .slice(0, MAX_ROAD_FEATURES);
        for (const road of curvy) {
          features.push({
            id: `curvy:${road.id}`,
            layerId: "great-roads",
            // The catalogue falls back to OSM way ids for unnamed roads.
            name: road.name === "" || /^\d+$/.test(road.name) ? "Twisty road" : road.name,
            detail: `${curvinessWords(road.rating)} · ${miles(road.line)}`,
            weight: road.rating,
            geometry: { type: "LineString", coordinates: road.line.map((point) => [round(point.lon), round(point.lat)] as const) },
          });
        }
      }
      if (layers.includes("gravel")) {
        for (const corridor of roads.gravelCorridorsNear(bounds).slice(0, MAX_ROAD_FEATURES)) {
          features.push({
            id: `gravel:${corridor.id}`,
            layerId: "gravel",
            name: corridor.label === "" ? "Gravel road" : corridor.label,
            detail: `Surveyed gravel · confidence ${Math.round(corridor.confidence * 100)}%`,
            weight: corridor.confidence,
            geometry: { type: "LineString", coordinates: corridor.line.map((point) => [round(point.lon), round(point.lat)] as const) },
          });
        }
      }
      return features;
    },
  };
}

// --- OpenStreetMap via Overpass ---------------------------------------------

const OVERPASS_SELECTORS: Partial<Record<MapLayerId, readonly string[]>> = {
  "public-land": ['way["boundary"="protected_area"]', 'way["leisure"="nature_reserve"]', 'way["boundary"="national_park"]'],
  "forest-roads": ['way["highway"]["operator"~"Forest Service",i]', 'way["highway"]["ref"~"^(FS|FR) ",i]'],
  closures: ['way["highway"="construction"]'],
  "cell-towers": ['node["man_made"="mast"]["tower:type"="communication"]', 'node["man_made"="communications_tower"]'],
};

export const OVERPASS_MIRRORS = [
  "https://overpass-api.de/api/interpreter",
  "https://overpass.kumi.systems/api/interpreter",
  "https://overpass.private.coffee/api/interpreter",
] as const;

function overpassLayer(tags: Record<string, unknown>, layers: readonly MapLayerId[]): MapLayerId | null {
  if (layers.includes("public-land") && (tags["boundary"] === "protected_area" || tags["leisure"] === "nature_reserve" || tags["boundary"] === "national_park")) return "public-land";
  if (layers.includes("forest-roads") && typeof tags["highway"] === "string" && tags["highway"] !== "construction") return "forest-roads";
  if (layers.includes("closures") && tags["highway"] === "construction") return "closures";
  if (layers.includes("cell-towers") && (tags["man_made"] === "mast" || tags["man_made"] === "communications_tower")) return "cell-towers";
  return null;
}

export function parseOverpass(payload: unknown, layers: readonly MapLayerId[]): readonly InfoFeature[] {
  const elements = record(payload)?.["elements"];
  if (!Array.isArray(elements)) throw new Error("Overpass answered without elements");
  return elements.flatMap((entry): InfoFeature[] => {
    const element = record(entry);
    const tags = record(element?.["tags"]) ?? {};
    const layerId = overpassLayer(tags, layers);
    if (element === null || layerId === null) return [];
    const id = `osm:${text(element["type"]) ?? "x"}/${String(element["id"])}`;
    const name = layerId === "cell-towers" ? "Cell tower" : text(tags["name"]) ?? text(tags["ref"]) ?? text(tags["operator"]) ?? {
      "public-land": "Protected area",
      "forest-roads": "Forest road",
      closures: "Road construction",
      "cell-towers": "Cell tower",
    }[layerId as "public-land"] ?? "Mapped feature";
    const detail = layerId === "forest-roads"
      ? [text(tags["ref"]), text(tags["surface"]), text(tags["motor_vehicle"]) === null ? null : `motor vehicles: ${String(tags["motor_vehicle"])}`].filter((part) => part !== null).join(" · ") || null
      : layerId === "public-land"
        ? text(tags["operator"]) ?? text(tags["protection_title"])
        : layerId === "cell-towers"
          ? text(tags["operator"])
          : null;
    const geometryList = Array.isArray(element["geometry"]) ? element["geometry"] : null;
    if (geometryList !== null && layerId !== "public-land") {
      const line = geometryList
        .map((point) => lngLat(record(point)?.["lon"], record(point)?.["lat"]))
        .filter((point): point is LngLat => point !== null);
      if (line.length >= 2) return [{ id, layerId, name, detail, weight: null, geometry: { type: "LineString", coordinates: line } }];
    }
    const center = record(element["center"]);
    const point = lngLat(element["lon"] ?? center?.["lon"], element["lat"] ?? center?.["lat"]);
    return point === null ? [] : [{ id, layerId, name, detail, weight: null, geometry: { type: "Point", coordinates: point } }];
  });
}

export function overpassQuery(bounds: MapLayerBounds, layers: readonly MapLayerId[]): string | null {
  const bbox = `${bounds.south},${bounds.west},${bounds.north},${bounds.east}`;
  const lineLayers = layers.filter((layer) => layer === "forest-roads" || layer === "closures");
  const pointLayers = layers.filter((layer) => layer === "public-land" || layer === "cell-towers");
  const lines = lineLayers.flatMap((layer) => OVERPASS_SELECTORS[layer] ?? []).map((selector) => `${selector}(${bbox});`);
  const points = pointLayers.flatMap((layer) => OVERPASS_SELECTORS[layer] ?? []).map((selector) => `${selector}(${bbox});`);
  if (lines.length === 0 && points.length === 0) return null;
  const parts = [
    lines.length === 0 ? "" : `(${lines.join("")});out geom 400;`,
    points.length === 0 ? "" : `(${points.join("")});out center 400;`,
  ];
  return `[out:json][timeout:12];${parts.join("")}`;
}

export const overpassProvider: LayerProvider = {
  id: "osm",
  layers: ["public-land", "forest-roads", "closures", "cell-towers"],
  ttlMs: 60 * 60_000,
  async load(bounds, layers, context) {
    const query = overpassQuery(bounds, layers);
    if (query === null) return [];
    const configured = context.env["OVERPASS_URL"];
    const mirrors = configured === undefined || configured === "" ? OVERPASS_MIRRORS : [configured, ...OVERPASS_MIRRORS];
    let lastError: unknown = null;
    for (const url of mirrors) {
      try {
        const response = await context.fetch(url, {
          method: "POST",
          headers: {
            accept: "application/json",
            "content-type": "application/x-www-form-urlencoded;charset=UTF-8",
            "user-agent": "OpenGravel route planner (map layers)",
          },
          body: new URLSearchParams({ data: query }),
          signal: withTimeout(context.signal, 9_000),
        });
        if (!response.ok) throw new Error(`Overpass ${response.status}`);
        return parseOverpass(await response.json(), layers);
      } catch (error) {
        if (context.signal?.aborted === true) throw error;
        lastError = error;
      }
    }
    throw lastError ?? new Error("Overpass unavailable");
  },
};
