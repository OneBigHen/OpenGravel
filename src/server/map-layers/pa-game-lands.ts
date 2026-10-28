import type { InfoFeature, LngLat } from "@/application/map-layers";
import type { LayerProvider } from "./providers";

// PGC's SGL_service MapServer currently returns no records. Its maintained
// State Game Land Boundaries feature service publishes the same authority.
export const PA_GAME_LANDS_SERVICE = "https://services1.arcgis.com/k8yxvICm95iIFicb/arcgis/rest/services/State_Game_Lands_Boundaries/FeatureServer/300";

function record(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

export function parseGameLands(payload: unknown, fetchedAt: string): readonly InfoFeature[] {
  const body = record(payload);
  if (!Array.isArray(body["features"]) || body["error"] !== undefined || body["exceededTransferLimit"] === true || record(body["properties"])["exceededTransferLimit"] === true) throw new Error("PGC boundaries incomplete");
  return body["features"].flatMap((entry: unknown): InfoFeature[] => {
    const feature = record(entry), properties = record(feature["properties"]), geometry = record(feature["geometry"]);
    const polygons: unknown[] = geometry["type"] === "Polygon" ? [geometry["coordinates"]] : geometry["type"] === "MultiPolygon" && Array.isArray(geometry["coordinates"]) ? geometry["coordinates"] : [];
    if (polygons.length === 0) throw new Error("PGC invalid geometry");
    const edited = properties["last_edited_date"];
    const date = typeof edited === "number" && Number.isFinite(edited) && !Number.isNaN(new Date(edited).getTime()) ? new Date(edited).toISOString().slice(0, 10) : "unknown";
    return polygons.map((polygon, index): InfoFeature => {
      if (!Array.isArray(polygon) || polygon.length === 0 || !polygon.every((ring: unknown) => Array.isArray(ring) && ring.length >= 4 && ring.every((point: unknown) => Array.isArray(point) && point.length >= 2 && typeof point[0] === "number" && typeof point[1] === "number" && Number.isFinite(point[0]) && Number.isFinite(point[1]) && Math.abs(point[0]) <= 180 && Math.abs(point[1]) <= 90) && ring[0][0] === ring.at(-1)[0] && ring[0][1] === ring.at(-1)[1])) throw new Error("PGC invalid polygon");
      return { id: `pgc:${String(properties["OBJECTID"])}:${index}`, layerId: "hunting-season", name: `State Game Lands ${String(properties["sgl"] ?? properties["sgl_name"] ?? "")}`.trim(), detail: `Pennsylvania Game Commission · boundary updated ${date} · retrieved ${fetchedAt.slice(0, 10)} · Season dates: check PGC`, weight: null, geometry: { type: "Polygon", coordinates: polygon as readonly (readonly LngLat[])[] } };
    });
  });
}

export const paGameLandsProvider: LayerProvider = {
  id: "pa-game-lands", layers: ["hunting-season"], ttlMs: 6 * 60 * 60_000,
  async load() { return []; },
  async snapshot(bounds, _layers, context) {
    const fetchedAt = new Date((context.now ?? Date.now)()).toISOString();
    const params = new URLSearchParams({ f: "geojson", where: "1=1", geometry: `${bounds.west},${bounds.south},${bounds.east},${bounds.north}`, geometryType: "esriGeometryEnvelope", inSR: "4326", outSR: "4326", spatialRel: "esriSpatialRelIntersects", outFields: "OBJECTID,sgl,sgl_name,last_edited_date", returnGeometry: "true", maxAllowableOffset: "0.0005", geometryPrecision: "5", resultRecordCount: "2000" });
    const signal = context.signal === undefined ? AbortSignal.timeout(8_000) : AbortSignal.any([context.signal, AbortSignal.timeout(8_000)]);
    const response = await context.fetch(`${PA_GAME_LANDS_SERVICE}/query?${params}`, { signal });
    if (!response.ok) throw new Error("PGC boundaries unavailable");
    return { features: parseGameLands(await response.json(), fetchedAt), freshness: [{ layerId: "hunting-season", source: "Pennsylvania Game Commission · State Game Land Boundaries", fetchedAt, observedAt: null, stale: false, note: "Generalized boundaries; individual publication dates appear on features. Season dates: check PGC." }] };
  },
};
