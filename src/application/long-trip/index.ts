/**
 * Relevance-gated long-trip preparation (01 §12, 04 §22/§25, Wave 7.5).
 *
 * This module only turns supplied route, bike, provider, and catalog facts into
 * rider-facing considerations. It does not look up places, infer conditions,
 * or treat missing data as a positive result.
 */

export const LONG_TRIP_DISTANCE_KM = 150;
export const LONG_TRIP_DURATION_MINUTES = 180;
export const FUEL_RELEVANCE_DISTANCE_KM = 120;
export const CONSERVATIVE_DEFAULT_RANGE_KM = 160;

export type ConsiderationKind = "fuel" | "daylight" | "weather" | "lodging" | "service";
export type ConsiderationSeverity = "info" | "watch" | "critical";

export interface Consideration {
  readonly kind: ConsiderationKind;
  readonly severity: ConsiderationSeverity;
  readonly whyLine: string;
  readonly sourceRefs: readonly string[];
}

export interface LongTripBike {
  readonly fuelRangeMiles: number;
  readonly reserveMiles: number;
}

export interface LongTripRide {
  readonly distanceKm?: number | null;
  readonly durationMinutes?: number | null;
  readonly departure?: string | null;
  readonly region?: string | null;
  readonly bike?: LongTripBike | null;
  readonly longTrip?: { readonly staged: boolean } | null;
}

export interface LongTripDaylightFact {
  readonly sunset: string;
  readonly source: string;
  readonly sourceRef: string;
}

export interface LongTripWeatherAlert {
  readonly severity: string;
  readonly event?: string;
}

export interface LongTripWeatherFact {
  readonly state: "ready" | "stale";
  readonly fetchedAt: string;
  readonly source: string;
  readonly sourceRef: string;
  readonly ageMinutes?: number;
  readonly maxPrecipChance?: number;
  readonly maxWindMph?: number;
  readonly alerts?: readonly LongTripWeatherAlert[];
}

export interface LongTripCatalogFact {
  readonly status: "available" | "gap" | "unknown";
  readonly summary: string;
  readonly source: string;
  readonly sourceRef: string;
  readonly gapKm?: number;
}

export interface LongTripFacts {
  /** Used only for deterministic freshness wording; no clock is read here. */
  readonly now?: string;
  readonly daylight?: LongTripDaylightFact;
  readonly weather?: LongTripWeatherFact;
  readonly lodging?: LongTripCatalogFact;
  readonly service?: LongTripCatalogFact;
}

export { calculateSunset } from "./daylight";

function finite(value: number | null | undefined): value is number {
  return value !== null && value !== undefined && Number.isFinite(value);
}

function instant(value: string | null | undefined): number | null {
  if (value === null || value === undefined) return null;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function longTripIsRelevant(ride: LongTripRide): boolean {
  return ride.longTrip?.staged === true
    || (finite(ride.distanceKm) && ride.distanceKm > LONG_TRIP_DISTANCE_KM)
    || (finite(ride.durationMinutes) && ride.durationMinutes > LONG_TRIP_DURATION_MINUTES);
}

function fuelRange(ride: LongTripRide): {
  readonly rangeKm: number;
  readonly sourceRef: string;
  readonly assumed: boolean;
  /** "150 mi range − 30 mi reserve", so the usable figure explains itself (FT-04). */
  readonly basis: string | null;
} {
  const bike = ride.bike;
  if (
    bike !== undefined
    && bike !== null
    && finite(bike.fuelRangeMiles)
    && bike.fuelRangeMiles > 0
    && finite(bike.reserveMiles)
    && bike.reserveMiles >= 0
    && bike.fuelRangeMiles > bike.reserveMiles
  ) {
    return {
      rangeKm: (bike.fuelRangeMiles - bike.reserveMiles) * 1.609344,
      sourceRef: "bike-profile:fuel-range",
      assumed: false,
      basis: `${Math.round(bike.fuelRangeMiles)} mi range − ${Math.round(bike.reserveMiles)} mi reserve`,
    };
  }
  return {
    rangeKm: CONSERVATIVE_DEFAULT_RANGE_KM,
    sourceRef: "assumption:conservative-fuel-range",
    assumed: true,
    basis: null,
  };
}

/** Rider-facing distances are in miles (US riders); the model stays in km. */
function roundedKm(value: number): string {
  return `${Math.max(0, Math.round(value / 1.609344))} mi`;
}

function fuelConsideration(ride: LongTripRide): Consideration | null {
  if (!finite(ride.distanceKm) || ride.distanceKm <= FUEL_RELEVANCE_DISTANCE_KM) return null;
  const range = fuelRange(ride);
  const covered = range.rangeKm >= ride.distanceKm;
  const severity: ConsiderationSeverity = covered
    ? range.assumed ? "watch" : "info"
    : "critical";
  const assumption = range.assumed ? " This uses a conservative default assumption; configure the bike profile." : "";
  const action = covered
    ? "Verify fuel before the reserve."
    : "Plan a fuel stop before the range gap.";
  const region = ride.region === undefined || ride.region === null || ride.region.length === 0
    ? ""
    : ` in ${ride.region}`;
  return {
    kind: "fuel",
    severity,
    whyLine: `Route${region} is ${roundedKm(ride.distanceKm)} versus about ${roundedKm(range.rangeKm)} usable range${range.basis === null ? "" : ` (${range.basis})`}. ${action}${assumption}`,
    sourceRefs: ["ride:distance", ...(region === "" ? [] : ["ride:region"]), range.sourceRef],
  };
}

function daylightConsideration(ride: LongTripRide, facts: LongTripFacts): Consideration | null {
  if (!longTripIsRelevant(ride) || !finite(ride.durationMinutes)) return null;
  const daylight = facts.daylight;
  const departure = instant(ride.departure);
  const sunset = instant(daylight?.sunset);
  if (daylight === undefined || departure === null || sunset === null) return null;
  const arrival = departure + ride.durationMinutes * 60_000;
  const marginMinutes = Math.round((sunset - arrival) / 60_000);
  const severity: ConsiderationSeverity = marginMinutes < 0
    ? "critical"
    : marginMinutes < 30 ? "watch" : "info";
  const action = marginMinutes < 0
    ? "Plan to finish earlier or include a night-riding decision."
    : `Keep about ${marginMinutes} minutes of daylight margin.`;
  return {
    kind: "daylight",
    severity,
    whyLine: marginMinutes < 0
      ? `Planned arrival is about ${Math.abs(marginMinutes)} minutes after sunset. ${action}`
      : `Planned arrival is about ${marginMinutes} minutes before sunset. ${action}`,
    sourceRefs: ["ride:departure", "ride:duration", daylight.sourceRef],
  };
}

function severityRank(severity: string): number {
  switch (severity.toLowerCase()) {
    case "extreme": return 4;
    case "severe": return 3;
    case "moderate": return 2;
    case "minor": return 1;
    default: return 0;
  }
}

function weatherConsideration(ride: LongTripRide, facts: LongTripFacts): Consideration | null {
  if (!longTripIsRelevant(ride)) return null;
  const weather = facts.weather;
  if (weather === undefined) return null;
  const alerts = weather.alerts ?? [];
  const highestAlert = alerts.reduce((highest, alert) => Math.max(highest, severityRank(alert.severity)), 0);
  const precip = finite(weather.maxPrecipChance) && weather.maxPrecipChance >= 50 ? weather.maxPrecipChance : null;
  const wind = finite(weather.maxWindMph) && weather.maxWindMph >= 35 ? weather.maxWindMph : null;
  if (highestAlert === 0 && precip === null && wind === null) return null;

  let severity: ConsiderationSeverity = highestAlert >= 3 || (precip !== null && precip >= 70) || (wind !== null && wind >= 50)
    ? "critical"
    : "watch";
  const ageMinutes = weather.ageMinutes ?? (() => {
    const now = instant(facts.now);
    const fetchedAt = instant(weather.fetchedAt);
    return now !== null && fetchedAt !== null ? Math.max(0, Math.round((now - fetchedAt) / 60_000)) : null;
  })();
  const stale = weather.state === "stale";
  if (stale) severity = "watch";
  const observations = [
    highestAlert > 0 ? "an active weather alert" : null,
    precip === null ? null : `${Math.round(precip)}% precipitation chance`,
    wind === null ? null : `${Math.round(wind)} mph wind`,
  ].filter((value): value is string => value !== null);
  const freshness = stale
    ? ageMinutes === null ? " Weather data is stale; age is unknown." : ` Weather data is stale and ${ageMinutes} min old.`
    : "";
  return {
    kind: "weather",
    severity,
    whyLine: `${observations.join(", ")} crosses the trip-weather threshold; check conditions before riding.${freshness}`,
    sourceRefs: [weather.sourceRef],
  };
}

function catalogConsideration(
  kind: "lodging" | "service",
  fact: LongTripCatalogFact | undefined,
  ride: LongTripRide,
): Consideration | null {
  if (!longTripIsRelevant(ride) || fact === undefined) return null;
  const severity: ConsiderationSeverity = fact.status === "available" ? "info" : "watch";
  const distance = fact.gapKm === undefined ? "" : ` (${roundedKm(fact.gapKm)} gap reported)`;
  const status = fact.status === "unknown" ? " Availability is unknown in the catalog." : "";
  return {
    kind,
    severity,
    whyLine: `${fact.summary}${distance}${status} Use the supplied ${fact.source} evidence when deciding where to stop.`,
    sourceRefs: [fact.sourceRef],
  };
}

/** Build a stable, evidence-linked checklist. Missing facts intentionally add no reassuring row. */
export function longTripConsiderations(
  ride: LongTripRide,
  facts: LongTripFacts,
): readonly Consideration[] {
  if (!longTripIsRelevant(ride)) return [];
  return [
    fuelConsideration(ride),
    daylightConsideration(ride, facts),
    weatherConsideration(ride, facts),
    catalogConsideration("lodging", facts.lodging, ride),
    catalogConsideration("service", facts.service, ride),
  ].filter((item): item is Consideration => item !== null);
}
