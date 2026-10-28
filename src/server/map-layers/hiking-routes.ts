import type { InfoFeature, LngLat, MapLayerBounds } from "@/application/map-layers";
import { OVERPASS_MIRRORS, type LayerProvider } from "./providers";

const ROUTE_COLORS: Readonly<Record<string, string>> = {
  red: "#b43f35", blue: "#2869ae", green: "#398052", yellow: "#c58d19",
  orange: "#d56d27", purple: "#86529a", brown: "#865d3b", black: "#343434",
  white: "#f4f2e9",
};

function record(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function routeColor(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const normalized = value.trim().toLowerCase();
  return ROUTE_COLORS[normalized] ?? (/^#[0-9a-f]{6}$/.test(normalized) ? normalized : undefined);
}

export function parseHikingRelations(payload: unknown, bounds: MapLayerBounds): readonly InfoFeature[] {
  const elements = record(payload)["elements"];
  if (!Array.isArray(elements) || elements.length >= 200 || record(payload)["remark"] !== undefined) throw new Error("Hiking relations incomplete");
  const features: InfoFeature[] = [];
  for (const element of elements) {
    const relation = record(element);
    const tags = record(relation["tags"]);
    if (relation["type"] !== "relation" || (tags["route"] !== "hiking" && tags["route"] !== "foot") || !Array.isArray(relation["members"])) continue;
    const color = routeColor(tags["colour"] ?? tags["color"]);
    const name = typeof tags["name"] === "string" ? tags["name"] : typeof tags["ref"] === "string" ? tags["ref"] : "Hiking route";
    for (const member of relation["members"]) {
      const way = record(member);
      if (way["type"] !== "way" || !Array.isArray(way["geometry"])) continue;
      const points = way["geometry"].flatMap((item): LngLat[] => {
        const point = record(item);
        const lon = point["lon"], lat = point["lat"];
        return typeof lon === "number" && typeof lat === "number" && Number.isFinite(lon) && Number.isFinite(lat) && Math.abs(lon) <= 180 && Math.abs(lat) <= 90 ? [[lon, lat]] : [];
      });
      if (points.length < 2 || points.length > 10_000 || points.length !== way["geometry"].length) continue;
      const extent = points.reduce((box, point) => ({ west: Math.min(box.west, point[0]), east: Math.max(box.east, point[0]), south: Math.min(box.south, point[1]), north: Math.max(box.north, point[1]) }), { west: 180, east: -180, south: 90, north: -90 });
      if (extent.east < bounds.west || extent.west > bounds.east || extent.north < bounds.south || extent.south > bounds.north) continue;
      features.push({ id: `osm:relation/${String(relation["id"])}/way/${String(way["ref"])}`, layerId: "trails", name, detail: "OpenStreetMap hiking route relation · access and conditions unverified", weight: null, ...(color === undefined ? {} : { color }), geometry: { type: "LineString", coordinates: points } });
      if (features.length > 5000) throw new Error("Hiking relations exceed the view limit");
    }
  }
  return features;
}

export function parseOsmMapRelations(payload: unknown, bounds: MapLayerBounds): readonly InfoFeature[] {
  const elements = record(payload)["elements"];
  if (!Array.isArray(elements) || elements.length > 150_000) throw new Error("OSM map response incomplete");
  const nodes = new Map<number, { lon: number; lat: number }>();
  const ways = new Map<number, readonly number[]>();
  for (const element of elements) {
    const item = record(element);
    if (typeof item["id"] !== "number") continue;
    if (item["type"] === "node" && typeof item["lon"] === "number" && typeof item["lat"] === "number") nodes.set(item["id"], { lon: item["lon"], lat: item["lat"] });
    if (item["type"] === "way" && Array.isArray(item["nodes"]) && item["nodes"].every((node: unknown) => typeof node === "number")) ways.set(item["id"], item["nodes"] as number[]);
  }
  const relations = elements.flatMap((element): unknown[] => {
    const relation = record(element), tags = record(relation["tags"]);
    if (relation["type"] !== "relation" || (tags["route"] !== "hiking" && tags["route"] !== "foot") || !Array.isArray(relation["members"])) return [];
    const members = relation["members"].flatMap((entry: unknown): unknown[] => {
      const member = record(entry);
      if (member["type"] !== "way" || typeof member["ref"] !== "number") return [];
      const references = ways.get(member["ref"]);
      if (references === undefined) return [];
      const geometry = references.map((reference) => nodes.get(reference));
      return geometry.every((point) => point !== undefined) ? [{ type: "way", ref: member["ref"], geometry }] : [];
    });
    return [{ ...relation, members }];
  });
  return parseHikingRelations({ elements: relations }, bounds);
}

export const hikingRoutesProvider: LayerProvider = {
  id: "osm-hiking-routes", layers: ["trails"], ttlMs: 60 * 60_000,
  async load(bounds, _layers, context) {
    const bbox = `${bounds.south},${bounds.west},${bounds.north},${bounds.east}`;
    const query = `[out:json][timeout:12];(rel["route"="hiking"](${bbox});rel["route"="foot"](${bbox}););out geom 200;`;
    const configured = context.env["OVERPASS_URL"];
    const mirrors = configured ? [configured, ...OVERPASS_MIRRORS] : OVERPASS_MIRRORS;
    let lastError: unknown = null;
    for (const url of mirrors) {
      try {
        const signal = context.signal === undefined ? AbortSignal.timeout(4_000) : AbortSignal.any([context.signal, AbortSignal.timeout(4_000)]);
        const response = await context.fetch(url, { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded;charset=UTF-8", accept: "application/json", "user-agent": "OpenGravel route planner (map layers)" }, body: new URLSearchParams({ data: query }), signal });
        if (!response.ok) throw new Error(`Overpass ${response.status}`);
        return parseHikingRelations(await response.json(), bounds);
      } catch (error) {
        if (context.signal?.aborted) throw error;
        lastError = error;
      }
    }
    if ((bounds.east - bounds.west) * (bounds.north - bounds.south) > 0.1) throw lastError ?? new Error("Hiking view too large");
    const signal = context.signal === undefined ? AbortSignal.timeout(8_000) : AbortSignal.any([context.signal, AbortSignal.timeout(8_000)]);
    const params = new URLSearchParams({ bbox: `${bounds.west},${bounds.south},${bounds.east},${bounds.north}` });
    const response = await context.fetch(`https://api.openstreetmap.org/api/0.6/map.json?${params}`, { headers: { accept: "application/json", "user-agent": "OpenGravel route planner (map layers)" }, signal });
    if (!response.ok) throw new Error(`OSM map ${response.status}`);
    return parseOsmMapRelations(await response.json(), bounds);
  },
};
