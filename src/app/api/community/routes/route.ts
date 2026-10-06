import { createConcurrencyGate, createRateLimiter } from "@/server/rate-limit";
import { readCommunityRouteUpload } from "@/server/community-routes/upload";
import { buildSharedRoute } from "@/server/community-routes/share";
import { prepareRoutePhotos } from "@/server/community-routes/photos";
import { sharedCommunityRouteStore } from "@/server/community-routes/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const limiter = createRateLimiter({ windowMs: 60 * 60_000, max: 10 });
const uploads = createConcurrencyGate(4);
const HEADERS = { "cache-control": "private, no-store" };

/** Anyone may share a route with everyone: the body is a name and a line. */
export async function POST(request: Request): Promise<Response> {
  const wait = limiter.check(request);
  if (wait !== null) return Response.json({ error: "You are sharing too fast. Try again later." }, { status: 429, headers: { ...HEADERS, "retry-after": String(wait) } });
  const release = uploads.acquire();
  if (release === null) return Response.json({ error: "Uploads are busy. Try again shortly." }, { status: 429, headers: { ...HEADERS, "retry-after": "10" } });
  try {
    const upload = await readCommunityRouteUpload(request);
    if (!upload.ok) return Response.json({ error: upload.message }, { status: upload.status, headers: HEADERS });
    const built = buildSharedRoute(upload.body, new Date());
    if (!built.ok) return Response.json({ error: built.message }, { status: 400, headers: HEADERS });
    const store = sharedCommunityRouteStore();
    const configuredMax = Number(process.env["OGV_COMMUNITY_MAX_ROUTES"] ?? "2000");
    const max = Number.isSafeInteger(configuredMax) && configuredMax > 0 ? Math.min(configuredMax, 2000) : 2000;
    if (store.routeCount() >= max) return Response.json({ error: "The shared bucket is full right now." }, { status: 503, headers: HEADERS });
    let photos;
    try { photos = await prepareRoutePhotos((upload.body as Record<string, unknown>)["photos"]); }
    catch (error) { return Response.json({ error: error instanceof Error ? error.message : "The photos could not be read." }, { status: 400, headers: HEADERS }); }
    // The async image boundary can let another upload consume the last slot.
    if (store.routeCount() >= max) return Response.json({ error: "The shared bucket is full right now." }, { status: 503, headers: HEADERS });
    const story = built.raw["story"] as Record<string, unknown>;
    const raw = { ...built.raw, story: { ...story, photos: photos.map((photo, index) => ({ src: `/api/community/routes/${built.id}/photos/${index}`, width: photo.width, height: photo.height })) } };
    if (!store.addRoute(built.id, raw, new Date().toISOString(), photos, max)) return Response.json({ error: "The shared bucket is full right now." }, { status: 503, headers: HEADERS });
    return Response.json({ id: built.id }, { status: 201, headers: HEADERS });
  } finally { release(); }
}
