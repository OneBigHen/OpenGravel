import { buildProviderRequest } from "@/application/planner/build-plan-request";
import { defaultRideIntent } from "@/domain/ride/create";
import { newPointId, newRideId } from "@/domain/ride/ids";
import type { Coordinate, RidePoint } from "@/domain/ride/types";
import { createApiRouteProvider } from "@/infrastructure/routing/api-provider";
import { profileFor } from "@/infrastructure/routing/graphhopper/profiles";

/** A read-only route preview. It never enters the rider's planning session. */
export async function placeDriveTime(from: Coordinate, to: Coordinate, signal: AbortSignal): Promise<number | null> {
  const point = (kind: RidePoint["kind"], coordinate: Coordinate): RidePoint => ({
    id: newPointId(), kind, coordinate, provenance: { type: "search", provider: "preview", query: "" },
  });
  const intent = { ...defaultRideIntent(), roadCharacter: "efficient" as const,
    start: point("start", from), finish: point("finish", to) };
  const built = await buildProviderRequest(intent, { resolveGeometry: async () => null, profileFor });
  if (!built.ok || signal.aborted) return null;
  const provider = createApiRouteProvider({ firstRouteOnly: true });
  provider.beginAttempt({ rideId: newRideId(), rideRevision: 0, planningGeneration: 1 });
  try {
    const result = await provider.candidates(built.request, signal);
    const times = result.candidates.map((candidate) => candidate.durationSeconds).filter((seconds) => Number.isFinite(seconds) && seconds > 0);
    return times.length === 0 ? null : Math.min(...times);
  } catch { return null; }
}
