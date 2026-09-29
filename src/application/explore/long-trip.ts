import type { CatalogEntry } from "./catalog";
import {
  calculateSunset,
  longTripConsiderations,
  type LongTripBike,
  type LongTripFacts,
} from "@/application/long-trip";
import type { RoutePreparation } from "@/application/preparation/prepare-route";

function weatherFactsFromPreparation(preparation: RoutePreparation): LongTripFacts["weather"] {
  const item = preparation.items.find((candidate) => candidate.kind === "weather");
  if (item === undefined || (item.state !== "ready" && item.state !== "stale")) return undefined;
  const data = item.data;
  if (data === undefined || typeof data !== "object" || data === null) return undefined;
  const record = data as Record<string, unknown>;
  if (typeof record.fetchedAt !== "string") return undefined;
  if (record.tripWindowScoped !== true) return undefined;
  const alerts = Array.isArray(record.tripAlerts)
    ? record.tripAlerts.flatMap((alert) => {
        if (typeof alert !== "object" || alert === null || Array.isArray(alert)) return [];
        const candidate = alert as Record<string, unknown>;
        return typeof candidate.severity === "string"
          ? [{ severity: candidate.severity, ...(typeof candidate.event === "string" ? { event: candidate.event } : {}) }]
          : [];
      })
    : [];
  return {
    state: item.state,
    fetchedAt: record.fetchedAt,
    source: item.provenance,
    sourceRef: record.source === "nws" ? "weather:nws" : `weather:${item.provenance}`,
    ...(typeof record.ageMinutes === "number" ? { ageMinutes: record.ageMinutes } : {}),
    ...(typeof record.maxPrecipChance === "number" ? { maxPrecipChance: record.maxPrecipChance } : {}),
    ...(typeof record.maxWindMph === "number" ? { maxWindMph: record.maxWindMph } : {}),
    alerts,
  };
}

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
  const derivedDaylight = departure !== null && entry.geometry[0] !== undefined
    ? calculateSunset(entry.geometry[0], departure)
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
