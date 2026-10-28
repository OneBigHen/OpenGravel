import { readFile, stat } from "node:fs/promises";
import { dirname, join } from "node:path";
import type { TrailFeatureCollection } from "../../../../../infra/trails/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
let pending: Promise<Map<string, TrailFeatureCollection["features"][number]>> | undefined;
let cache: { path: string; mtime: number; features: Map<string, TrailFeatureCollection["features"][number]> } | undefined;

export async function GET(request: Request): Promise<Response> {
  const params = new URL(request.url).searchParams;
  const id = params.get("id");
  const ids = params.getAll("ids");
  if ((!id && ids.length === 0) || ids.length > 50) return Response.json({ error: "Expected one id or up to 50 ids" }, { status: 400 });
  if (!process.env.OGV_HIKES_PATH) return Response.json({ error: "Catalog unavailable" }, { status: 503 });
  const path = join(dirname(process.env.OGV_HIKES_PATH), "trails.geojson");
  try {
    const info = await stat(path);
    if (!cache || cache.path !== path || cache.mtime !== info.mtimeMs) {
      pending ??= readFile(path, "utf8").then((raw) => {
        const collection = JSON.parse(raw) as TrailFeatureCollection;
        return new Map(collection.features.map((feature) => [feature.id, feature]));
      });
      try { cache = { path, mtime: info.mtimeMs, features: await pending }; } finally { pending = undefined; }
    }
    if (ids.length > 0) return Response.json({ features: ids.flatMap((key) => { const feature = cache!.features.get(key); if (!feature) return []; const detailFields = new Set(["parks", "features", "officialEvidence", "fieldSources", "descriptions", "photos", "photo", "trailheads", "conflicts"]); const properties = Object.fromEntries(Object.entries(feature.properties).filter(([key]) => !detailFields.has(key))); return [{ ...feature, properties }]; }) });
    const feature = cache.features.get(id!);
    return feature ? Response.json(feature) : Response.json({ error: "Trail geometry not found" }, { status: 404 });
  } catch {
    return Response.json({ error: "Trail geometry unavailable" }, { status: 503 });
  }
}
