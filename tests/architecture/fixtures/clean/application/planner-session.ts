import type { RideIntent } from "../domain/ride-intent";
import { planRoute } from "./plan-route";

export function startPlanningSession(
  rideId: string,
  baseRevision: number,
): RideIntent {
  return planRoute(rideId, baseRevision);
}
