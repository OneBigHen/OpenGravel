/** Which prefetched points the rider's sheet filter shows right now. */

import type { RideInterestFilter, RideInterestPoint } from "./types";

export function visibleRideInterestPoints(
  points: readonly RideInterestPoint[],
  filter: RideInterestFilter,
): readonly RideInterestPoint[] {
  if (filter === "off") return [];
  return points.filter((point) => point.filter === filter);
}
