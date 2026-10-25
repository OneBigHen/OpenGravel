import { handleFinishLiveRide } from "@/server/live/handler";
import { liveRideStore } from "@/server/live/live-ride-store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(
  request: Request,
  context: { params: Promise<{ rideId: string }> },
): Promise<Response> {
  return handleFinishLiveRide(request, (await context.params).rideId, liveRideStore());
}
