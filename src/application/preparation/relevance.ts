/** Pure relevance policy for route preparation (04 §22, Wave 7.1). */

import type { RoutePreparationContext } from "./prepare-route";

function finite(value: number | null | undefined): value is number {
  return value !== null && value !== undefined && Number.isFinite(value);
}

function instant(value: string | null | undefined): number | null {
  if (value === null || value === undefined) return null;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function departureInWindow(
  departure: string | null | undefined,
  window: { readonly start: string; readonly end: string },
): boolean {
  const point = instant(departure);
  const start = instant(window.start);
  const end = instant(window.end);
  return point !== null && start !== null && end !== null && start <= end
    && point >= start
    && point <= end;
}

/** Weather has a decision window only when the rider supplied one. */
export function weatherIsRelevant(context: RoutePreparationContext): boolean {
  return (context.tripWindow !== undefined && context.tripWindow !== null)
    || (context.weatherLocation !== undefined && context.weatherLocation !== null);
}

/** Traffic is relevant for a known congestion interval or mapped corridor. */
export function trafficIsRelevant(context: RoutePreparationContext): boolean {
  return context.routeTouchesMappedCorridor === true
    || (context.congestedWindows ?? []).some((window) => departureInWindow(context.departure, window));
}

/** Long distance, a short usable range, or an unknown range warrants a fuel check. */
export function fuelIsRelevant(context: RoutePreparationContext): boolean {
  return (finite(context.distanceKm) && context.distanceKm > 120)
    || (finite(context.fuelRangeKm) && context.fuelRangeKm < 120)
    || context.fuelRangeKm === null
    || context.fuelRangeKm === undefined;
}

/** Compare a known ride duration with daylight when a sunset is known. */
export function daylightIsRelevant(context: RoutePreparationContext): boolean {
  return instant(context.sunset) !== null && finite(context.rideDurationMinutes);
}

/** Long-trip reference checks are not useful for ordinary short rides. */
export function lodgingIsRelevant(context: RoutePreparationContext): boolean {
  return context.multiDay === true || (finite(context.distanceKm) && context.distanceKm > 150);
}

export function serviceIsRelevant(context: RoutePreparationContext): boolean {
  return lodgingIsRelevant(context);
}

/** Named aliases for consumers that prefer policy-oriented verbs. */
export const shouldShowWeather = weatherIsRelevant;
export const shouldShowTraffic = trafficIsRelevant;
export const shouldShowFuel = fuelIsRelevant;
export const shouldShowDaylight = daylightIsRelevant;
export const shouldShowLodging = lodgingIsRelevant;
export const shouldShowService = serviceIsRelevant;
