import { createRideIntent, type RideIntent } from "../domain/ride-intent";

export function planRoute(rideId: string, baseRevision: number): RideIntent {
  return createRideIntent(rideId, baseRevision);
}
