import { openPlanner } from "../ui/planner-workspace";

export function renderPlannerPage(rideId: string, baseRevision: number): string {
  return openPlanner(rideId, baseRevision);
}
