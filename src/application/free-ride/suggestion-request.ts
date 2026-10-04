import { newPointId, newShapingId } from "@/domain/ride/ids";
import type { Coordinate, RideIntent } from "@/domain/ride/types";
import type { RideDocument } from "@/domain/ride/types";
import { deepFreeze } from "@/domain/util/freeze";
import type { FreeRideNetworkOpportunity } from "./network-opportunities";

const EARTH_RADIUS_METERS = 6_371_000;

function destinationPoint(origin: Coordinate, headingDegrees: number, distanceMeters: number): Coordinate {
  const angularDistance = distanceMeters / EARTH_RADIUS_METERS;
  const bearing = headingDegrees * Math.PI / 180;
  const latitude = origin.lat * Math.PI / 180;
  const longitude = origin.lon * Math.PI / 180;
  const destinationLatitude = Math.asin(
    Math.sin(latitude) * Math.cos(angularDistance) +
    Math.cos(latitude) * Math.sin(angularDistance) * Math.cos(bearing),
  );
  const destinationLongitude = longitude + Math.atan2(
    Math.sin(bearing) * Math.sin(angularDistance) * Math.cos(latitude),
    Math.cos(angularDistance) - Math.sin(latitude) * Math.sin(destinationLatitude),
  );
  return {
    lon: ((destinationLongitude * 180 / Math.PI + 540) % 360) - 180,
    lat: destinationLatitude * 180 / Math.PI,
  };
}

/** Build a short, forward segment request without dropping authored constraints. */
export function buildLiveSuggestionIntent(input: {
  readonly document: RideDocument;
  readonly origin: Coordinate;
  readonly headingDegrees: number;
  readonly accuracyMeters: number;
  readonly at: string;
  readonly segmentDistanceMeters: number;
}): RideIntent {
  if (!Number.isFinite(input.headingDegrees) || input.headingDegrees < 0 || input.headingDegrees >= 360) {
    throw new RangeError("heading must be a finite compass bearing");
  }
  if (!Number.isFinite(input.accuracyMeters) || input.accuracyMeters < 0) {
    throw new RangeError("GPS accuracy must be a finite non-negative distance");
  }
  if (!Number.isFinite(input.segmentDistanceMeters) || input.segmentDistanceMeters <= 0 || input.segmentDistanceMeters > 10_000) {
    throw new RangeError("suggestion segment distance must be between 0 and 10000 meters");
  }
  const intent = input.document.intent;
  const pointProvenance = {
    type: "gps" as const,
    accuracyMeters: input.accuracyMeters,
    observedAt: input.at,
  };
  return deepFreeze({
    ...intent,
    shape: "destination",
    // These anchors describe the authored destination route. The live segment
    // has its own nearby endpoint; keep global bike, surface, access and avoid
    // constraints below, but do not send an old itinerary as this segment's path.
    stops: [],
    shaping: [],
    sketch: null,
    longTrip: null,
    start: {
      id: newPointId(), kind: "start", coordinate: { ...input.origin },
      provenance: pointProvenance,
    },
    finish: {
      id: newPointId(), kind: "finish",
      coordinate: destinationPoint(input.origin, input.headingDegrees, input.segmentDistanceMeters),
      provenance: pointProvenance,
    },
  });
}


/**
 * Build a constrained route request intent through one directed network
 * opportunity.
 *
 * Unlike the generic projected-ahead intent, this uses the opportunity's real
 * onward rejoin as the finish and its corridor entry/exit as shaping anchors.
 * Authored itinerary points and sketches still stay out of the short live
 * segment, while bike/surface/access/avoid constraints remain inherited.
 */
export function buildNetworkSuggestionIntent(input: {
  readonly document: RideDocument;
  readonly opportunity: FreeRideNetworkOpportunity;
  readonly accuracyMeters: number;
  readonly at: string;
}): RideIntent {
  if (!Number.isFinite(input.accuracyMeters) || input.accuracyMeters < 0) {
    throw new RangeError("GPS accuracy must be a finite non-negative distance");
  }
  const intent = input.document.intent;
  const pointProvenance = {
    type: "gps" as const,
    accuracyMeters: input.accuracyMeters,
    observedAt: input.at,
  };

  return deepFreeze({
    ...intent,
    shape: "destination",
    stops: [],
    shaping: input.opportunity.via.map((coordinate) => ({
      id: newShapingId(),
      kind: "shape" as const,
      coordinate: { ...coordinate },
      source: "import" as const,
    })),
    sketch: null,
    longTrip: null,
    start: {
      id: newPointId(),
      kind: "start",
      coordinate: { ...input.opportunity.origin },
      provenance: pointProvenance,
    },
    finish: {
      id: newPointId(),
      kind: "finish",
      coordinate: { ...input.opportunity.destination },
      provenance: {
        type: "derived" as const,
        reason: "directed Free Ride network rejoin",
      },
    },
  });
}
