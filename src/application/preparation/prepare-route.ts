/**
 * Relevance-driven route preparation composition (04 §22–§25, Wave 7.1).
 *
 * This module is the application seam between a selected route and optional
 * capability ports. It never fetches. A missing or unavailable port produces an
 * explicit unavailable item and an unavailable capability declaration.
 */

import {
  ABSENT_PROVENANCE,
  probeCapabilities,
  providersByKind,
  type PreparationProvider,
  type ProviderResult,
  type RegisteredPreparationProviders,
  type WeatherData,
  type TrafficData,
  type OfflineRouteData,
  type ProviderKind,
  type WeatherLocation,
} from "./providers";
import {
  daylightIsRelevant,
  fuelIsRelevant,
  trafficIsRelevant,
  weatherIsRelevant,
} from "./relevance";
import type {
  PreparationData,
  PreparationItemKind,
  PreparationRelevance,
  PreparationState,
  RoutePreparationItem,
  TimeWindow,
  TripWindow,
} from "./types";
import type { ProviderCapability } from "./providers";
import type { Coordinate } from "@/domain/ride/types";
import type { Consideration } from "@/application/long-trip";

export type {
  PreparationData,
  PreparationDisplayData,
  PreparationItemKind,
  PreparationRelevance,
  PreparationState,
  RoutePreparationItem,
  TimeWindow,
  TripWindow,
} from "./types";

export interface RoutePreparationContext {
  readonly distanceKm?: number | null;
  readonly rideDurationMinutes?: number | null;
  readonly departure?: string | null;
  readonly tripWindow?: TripWindow | null;
  readonly congestedWindows?: readonly TimeWindow[];
  readonly routeTouchesMappedCorridor?: boolean;
  readonly fuelRangeKm?: number | null;
  readonly sunset?: string | null;
  readonly remainingDaylightMinutes?: number | null;
  readonly multiDay?: boolean;
  /** Optional base facts from route/evidence read models. */
  readonly routeCharacter?: RoutePreparationFact | null;
  readonly surface?: RoutePreparationFact | null;
  readonly warnings?: RoutePreparationFact | null;
  readonly weatherLocation?: WeatherLocation | null;
  /** IANA timezone of the rider's device, used only to present absolute weather times. */
  readonly riderTimeZone?: string;
  readonly trafficCorridor?: readonly Coordinate[];
  readonly trafficWaypoints?: readonly Coordinate[];
  readonly providers?: RegisteredPreparationProviders;
}

export interface RoutePreparationFact {
  readonly state: PreparationState;
  readonly reason: string;
  readonly provenance: string;
  readonly data?: PreparationData;
}

export interface RoutePreparation {
  readonly items: readonly RoutePreparationItem[];
  /** Long-trip enrichment is optional and remains absent for ordinary rides. */
  readonly considerations?: readonly Consideration[];
  readonly capabilities: readonly ProviderCapability[];
  /** Used by the UI to distinguish an empty registry from outage rows. */
  readonly registeredProviderCount: number;
}

const ALWAYS: PreparationRelevance = "always";
const CONDITIONAL: PreparationRelevance = "conditional";

const ABSENT_ITEM_REASONS: Readonly<Record<PreparationItemKind, string>> = {
  weather: "Weather data is not available yet.",
  traffic: "Traffic data is not available yet.",
  fuel: "Fuel range is not configured for this ride.",
  daylight: "Sunset comparison is not available yet.",
  "offline-route": "Offline route capability is not available yet.",
  lodging: "Lodging checks are not available yet.",
  service: "Service checks are not available yet.",
  elevation: "Elevation data is not available yet.",
  "route-character": "Route character evidence is not available yet.",
  surface: "Surface evidence is not available yet.",
  warnings: "Key route warnings are not available yet.",
};

function finite(value: number | null | undefined): value is number {
  return value !== null && value !== undefined && Number.isFinite(value);
}

function providerCount(registered: RegisteredPreparationProviders): number {
  return Object.values(providersByKind(registered))
    .filter((provider): provider is PreparationProvider => provider !== undefined)
    .length;
}

function absentItem(
  kind: PreparationItemKind,
  relevance: PreparationRelevance,
  reason = ABSENT_ITEM_REASONS[kind],
  provenance = ABSENT_PROVENANCE,
): RoutePreparationItem {
  return { kind, state: "unavailable", relevance, reason, provenance };
}

function factItem(kind: PreparationItemKind, fact: RoutePreparationFact): RoutePreparationItem {
  return {
    kind,
    state: fact.state,
    relevance: ALWAYS,
    reason: fact.reason,
    provenance: fact.provenance,
    ...(fact.data === undefined ? {} : { data: fact.data }),
  };
}

function providerItem<TData extends { readonly display: string }>(
  kind: Extract<PreparationItemKind, ProviderKind>,
  result: ProviderResult<TData>,
  relevance: PreparationRelevance,
): RoutePreparationItem {
  return {
    kind,
    state: result.state,
    relevance,
    reason: result.reason,
    provenance: result.provenance,
    ...(result.data === undefined ? {} : { data: result.data }),
  };
}

function isAlertPrimaryWeather(item: RoutePreparationItem): boolean {
  if (item.kind !== "weather" || item.data === undefined || typeof item.data !== "object" || item.data === null) {
    return false;
  }
  return "primaryAlert" in item.data && item.data.primaryAlert !== undefined;
}

function safeProviderResult<TData extends { readonly display: string }>(
  provider: PreparationProvider | undefined,
  kind: ProviderKind,
  context: RoutePreparationContext,
): ProviderResult<TData> {
  if (provider === undefined) return {
    state: "unavailable",
    reason: ABSENT_ITEM_REASONS[kind],
    provenance: ABSENT_PROVENANCE,
  };
  const capability = provider.capabilities();
  if (capability.kind !== kind || capability.availability === "unavailable") {
    return {
      state: "unavailable",
      reason: capability.reason ?? ABSENT_ITEM_REASONS[kind],
      provenance: capability.provenance,
    };
  }
  try {
    switch (kind) {
      case "weather":
        return (provider as { getWeather: (input: RoutePreparationContext) => ProviderResult<WeatherData> }).getWeather(context) as ProviderResult<TData>;
      case "traffic":
        return (provider as { getTraffic: (input: RoutePreparationContext) => ProviderResult<TrafficData> }).getTraffic(context) as ProviderResult<TData>;
      case "offline-route":
        return (provider as { getOfflineRoute: (input: RoutePreparationContext) => ProviderResult<OfflineRouteData> }).getOfflineRoute(context) as ProviderResult<TData>;
      case "elevation":
        return (provider as { getElevation: (input: RoutePreparationContext) => ProviderResult<{ display: string }> }).getElevation(context) as ProviderResult<TData>;
    }
  } catch {
    return {
      state: "unavailable",
      reason: `${kind} data is not available yet.`,
      provenance: capability.provenance,
    };
  }
}

function fuelItem(context: RoutePreparationContext): RoutePreparationItem {
  if (!finite(context.distanceKm) || !finite(context.fuelRangeKm)) {
    return absentItem("fuel", CONDITIONAL);
  }
  const coversRoute = context.fuelRangeKm >= context.distanceKm;
  return {
    kind: "fuel",
    state: "ready",
    relevance: CONDITIONAL,
    reason: coversRoute
      ? "Configured fuel range covers this route."
      : "Configured fuel range does not cover this route; plan a fuel stop.",
    provenance: "Bike profile",
    data: { display: `${Math.round(context.fuelRangeKm / 1.609344)} mi range` },
  };
}

function daylightItem(context: RoutePreparationContext): RoutePreparationItem {
  if (!finite(context.remainingDaylightMinutes)) return absentItem("daylight", CONDITIONAL);
  const remaining = context.remainingDaylightMinutes;
  const duration = context.rideDurationMinutes;
  if (!finite(duration)) return absentItem("daylight", CONDITIONAL);
  const fits = duration <= remaining;
  return {
    kind: "daylight",
    state: "ready",
    relevance: CONDITIONAL,
    reason: fits
      ? "This ride fits within the remaining daylight."
      : "This ride may finish after sunset.",
    provenance: "Sunset calculation",
    data: { display: `${Math.max(0, Math.round(remaining))} min remaining` },
  };
}

/** Compose the selected route's current preparation truth in a stable order. */
export function prepareRoute(
  context: RoutePreparationContext,
  registeredOverride?: RegisteredPreparationProviders,
): RoutePreparation {
  const registered = registeredOverride ?? context.providers ?? {};
  const byKind = providersByKind(registered);
  const items: RoutePreparationItem[] = [];

  if (context.routeCharacter !== undefined && context.routeCharacter !== null) {
    items.push(factItem("route-character", context.routeCharacter));
  }
  if (context.surface !== undefined && context.surface !== null) {
    items.push(factItem("surface", context.surface));
  }
  if (context.warnings !== undefined && context.warnings !== null) {
    items.push(factItem("warnings", context.warnings));
  }

  if (weatherIsRelevant(context)) {
    const weatherItem = providerItem("weather", safeProviderResult(byKind.weather, "weather", context), CONDITIONAL);
    // A route-window alert is the decision's highest-priority preparation fact,
    // even when route evidence was supplied earlier in the composition.
    if (isAlertPrimaryWeather(weatherItem)) items.unshift(weatherItem);
    else items.push(weatherItem);
  }
  if (trafficIsRelevant(context)) {
    items.push(providerItem("traffic", safeProviderResult(byKind.traffic, "traffic", context), CONDITIONAL));
  }
  if (fuelIsRelevant(context)) items.push(fuelItem(context));
  if (daylightIsRelevant(context)) items.push(daylightItem(context));

  // Offline routing is always a separate capability: a saved route never proves
  // that a route-specific graph is installed.
  items.push(providerItem("offline-route", safeProviderResult(byKind["offline-route"], "offline-route", context), ALWAYS));

  return {
    items,
    capabilities: probeCapabilities(registered),
    registeredProviderCount: providerCount(registered),
  };
}

export const buildRoutePreparation = prepareRoute;
