"use client";

import { useMemo, type ComponentProps } from "react";
import type { ElevationSource } from "@/application/elevation/profile";
import type { ElevationWaypoint } from "@/application/elevation/waypoints";
import type { PlannerPreparationRoute } from "@/application/preparation/planner-context";
import type { RideDocument } from "@/domain/ride/types";
import { ElevationProfileChart } from "./ElevationProfileChart";
import { useElevationProfile } from "./useElevationProfile";

export interface PlannerElevationProfileProps {
  readonly route: PlannerPreparationRoute & { readonly routeId: string };
  readonly source: ElevationSource;
  /** The ride the route was planned from, for the chart's numbered notches. */
  readonly intent: RideDocument["intent"];
  readonly tint: number;
  readonly surface: ComponentProps<typeof ElevationProfileChart>["surface"];
  /** The sheet is at its expanded detent: the chart opens expanded too. */
  readonly expandedBySheet?: boolean;
}

/**
 * Sampling, fetching and drawing the profile start only once a route exists.
 *
 * The waypoint list is built here rather than in the result panel so the ride's
 * authored points and the projection that notches them arrive together, and the
 * first-load bundle carries neither: the hook is the same one the glance strip
 * reads (one request answers both), and the chart, the waypoint projection and
 * their drawing styles load with this module.
 */
export function PlannerElevationProfile({
  route,
  source,
  intent,
  tint,
  surface,
  expandedBySheet = false,
}: PlannerElevationProfileProps) {
  const elevation = useElevationProfile(source, route.routeId, route.geometry);
  // The authored points in ride order: the start, the stops, then the finish.
  // Shaping anchors stay off the list (04 §15).
  const waypoints = useMemo((): readonly ElevationWaypoint[] => {
    const { start, stops, finish } = intent;
    const points: ElevationWaypoint[] = [];
    if (start !== null) points.push({ coordinate: start.coordinate, label: "Start" });
    stops.forEach((stop, index) => points.push({ coordinate: stop.coordinate, label: `Stop ${index + 1}` }));
    if (finish !== null) points.push({ coordinate: finish.coordinate, label: "Finish" });
    return points;
  }, [intent]);
  if (elevation === null) return null;
  return (
    <div className="og-elevation-slot" data-tint={tint}>
      <ElevationProfileChart
        state={elevation}
        surface={surface}
        waypoints={waypoints}
        line={route.geometry}
        expandedBySheet={expandedBySheet}
      />
    </div>
  );
}
