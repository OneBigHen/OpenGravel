/**
 * Provider ports for preparation (02 §10/§12, Wave 7.1).
 *
 * These interfaces are intentionally synchronous and bounded at this seam.
 * Network work belongs in a later infrastructure adapter; the application
 * composition only receives a typed result and never imports fetch or secrets.
 */

import type { MapLayersSource } from "@/application/map-layers";
import type { PlacesSource } from "@/application/places/places-source";
import type { ElevationSource } from "@/application/elevation/profile";
import type { RoutePreparationContext } from "./prepare-route";
import type { PreparationState } from "./types";

export type ProviderKind = "offline-route" | "weather" | "traffic" | "elevation";

export type ProviderAvailability = "available" | "degraded" | "unavailable";

/** How a provider's caller should interpret its freshness field. */
export type FreshnessSemantics = "live" | "time-bound" | "static" | "none";

export interface ProviderCapability {
  readonly kind: ProviderKind;
  readonly availability: ProviderAvailability;
  readonly freshness: FreshnessSemantics;
  /** Null is reserved for an available capability with no diagnostic reason. */
  readonly reason: string | null;
  readonly provenance: string;
}

export interface WeatherLocation {
  readonly lat: number;
  readonly lon: number;
}

export interface WeatherAlert {
  readonly event: string;
  readonly severity: string;
  readonly onset: string | null;
  readonly ends: string | null;
  readonly area: string;
}

export interface WeatherForecastPeriod {
  readonly name: string;
  readonly startTime: string;
  readonly endTime: string;
  readonly temperatureF?: number;
  readonly windMph?: number;
  readonly precipChance?: number;
  readonly shortForecast: string;
}

export interface WeatherSnapshot {
  readonly fetchedAt: string;
  readonly source: "nws";
  readonly alerts: readonly WeatherAlert[];
  readonly forecast: readonly WeatherForecastPeriod[];
}

export interface ProviderResult<TData extends { readonly display: string }> {
  readonly state: PreparationState;
  readonly reason: string;
  readonly provenance: string;
  readonly data?: TData;
}

export interface WeatherData {
  readonly display: string;
  readonly observedAt?: string;
  readonly validUntil?: string;
  readonly source?: "nws";
  readonly fetchedAt?: string;
  readonly freshnessLabel?: "Fresh" | "Stale";
  readonly ageMinutes?: number;
  readonly alerts?: readonly WeatherAlert[];
  readonly tripAlerts?: readonly WeatherAlert[];
  readonly tripWindowScoped?: boolean;
  readonly primaryAlert?: WeatherAlert;
  readonly maxPrecipChance?: number;
  readonly maxWindMph?: number;
}

export interface TrafficData {
  readonly display: string;
  readonly observedAt?: string;
  readonly validUntil?: string;
  readonly freshnessLabel?: "Fresh" | "Stale";
  readonly delayBand?: { readonly minMinutes: number; readonly maxMinutes: number } | null;
}

export interface OfflineRouteData {
  readonly display: string;
  readonly graphVersion?: string;
}

export interface ElevationData {
  readonly display: string;
  readonly observedAt?: string;
}

export interface WeatherProvider {
  readonly id: string;
  readonly kind: "weather";
  capabilities(): ProviderCapability;
  getWeather(context: RoutePreparationContext): ProviderResult<WeatherData>;
  /** Optional asynchronous hydration hook for providers backed by a transport. */
  readonly refresh?: (context: RoutePreparationContext) => Promise<ProviderResult<WeatherData>>;
}

export interface TrafficProvider {
  readonly id: string;
  readonly kind: "traffic";
  capabilities(): ProviderCapability;
  getTraffic(context: RoutePreparationContext): ProviderResult<TrafficData>;
  readonly refresh?: (context: RoutePreparationContext) => Promise<ProviderResult<TrafficData>>;
}

export interface OfflineRouteProvider {
  readonly id: string;
  readonly kind: "offline-route";
  capabilities(): ProviderCapability;
  getOfflineRoute(context: RoutePreparationContext): ProviderResult<OfflineRouteData>;
}

export interface ElevationProvider {
  readonly id: string;
  readonly kind: "elevation";
  capabilities(): ProviderCapability;
  getElevation(context: RoutePreparationContext): ProviderResult<ElevationData>;
}

export type PreparationProvider =
  | WeatherProvider
  | TrafficProvider
  | OfflineRouteProvider
  | ElevationProvider;

export interface PreparationProviderRegistry {
  readonly weather?: WeatherProvider;
  readonly traffic?: TrafficProvider;
  readonly offlineRoute?: OfflineRouteProvider;
  readonly elevation?: ElevationProvider;
  /**
   * Nearby places for "Stops along your ride" (OGV-D-274). Provider data for the
   * briefing only: it never feeds readiness, scoring or the ride document.
   */
  readonly places?: PlacesSource;
  /** The rider's map layers (phase 8): stops, traffic, alerts, roads, land. */
  readonly mapLayers?: MapLayersSource;
  /**
   * Elevations along the chosen line, for the route's elevation profile (UX
   * rework phase 3). Provider data for the result panel only: it never feeds
   * readiness, scoring or the ride document.
   */
  readonly elevationProfile?: ElevationSource;
  /** Wire-shaped alias accepted at the application boundary. */
  readonly ["offline-route"]?: OfflineRouteProvider;
}

export type RegisteredPreparationProviders =
  | PreparationProviderRegistry
  | readonly PreparationProvider[];

const CAPABILITY_ORDER: readonly ProviderKind[] = [
  "offline-route",
  "weather",
  "traffic",
  "elevation",
];

const ABSENT_REASONS: Readonly<Record<ProviderKind, string>> = {
  "offline-route": "Offline route capability is not available yet.",
  weather: "Weather data is not available yet.",
  traffic: "Traffic data is not available yet.",
  elevation: "Elevation data is not available yet.",
};

/**
 * What the route briefing says when there is no source for a check.
 *
 * "Capability probe" named the app's own mechanism, which is not something a
 * rider can act on (defect, owner review 2026-09-21). The honest statement is
 * that nothing was consulted, so nothing is claimed.
 */
export const ABSENT_PROVENANCE = "Nothing consulted";

function unavailableCapability(kind: ProviderKind): ProviderCapability {
  return {
    kind,
    availability: "unavailable",
    freshness: "none",
    reason: ABSENT_REASONS[kind],
    provenance: ABSENT_PROVENANCE,
  };
}

/** Return a stable kind-indexed view of either supported registry form. */
export function providersByKind(
  registered: RegisteredPreparationProviders,
): Readonly<Partial<Record<ProviderKind, PreparationProvider>>> {
  if (Array.isArray(registered)) {
    const result: Partial<Record<ProviderKind, PreparationProvider>> = {};
    for (const provider of registered as readonly PreparationProvider[]) {
      result[provider.kind] = provider;
    }
    return result;
  }
  const registry = registered as PreparationProviderRegistry;
  return {
    weather: registry.weather,
    traffic: registry.traffic,
    "offline-route": registry.offlineRoute ?? registry["offline-route"],
    elevation: registry.elevation,
  };
}

/**
 * Declares every known optional slot. An omitted provider is an unavailable
 * capability, never an available capability with a zero/clear value.
 */
export function probeCapabilities(
  registered: RegisteredPreparationProviders = [],
): readonly ProviderCapability[] {
  const byKind = providersByKind(registered);
  return CAPABILITY_ORDER.map((kind) => {
    const provider = byKind[kind];
    if (provider === undefined) return unavailableCapability(kind);
    const declared = provider.capabilities();
    if (declared.kind !== kind) return unavailableCapability(kind);
    return declared;
  });
}

function unavailableResult<TData extends { readonly display: string }>(
  reason: string,
  provenance = ABSENT_PROVENANCE,
): ProviderResult<TData> {
  return { state: "unavailable", reason, provenance };
}

const nullWeatherCapability = (): ProviderCapability => ({
  kind: "weather",
  availability: "unavailable",
  freshness: "none",
  reason: ABSENT_REASONS.weather,
  provenance: ABSENT_PROVENANCE,
});

const nullTrafficCapability = (): ProviderCapability => ({
  kind: "traffic",
  availability: "unavailable",
  freshness: "none",
  reason: ABSENT_REASONS.traffic,
  provenance: ABSENT_PROVENANCE,
});

const nullOfflineRouteCapability = (): ProviderCapability => ({
  kind: "offline-route",
  availability: "unavailable",
  freshness: "none",
  reason: ABSENT_REASONS["offline-route"],
  provenance: ABSENT_PROVENANCE,
});

const nullElevationCapability = (): ProviderCapability => ({
  kind: "elevation",
  availability: "unavailable",
  freshness: "none",
  reason: ABSENT_REASONS.elevation,
  provenance: ABSENT_PROVENANCE,
});

/** Null ports make absence explicit while keeping later adapters swappable. */
export const nullWeatherProvider: WeatherProvider = {
  id: "weather-null",
  kind: "weather",
  capabilities: nullWeatherCapability,
  getWeather: () => unavailableResult(ABSENT_REASONS.weather),
};

export const nullTrafficProvider: TrafficProvider = {
  id: "traffic-null",
  kind: "traffic",
  capabilities: nullTrafficCapability,
  getTraffic: () => unavailableResult(ABSENT_REASONS.traffic),
};

export const nullOfflineRouteProvider: OfflineRouteProvider = {
  id: "offline-route-null",
  kind: "offline-route",
  capabilities: nullOfflineRouteCapability,
  getOfflineRoute: () => unavailableResult(ABSENT_REASONS["offline-route"]),
};

export const nullElevationProvider: ElevationProvider = {
  id: "elevation-null",
  kind: "elevation",
  capabilities: nullElevationCapability,
  getElevation: () => unavailableResult(ABSENT_REASONS.elevation),
};

export { ABSENT_REASONS as PREPARATION_PROVIDER_ABSENCE_REASONS };
