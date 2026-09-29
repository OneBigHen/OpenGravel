"use client";

import type { BikeProfile } from "@/application/garage/garage-model";
import type { PreparationProviderRegistry } from "@/application/preparation/providers";
import type { PlannerPreparationRoute } from "@/application/preparation/planner-context";
import type { SelectedOfflineRoute } from "@/application/offline/selected-offline-route";
import type { PlacesSource } from "@/application/places/places-source";
import type { NearbyPlace } from "@/application/places/types";
import { arrivalTargetOf } from "@/application/planner/arrive-by";
import type { Coordinate, RideDocument } from "@/domain/ride/types";
import { PlannerPreparation } from "@/ui/planner/PlannerPreparation";
import type { RideStyleActions } from "@/ui/planner/RideStyleControls";
import type { RouteTrafficLabel } from "@/ui/planner/PlannerPreparation";

export interface PlannerRouteBriefingProps {
  readonly route: (PlannerPreparationRoute & { readonly routeId: string }) | null;
  readonly ride: RideDocument;
  readonly bikes: readonly BikeProfile[];
  readonly providers?: PreparationProviderRegistry;
  readonly placesSource?: PlacesSource;
  readonly onAddStop?: (place: NearbyPlace) => void;
  /** Adds a stop at a coordinate (fuel on the way); the same typed command. */
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
  placesSource,
  onAddStop,
  onAddStopAt,
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
      placesSource={placesSource ?? providers?.places}
      onAddStop={onAddStop}
      onAddStopAt={onAddStopAt}
      offlineRoute={offlineRoute}
      onDepartureChange={actions.setDeparture}
      arrival={arrivalTargetOf(ride.intent.time)}
      onArrivalChange={ride.intent.shape === "destination" ? actions.setArriveBy : undefined}
      onBikeChange={actions.setBike}
      onRouteTraffic={onRouteTraffic}
    />
  );
}
