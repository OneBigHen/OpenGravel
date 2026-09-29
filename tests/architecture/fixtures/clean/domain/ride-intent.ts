import type { GeometryRef } from "./geometry-ref";

export type RideIntent = {
  readonly rideId: string;
  readonly baseRevision: number;
  readonly geometry: GeometryRef | null;
};

export function createRideIntent(
  rideId: string,
  baseRevision: number,
): RideIntent {
  return { rideId, baseRevision, geometry: null };
}
