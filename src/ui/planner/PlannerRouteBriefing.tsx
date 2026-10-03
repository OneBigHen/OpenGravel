"use client";

import type { BikeProfile } from "@/application/garage/garage-model";
import type { PreparationProviderRegistry } from "@/application/preparation/providers";
import type { PlannerPreparationRoute } from "@/application/preparation/planner-context";
import type { SelectedOfflineRoute } from "@/application/offline/selected-offline-route";
import { arrivalTargetOf } from "@/application/planner/arrive-by";
import type { Coordinate, RideDocument } from "@/domain/ride/types";
import { PlannerPreparation } from "@/ui/planner/PlannerPreparation";
import type { RideStyleActions } from "@/ui/planner/RideStyleControls";
import type { RoadOpeningSummary } from "@/application/route-intelligence/opening-calendar-contract";
import type { ExploreMapConfig } from "@/ui/explore/ExploreMap";
import type { RouteTrafficLabel } from "@/ui/planner/PlannerPreparation";

export interface PlannerRouteBriefingProps {
  readonly route: (PlannerPreparationRoute & { readonly routeId: string }) | null;
  readonly ride: RideDocument;
  readonly bikes: readonly BikeProfile[];
  readonly providers?: PreparationProviderRegistry;
  /** Adds a stop at a coordinate (fuel on the way); the same typed command. */
  readonly opportunityMap?: ExploreMapConfig;
  readonly onRouteThrough?: (road: RoadOpeningSummary) => void | Promise<void>;
  readonly onAddStopAt?: (coordinate: Coordinate, name: string) => void;
  readonly offlineRoute: SelectedOfflineRoute | null;
  readonly actions: Pick<RideStyleActions, "setBike" | "setDeparture" | "setArriveBy">;
  readonly onRouteTraffic: (traffic: RouteTrafficLabel | null) => void;
}

/** Binds the active ride's typed controls and garage choices to its briefing. */
export function PlannerRouteBriefing({
  route,
  ride,
  bikes,
  providers,
  onAddStopAt,
  onRouteThrough,
  opportunityMap,
  offlineRoute,
  actions,
  onRouteTraffic,
}: PlannerRouteBriefingProps) {
  return (
    <PlannerPreparation
      route={route}
      departure={ride.intent.departure}
      bike={ride.intent.bike}
      bikes={bikes}
      providers={providers}
      onAddStopAt={onAddStopAt}
      onRouteThrough={onRouteThrough}
      opportunityMap={opportunityMap}
      offlineRoute={offlineRoute}
      onDepartureChange={actions.setDeparture}
      arrival={arrivalTargetOf(ride.intent.time)}
      onArrivalChange={ride.intent.shape === "destination" ? actions.setArriveBy : undefined}
      onBikeChange={actions.setBike}
      onRouteTraffic={onRouteTraffic}
    />
  );
}
