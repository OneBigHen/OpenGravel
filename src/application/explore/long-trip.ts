import type { CatalogEntry } from "./catalog";
import {
  longTripConsiderations,
  sunsetOnDepartureDay,
  type LongTripBike,
  type LongTripFacts,
} from "@/application/long-trip";
import type { RoutePreparation } from "@/application/preparation/prepare-route";

import { weatherFactsFromPreparation } from "@/application/preparation/long-trip";

/** Add long-trip decisions to a preparation view model without letting UI own policy. */
export function enrichRoutePreparationForLongTrip(
  entry: CatalogEntry,
  preparation: RoutePreparation,
  /**
   * The rider's active garage bike (EX-02, RS-01): fuel advice is about the
   * bike that will ride it, not the one the catalog author planned with.
   */
  activeBike?: LongTripBike | null,
): RoutePreparation {
  if (preparation.considerations !== undefined) return preparation;
  const sourceDocument = entry.sourceDocument;
  const departure = sourceDocument?.intent.departure.kind === "future"
    ? sourceDocument.intent.departure.at
    : null;
  // The sunset of the rider's own day: the UTC-date calculation alone gets the
  // previous evening for a morning start in the Americas.
  const derivedDaylight = departure !== null && entry.geometry[0] !== undefined
    ? sunsetOnDepartureDay(entry.geometry[0], departure)
    : null;
  const longTripFacts: LongTripFacts = {
    ...(entry.longTripFacts ?? {}),
    ...(entry.longTripFacts?.daylight === undefined && derivedDaylight !== null ? { daylight: derivedDaylight } : {}),
    ...(entry.longTripFacts?.weather === undefined
      ? { weather: weatherFactsFromPreparation(preparation) }
      : {}),
  };
  return {
    ...preparation,
    considerations: longTripConsiderations({
      distanceKm: entry.distanceKm,
      durationMinutes: entry.estimatedTimeMinutes,
      ...(sourceDocument === undefined ? {} : {
        departure,
        bike: sourceDocument.intent.bike,
        longTrip: sourceDocument.intent.longTrip,
      }),
      ...(activeBike === undefined || activeBike === null ? {} : { bike: activeBike }),
    }, longTripFacts),
  };
}
