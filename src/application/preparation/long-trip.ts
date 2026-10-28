import { longTripConsiderations, type LongTripFacts, type LongTripBike } from "@/application/long-trip";
import type { RoutePreparation, RoutePreparationContext } from "./prepare-route";

export function weatherFactsFromPreparation(preparation: RoutePreparation): LongTripFacts["weather"] {
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

/** Use selected-route measurements and the current bike for the planner briefing. */
export function enrichPlannerPreparationForLongTrip(preparation: RoutePreparation, context: RoutePreparationContext, bike: LongTripBike): RoutePreparation {
  const considerations = longTripConsiderations({ distanceKm: context.distanceKm, durationMinutes: context.rideDurationMinutes, departure: context.departure, bike }, {
    weather: weatherFactsFromPreparation(preparation),
    ...(context.sunset == null ? {} : { daylight: { sunset: context.sunset, source: "Calculated at route start", sourceRef: "calculation:sunset-at-start" } }),
  });
  return considerations.length === 0 ? preparation : { ...preparation, considerations };
}
