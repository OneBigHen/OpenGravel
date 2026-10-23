import { createAddressRateLimiter } from "@/server/rate-limit";
import { handleCreateLiveRide } from "@/server/live/handler";
import { liveRideStore, type SQLiteLiveRideStore } from "@/server/live/live-ride-store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Starting a live ride is cheap for us but persistent for the store, and nothing
 * about a live ride requires an account. One address gets ten an hour here; the
 * store keeps its own per-client hour and the disk budget, so a single caller
 * cannot spend either for everyone.
 */
const limiter = createAddressRateLimiter({ windowMs: 60 * 60_000, max: 10 });
const LIMIT_HEADERS = {
  "cache-control": "no-store",
  "referrer-policy": "no-referrer",
  "x-robots-tag": "noindex, nofollow",
} as const;

export async function handleCreateLiveRideRequest(
  request: Request,
  store: SQLiteLiveRideStore,
): Promise<Response> {
  const wait = limiter.check(request);
  if (wait !== null) {
    return Response.json(
      { message: "You have started too many live rides in the last hour. Try again later." },
      { status: 429, headers: { ...LIMIT_HEADERS, "retry-after": String(wait) } },
    );
  }
  return handleCreateLiveRide(request, store);
}

export async function POST(request: Request): Promise<Response> {
  return handleCreateLiveRideRequest(request, liveRideStore());
}
