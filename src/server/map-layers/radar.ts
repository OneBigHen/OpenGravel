import type { MapLayerBounds } from "@/application/map-layers";
import type { LayerProvider } from "@/server/map-layers/providers";

/** Only actual archive names establish frame availability; wall clock is not a frame. */
export function latestRadarFrame(listing: string, now: number): string {
  const times = [...listing.matchAll(/n0q_(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})\.png/g)]
    .map((match) => `${match[1]}-${match[2]}-${match[3]}T${match[4]}:${match[5]}:00.000Z`)
    .filter((time) => Number.isFinite(Date.parse(time)) && Date.parse(time) <= now);
  const latest = times.sort().at(-1);
  if (latest === undefined) throw new Error("No timestamped radar frame available");
  return latest;
}

export function radarWmsUrl(bounds: MapLayerBounds, frame: string): string {
  const params = new URLSearchParams({ SERVICE: "WMS", VERSION: "1.1.1", REQUEST: "GetMap", LAYERS: "nexrad-n0q-wmst", STYLES: "", FORMAT: "image/png", TRANSPARENT: "TRUE", SRS: "EPSG:4326", BBOX: `${bounds.west},${bounds.south},${bounds.east},${bounds.north}`, WIDTH: "512", HEIGHT: "512", TIME: frame });
  return `https://mesonet.agron.iastate.edu/cgi-bin/wms/nexrad/n0q-t.cgi?${params}`;
}

export const radarProvider: LayerProvider = {
  id: "radar", layers: ["weather-radar"], ttlMs: 60_000,
  async load() { return []; },
  async snapshot(bounds, _layers, context) {
    // Outside the continental mosaic, an empty image must not look like clear weather.
    if (bounds.west < -126 || bounds.east > -66 || bounds.south < 24 || bounds.north > 50) throw new Error("Outside CONUS radar coverage");
    const now = (context.now ?? Date.now)();
    const signal = context.signal === undefined ? AbortSignal.timeout(8_000) : AbortSignal.any([context.signal, AbortSignal.timeout(8_000)]);
    const directory = (time: number): string => new Date(time).toISOString().slice(0, 10).replaceAll("-", "/");
    const listing = await context.fetch(`https://mesonet.agron.iastate.edu/archive/data/${directory(now)}/GIS/uscomp/`, { signal });
    if (!listing.ok) throw new Error("Radar archive unavailable");
    let frame: string;
    try { frame = latestRadarFrame(await listing.text(), now); }
    catch {
      const yesterday = await context.fetch(`https://mesonet.agron.iastate.edu/archive/data/${directory(now - 86_400_000)}/GIS/uscomp/`, { signal });
      if (!yesterday.ok) throw new Error("Radar archive unavailable");
      frame = latestRadarFrame(await yesterday.text(), now);
    }
    const response = await context.fetch(radarWmsUrl(bounds, frame), { signal });
    if (!response.ok) throw new Error("Radar image unavailable");
    const bytes = new Uint8Array(await response.arrayBuffer());
    if (bytes.length < 8 || bytes.length > 2_000_000 || bytes[0] !== 137 || bytes[1] !== 80 || bytes[2] !== 78 || bytes[3] !== 71) throw new Error("Invalid radar image");
    return {
      features: [],
      rasters: [{ layerId: "weather-radar", url: `data:image/png;base64,${Buffer.from(bytes).toString("base64")}`, bounds, attribution: "NOAA NEXRAD / Iowa Environmental Mesonet" }],
      freshness: [{ layerId: "weather-radar", source: "NOAA NEXRAD / IEM", fetchedAt: new Date(now).toISOString(), observedAt: frame, stale: now - Date.parse(frame) > 15 * 60_000, staleAfterMs: 15 * 60_000, note: "Mosaic valid time. Green/yellow/red: increasing reflectivity (dBZ). Gaps and beam blockage are unknown, not clear. Online only." }],
    };
  },
};
