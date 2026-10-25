import { handleFollowLiveRide } from "@/server/live/handler";
import { liveRideStore } from "@/server/live/live-ride-store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** The public read. Anonymous by design: the token *is* the capability. */
export async function GET(
  request: Request,
  context: { params: Promise<{ token: string }> },
): Promise<Response> {
  return handleFollowLiveRide(request, (await context.params).token, liveRideStore());
}
