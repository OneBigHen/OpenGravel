import type { RideIntent } from "../domain/ride-intent";

export function routeCardTitle(intent: RideIntent): string {
  return `Ride ${intent.rideId}`;
}
