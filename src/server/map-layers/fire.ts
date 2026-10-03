import type { InfoFeature, MapLayerBounds } from "@/application/map-layers";
import type { LayerProvider } from "@/server/map-layers/providers";

/** FIRMS area CSV has numeric/unquoted VIIRS fields; malformed headers are service failures. */
export function parseFirmsCsv(csv: string, bounds: MapLayerBounds, now: number): readonly InfoFeature[] {
  const lines = csv.trim().split(/\r?\n/);
  const header = lines.shift()?.replace(/^\uFEFF/, "").split(",").map((field) => field.trim());
  if (header === undefined || !["latitude", "longitude", "acq_date", "acq_time", "confidence"].every((key) => header.includes(key))) throw new Error("Invalid FIRMS CSV");
  const features: InfoFeature[] = [];
  for (const line of lines) {
    if (line.trim() === "") continue;
    const cells = line.split(",");
    const value = (key: string): string => cells[header.indexOf(key)]?.trim() ?? "";
    const lat = Number(value("latitude"));
    const lon = Number(value("longitude"));
    const date = value("acq_date");
    const time = value("acq_time").padStart(4, "0");
    if (value("latitude") === "" || value("longitude") === "" || !Number.isFinite(lat) || !Number.isFinite(lon) || lat < bounds.south || lat > bounds.north || lon < bounds.west || lon > bounds.east) continue;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !/^\d{4}$/.test(time) || Number(time.slice(0, 2)) > 23 || Number(time.slice(2)) > 59) continue;
    const timestamp = `${date}T${time.slice(0, 2)}:${time.slice(2)}:00.000Z`;
    const instant = Date.parse(timestamp);
    if (!Number.isFinite(instant) || new Date(instant).toISOString() !== timestamp || instant > now || now - instant > 48 * 60 * 60_000) continue;
    const confidence = ({ l: "low", n: "nominal", h: "high" } as Readonly<Record<string, string>>)[value("confidence")] ?? "unknown";
    features.push({ id: `firms:snpp:${lon}:${lat}:${timestamp}`, layerId: "active-fire", name: "VIIRS thermal hotspot", detail: `NASA FIRMS VIIRS SNPP · ${timestamp} · confidence ${confidence}. Hotspots are not road closures.`, weight: null, geometry: { type: "Point", coordinates: [lon, lat] } });
    if (features.length >= 5_000) throw new Error("FIRMS view exceeds feature budget");
  }
  return features;
}

export const fireProvider: LayerProvider = {
  id: "firms", layers: ["active-fire"], ttlMs: 10 * 60_000,
  async load() { return []; },
  async snapshot(bounds, _layers, context) {
    const key = context.env["NASA_FIRMS_MAP_KEY"]?.trim();
    if (!key) throw new Error("FIRMS is not configured");
    const now = (context.now ?? Date.now)();
    const area = [bounds.west, bounds.south, bounds.east, bounds.north].join(",");
    const response = await context.fetch(`https://firms.modaps.eosdis.nasa.gov/api/area/csv/${encodeURIComponent(key)}/VIIRS_SNPP_NRT/${area}/2`, { signal: context.signal === undefined ? AbortSignal.timeout(8_000) : AbortSignal.any([context.signal, AbortSignal.timeout(8_000)]) });
    if (!response.ok) throw new Error("FIRMS unavailable");
    const csv = await response.text();
    if (csv.length > 2_000_000) throw new Error("FIRMS response too large");
    return { features: parseFirmsCsv(csv, bounds, now), freshness: [{ layerId: "active-fire", source: "NASA FIRMS VIIRS SNPP NRT", fetchedAt: new Date(now).toISOString(), observedAt: null, stale: false, staleAfterMs: 30 * 60_000, note: "Last 48 h; acquisition time on each hotspot. VIIRS nominal footprint 375 m. Cloud and satellite coverage gaps remain unknown. Hotspots are not road closures. Online only." }] };
  },
};
