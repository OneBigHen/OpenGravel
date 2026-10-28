import { readFile, stat } from "node:fs/promises";
import type { HikeRecord } from "../../../infra/trails/lib/types";

type Box = readonly [number, number, number, number];
type Catalog = { hikes: HikeRecord[] };
let cache: { path: string; mtime: number; size: number; catalog: Catalog } | undefined;

export function parseBbox(value: string | null): Box | null {
  if (value === null) return null;
  const parts = value.split(",");
  if (parts.length !== 4 || parts.some((part) => part.trim() === "")) throw new Error("bbox must be west,south,east,north");
  const [west, south, east, north] = parts.map(Number);
  if (west === undefined || south === undefined || east === undefined || north === undefined ||
      ![west, south, east, north].every(Number.isFinite) || west < -180 || east > 180 || south < -90 || north > 90 || west > east || south > north) {
    throw new Error("invalid bbox");
  }
  return [west, south, east, north];
}

function isCatalog(value: unknown): value is Catalog {
  if (typeof value !== "object" || value === null) return false;
  const data = value as { version?: unknown; hikes?: unknown };
  return data.version === 1 && Array.isArray(data.hikes) && data.hikes.every((item: unknown) => {
    if (typeof item !== "object" || item === null) return false;
    const hike = item as { id?: unknown; bbox?: unknown };
    return typeof hike.id === "string" && Array.isArray(hike.bbox) && hike.bbox.length === 4 &&
      hike.bbox.every((n: unknown) => typeof n === "number" && Number.isFinite(n)) &&
      hike.bbox[0] >= -180 && hike.bbox[2] <= 180 && hike.bbox[1] >= -90 && hike.bbox[3] <= 90 &&
      hike.bbox[0] <= hike.bbox[2] && hike.bbox[1] <= hike.bbox[3];
  });
}

export async function listHikes(url: URL, path: string | undefined): Promise<{ status: number; body: object }> {
  let bbox: Box | null;
  try { bbox = parseBbox(url.searchParams.get("bbox")); } catch { return { status: 400, body: { error: "Invalid bbox: expected west,south,east,north" } }; }
  if (!path) return { status: 200, body: { enabled: false, hikes: [] } };
  try {
    const info = await stat(path);
    if (!cache || cache.path !== path || cache.mtime !== info.mtimeMs || cache.size !== info.size) {
      const data: unknown = JSON.parse(await readFile(path, "utf8"));
      if (!isCatalog(data)) throw new Error("invalid catalog");
      cache = { path, mtime: info.mtimeMs, size: info.size, catalog: data };
    }
    const id = url.searchParams.get("id");
    const hikes = cache.catalog.hikes.filter((hike) => (id === null || hike.id === id) && (bbox === null ||
      (hike.bbox[0] <= bbox[2] && hike.bbox[2] >= bbox[0] && hike.bbox[1] <= bbox[3] && hike.bbox[3] >= bbox[1])));
    return { status: 200, body: { enabled: true, hikes: id === null ? hikes.map((hike) => { const summary = { ...hike }; delete summary.features; return summary; }) : hikes } };
  } catch {
    return { status: 503, body: { enabled: true, error: "Hike catalog unavailable", hikes: [] } };
  }
}
