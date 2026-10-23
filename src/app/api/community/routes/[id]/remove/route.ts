import { createRateLimiter } from "@/server/rate-limit";
import { knownRouteName } from "@/server/community-routes/live-catalog";
import { notifyRouteRemoved } from "@/server/community-routes/notify";
import { handleRouteRemoval } from "@/server/community-routes/removal";
import { cleanReason } from "@/server/community-routes/share";
import { sharedCommunityRouteStore } from "@/server/community-routes/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const limiter = createRateLimiter({ windowMs: 60 * 60_000, max: 30 });
const HEADERS = { "cache-control": "private, no-store" };

/**
 * The device that shared a route can take it down. The share response minted a
 * secret; only its hash is stored, and the request must present the secret.
 * Built-in catalog routes have no sharer here, so they stay on Explore for
 * everyone; a rider who does not want one hides it on their own device. The
 * route is hidden, not erased, and the owner is emailed a restore link.
 */
export async function POST(request: Request, context: { readonly params: Promise<{ readonly id: string }> }): Promise<Response> {
  const { id } = await context.params;
  if (!/^[A-Za-z0-9_-]{1,120}$/.test(id)) return Response.json({ error: "Invalid route id." }, { status: 400, headers: HEADERS });
  const wait = limiter.check(request);
  if (wait !== null) return Response.json({ error: "Too many removals. Try again later." }, { status: 429, headers: { ...HEADERS, "retry-after": String(wait) } });
  let body: { readonly reason?: unknown; readonly ownerToken?: unknown } = {};
  try {
    body = (await request.json()) as { readonly reason?: unknown; readonly ownerToken?: unknown };
  } catch {
    // A removal needs no reason, but it always needs the ownership token.
  }
  const reason = cleanReason(body.reason);
  const outcome = handleRouteRemoval(
    { id, reason, ownerToken: typeof body.ownerToken === "string" ? body.ownerToken : "" },
    {
      store: sharedCommunityRouteStore(),
      catalogRouteExists: (routeId) => knownRouteName(routeId) !== null,
      now: () => new Date().toISOString(),
    },
  );
  if (outcome.status !== 200) return Response.json({ error: outcome.error }, { status: outcome.status, headers: HEADERS });
  if (outcome.removed) {
    await notifyRouteRemoved({ routeId: id, name: outcome.name, reason, removedAt: outcome.removedAt });
  }
  return Response.json({ removed: true }, { headers: HEADERS });
}
