import { createRateLimiter } from "@/server/rate-limit";
import { knownRouteName } from "@/server/community-routes/live-catalog";
import { notifyRouteRemoved } from "@/server/community-routes/notify";
import { cleanReason } from "@/server/community-routes/share";
import { sharedCommunityRouteStore } from "@/server/community-routes/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const limiter = createRateLimiter({ windowMs: 60 * 60_000, max: 30 });
const HEADERS = { "cache-control": "private, no-store" };

/**
 * Anyone can take a route down, at once. The route is hidden, not erased, and
 * the owner is emailed a link that brings it back.
 */
export async function POST(request: Request, context: { readonly params: Promise<{ readonly id: string }> }): Promise<Response> {
  const { id } = await context.params;
  if (!/^[A-Za-z0-9_-]{1,120}$/.test(id)) return Response.json({ error: "Invalid route id." }, { status: 400, headers: HEADERS });
  const wait = limiter.check(request);
  if (wait !== null) return Response.json({ error: "Too many removals. Try again later." }, { status: 429, headers: { ...HEADERS, "retry-after": String(wait) } });
  const name = knownRouteName(id);
  if (name === null) return Response.json({ error: "Route not found." }, { status: 404, headers: HEADERS });
  let reason = "";
  try {
    reason = cleanReason(((await request.json()) as { reason?: unknown }).reason);
  } catch {
    // A removal needs no reason.
  }
  const removedAt = new Date().toISOString();
  if (!sharedCommunityRouteStore().remove(id, reason, removedAt)) return Response.json({ removed: true }, { headers: HEADERS });
  await notifyRouteRemoved({ routeId: id, name, reason, removedAt });
  return Response.json({ removed: true }, { headers: HEADERS });
}
