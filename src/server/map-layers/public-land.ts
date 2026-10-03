import type { InfoFeature, LngLat } from "@/application/map-layers";
import { overpassProvider, type LayerProvider } from "@/server/map-layers/providers";

const SERVICE = "https://services.arcgis.com/v01gqwM5QqNysAAi/arcgis/rest/services/PADUS_Public_Access/FeatureServer/0";
function record(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null ? value as Record<string, unknown> : {};
}
function rings(value: unknown): readonly (readonly LngLat[])[] | null {
  if (!Array.isArray(value) || value.length === 0) return null;
  const valid = value.every((ring: unknown) => Array.isArray(ring) && ring.length >= 4 && ring.every((point: unknown) => Array.isArray(point) && point.length >= 2 && typeof point[0] === "number" && typeof point[1] === "number" && Number.isFinite(point[0]) && Number.isFinite(point[1]) && Math.abs(point[0]) <= 180 && Math.abs(point[1]) <= 90) && ring[0][0] === ring.at(-1)[0] && ring[0][1] === ring.at(-1)[1]);
  return valid ? value as readonly (readonly LngLat[])[] : null;
}
export function parsePadUs(payload: unknown): readonly InfoFeature[] {
  const body = record(payload);
  if (!Array.isArray(body["features"]) || body["error"] !== undefined || body["exceededTransferLimit"] === true || record(body["properties"])["exceededTransferLimit"] === true) throw new Error("PAD-US incomplete or unavailable");
  return body["features"].flatMap((entry: unknown): InfoFeature[] => {
    const feature = record(entry);
    const p = record(feature["properties"]);
    const geometry = record(feature["geometry"]);
    const polygons: unknown[] = geometry["type"] === "Polygon" ? [geometry["coordinates"]] : geometry["type"] === "MultiPolygon" && Array.isArray(geometry["coordinates"]) ? geometry["coordinates"] : [];
    if (polygons.length === 0) throw new Error("PAD-US invalid geometry");
    return polygons.map((polygon, index): InfoFeature => {
      const coordinates = rings(polygon);
      if (coordinates === null) throw new Error("PAD-US invalid polygon");
      const publicAccess = ({ OA: "open", RA: "restricted", XA: "closed", UK: "unknown" } as Readonly<Record<string, string>>)[String(p["Pub_Access"])] ?? "unknown";
      return { id: `padus:${String(feature["id"] ?? p["OBJECTID"])}:${index}`, layerId: "public-land", name: typeof p["Unit_Nm"] === "string" ? p["Unit_Nm"] : "Protected land", detail: `USGS PAD-US · ${String(p["MngNm_Desc"] ?? "manager unknown")} · ${String(p["Category"] ?? "tenure unknown")} · general public access ${publicAccess}; not motorized access. Boundaries generalized.`, weight: null, geometry: { type: "Polygon", coordinates } };
    });
  });
}

export const publicLandProvider: LayerProvider = {
  id: "padus", layers: ["public-land"], ttlMs: 6 * 60 * 60_000,
  async load() { return []; },
  async snapshot(bounds, layers, context) {
    const fetchedAt = new Date((context.now ?? Date.now)()).toISOString();
    try {
      if (bounds.west < -180 || bounds.east > -60 || bounds.south < 18 || bounds.north > 72) throw new Error("Outside US");
      const params = new URLSearchParams({ f: "geojson", where: "1=1", geometry: JSON.stringify({ xmin: bounds.west, ymin: bounds.south, xmax: bounds.east, ymax: bounds.north, spatialReference: { wkid: 4326 } }), geometryType: "esriGeometryEnvelope", inSR: "4326", outSR: "4326", spatialRel: "esriSpatialRelIntersects", outFields: "OBJECTID,Unit_Nm,Pub_Access,MngNm_Desc,Category", returnGeometry: "true", maxAllowableOffset: "0.0005", geometryPrecision: "5", resultRecordCount: "1000" });
      const signal = context.signal === undefined ? AbortSignal.timeout(8_000) : AbortSignal.any([context.signal, AbortSignal.timeout(8_000)]);
      const pages: unknown[] = [];
      let complete = false;
      // ArcGIS advertises transfer limits in GeoJSON properties. Finish the
      // bounded query or report fallback; never show a truncated primary as complete.
      for (let page = 0; page < 4; page++) {
        params.set("resultOffset", String(page * 1000));
        params.set("orderByFields", "OBJECTID");
        const response = await context.fetch(`${SERVICE}/query?${params}`, { signal });
        if (!response.ok) throw new Error("PAD-US unavailable");
        const payload = record(await response.json());
        if (!Array.isArray(payload["features"]) || payload["error"] !== undefined) throw new Error("PAD-US unavailable");
        pages.push(...payload["features"]);
        if (payload["exceededTransferLimit"] !== true && record(payload["properties"])["exceededTransferLimit"] !== true) { complete = true; break; }
      }
      if (!complete) throw new Error("PAD-US view exceeds bounded page budget");
      const features = parsePadUs({ features: pages });
      // A publication edit date is not the survey date of individual boundaries.
      return { features, freshness: [{ layerId: "public-land", source: "USGS PAD-US Public Access", fetchedAt, observedAt: null, stale: false, note: "Dated retrieval; individual boundary survey dates unknown. Includes private protected land. Generalized to ~50 m. Ownership/protection does not grant motorized access. Online only." }] };
    } catch {
      if (context.signal?.aborted === true) throw new Error("Cancelled");
      const features = await overpassProvider.load(bounds, layers, context);
      return { features: features.map((feature) => ({ ...feature, detail: `OpenStreetMap fallback · ${feature.detail ?? "Community-mapped protected area centre"}. PAD-US unavailable; not legal access evidence.` })), unavailable: true, freshness: [{ layerId: "public-land", source: "OpenStreetMap fallback", fetchedAt, observedAt: null, stale: false, note: "PAD-US unavailable. Supplementary mapped centres only, not protected-area boundaries or legal access. OSM observation dates unknown. Online only." }] };
    }
  },
};
