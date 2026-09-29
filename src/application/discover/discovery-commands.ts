/**
 * The only way a discovery changes a ride: the rider adds it, and it becomes
 * an ordinary authored stop through the normal `stop.insert` command. Nothing
 * here touches Best Ride or selection; the planner re-plans the new intent.
 */

import { newCommandId, newStopId } from "@/domain/ride/ids";
import type { RideCommand } from "@/domain/ride/commands";
import type { RideDocument, StopArrivalIntent } from "@/domain/ride/types";

import type { DiscoverCategory, InterestingPlace } from "./types";

function arrivalIntentFor(category: DiscoverCategory): StopArrivalIntent {
  switch (category) {
    case "viewpoint":
    case "scenic":
    case "waterfall":
      return "scenic";
    case "camping":
      return "lodging";
    default:
      return "visit";
  }
}

export function addDiscoveryStopCommand(
  document: Pick<RideDocument, "rideId" | "revision">,
  place: InterestingPlace,
): Extract<RideCommand, { type: "stop.insert" }> {
  return {
    type: "stop.insert",
    commandId: newCommandId(),
    rideId: document.rideId,
    baseRevision: document.revision,
    source: "rider",
    label: `Add ${place.name}`,
    stop: {
      id: newStopId(),
      kind: "stop",
      coordinate: { lon: place.coordinate.lon, lat: place.coordinate.lat },
      label: place.name,
      arrivalIntent: arrivalIntentFor(place.category),
      provenance: {
        type: "search",
        provider: place.provenance[0]?.sourceId ?? "discover",
        placeId: place.id,
        query: place.name,
      },
    },
  };
}
