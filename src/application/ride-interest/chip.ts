/**
 * The one "coming up" chip (OGV#13): glanceable at speed, so only the
 * single nearest ahead point is ever worth a rider's glance. Everything else
 * stays icon-only pins on the map until tapped.
 */

import type { AheadRideInterestPoint } from "./ahead-of-rider";
import type { RideInterestKind, RideInterestPoint } from "./types";

export interface RideInterestChip {
  /** "Waterfall 0.8 mi" — what the rider reads without opening anything. */
  readonly label: string;
  readonly point: RideInterestPoint;
}

const KIND_LABELS: Partial<Record<RideInterestKind, string>> = {
  waterfall: "Waterfall",
  viewpoint: "Viewpoint",
  viewpoints: "Viewpoint",
  scenic: "Scenic spot",
  history: "Historic site",
  ruins: "Ruins",
  bridge: "Bridge",
  museum: "Museum",
  architecture: "Landmark",
  "public-art": "Public art",
  nature: "Nature spot",
  quirky: "Roadside oddity",
  roadside: "Roadside stop",
  recreation: "Recreation area",
  camping: "Campground",
  event: "Event",
  fuel: "Gas",
  food: "Food",
  coffee: "Coffee",
  happy_hour: "Happy hour",
};

/** "Waterfall", falling back to the raw kind for anything not in the table. */
export function kindLabel(kind: RideInterestKind): string {
  return KIND_LABELS[kind] ?? String(kind).replace(/[-_]/g, " ");
}

function milesText(miles: number): string {
  return miles < 10 ? miles.toFixed(1) : String(Math.round(miles));
}

/**
 * The nearest ahead point, or `null` when nothing is ahead. `ahead` is
 * expected pre-sorted nearest-first (`pointsAheadOfRider`'s contract), so
 * this never re-sorts a list the caller may run every position tick.
 */
export function comingUpChip(ahead: readonly AheadRideInterestPoint[]): RideInterestChip | null {
  const nearest = ahead[0];
  if (nearest === undefined) return null;
  return {
    label: `${kindLabel(nearest.point.kind)} ${milesText(nearest.aheadMiles)} mi`,
    point: nearest.point,
  };
}
