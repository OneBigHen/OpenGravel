import type { Coordinate } from "@/domain/ride/types";

/** Authored points and optional routed geometry are stored with the ride. */
export interface BreadcrumbWaypoint {
  readonly id: string;
  readonly coordinate: Coordinate;
  readonly name?: string;
}

export interface BreadcrumbLeg {
  /** Straight legs have no provider dependency; snapped legs retain their geometry. */
  readonly kind: "straight" | "snapped";
  readonly geometry: readonly Coordinate[];
}

export interface BreadcrumbRoute {
  readonly waypoints: readonly BreadcrumbWaypoint[];
  /** Leg i joins waypoint i to waypoint i + 1. */
  readonly legs: readonly BreadcrumbLeg[];
}
