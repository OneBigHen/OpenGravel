import { startPlanningSession } from "../application/planner-session";
import type { RideIntent } from "../domain/ride-intent";
import { routeCardTitle } from "./route-card";

export function openPlanner(rideId: string, baseRevision: number): string {
  const intent: RideIntent = startPlanningSession(rideId, baseRevision);
  return routeCardTitle(intent);
}
