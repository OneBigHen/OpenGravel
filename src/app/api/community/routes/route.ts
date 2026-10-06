import { createRateLimiter } from "@/server/rate-limit";
import { liveCatalogEntries } from "@/server/community-routes/live-catalog";
import { buildSharedRoute } from "@/server/community-routes/share";
import { sharedCommunityRouteStore } from "@/server/community-routes/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_BODY_BYTES = 1_500_000;
const limiter = createRateLimiter({ windowMs: 60 * 60_000, max: 10 });
const HEADERS = { "cache-control": "private, no-store" };

/** Anyone may share a route with everyone: the body is a name and a line. */
export async function POST(request: Request): Promise<Response> {
  const wait = limiter.check(request);
  if (wait !== null) return Response.json({ error: "You are sharing too fast. Try again later." }, { status: 429, headers: { ...HEADERS, "retry-after": String(wait) } });
  if (Number(request.headers.get("content-length") ?? "0") > MAX_BODY_BYTES) return Response.json({ error: "That route is too large to share." }, { status: 413, headers: HEADERS });
  let body: unknown;
  try {
    const text = await request.text();
    if (text.length > MAX_BODY_BYTES) return Response.json({ error: "That route is too large to share." }, { status: 413, headers: HEADERS });
    body = JSON.parse(text) as unknown;
  } catch {
    return Response.json({ error: "The route could not be read." }, { status: 400, headers: HEADERS });
  }
  const built = buildSharedRoute(body, new Date());
  if (!built.ok) return Response.json({ error: built.message }, { status: 400, headers: HEADERS });
  const store = sharedCommunityRouteStore();
  const max = Number(process.env["OGV_COMMUNITY_MAX_ROUTES"] ?? "2000");
  if (store.routes().length >= max) return Response.json({ error: "The shared bucket is full right now." }, { status: 503, headers: HEADERS });
  store.addRoute(built.id, built.raw, new Date().toISOString());
  liveCatalogEntries();
  return Response.json({ id: built.id }, { status: 201, headers: HEADERS });
}
