/**
 * Shared preparation value semantics (Wave 7.1).
 *
 * Preparation deliberately has fewer states than a provider capability. A
 * provider either supplied usable data, supplied data that needs refresh, or
 * did not supply data. `unavailable` never means clear or ready.
 */

export type PreparationState = "ready" | "stale" | "unavailable";

export type PreparationRelevance = "always" | "conditional";

export type PreparationItemKind =
  | "weather"
  | "traffic"
  | "fuel"
  | "daylight"
  | "offline-route"
  | "lodging"
  | "service"
  | "elevation"
  | "route-character"
  | "surface"
  | "warnings";

/** The provider-free data shape the preparation renderer can display. */
export interface PreparationDisplayData {
  readonly display: string;
  readonly [key: string]: unknown;
}

export type PreparationData = PreparationDisplayData | string | number;

export interface RoutePreparationItem<TData extends PreparationData = PreparationData> {
  readonly kind: PreparationItemKind;
  readonly state: PreparationState;
  readonly relevance: PreparationRelevance;
  /** The decision-facing explanation, including why a value is absent. */
  readonly reason: string;
  /** Human-readable source line; this is not evidence when the state is absent. */
  readonly provenance: string;
  readonly data?: TData;
}

export interface TimeWindow {
  readonly start: string;
  readonly end: string;
}

export interface TripWindow {
  readonly start: string;
  readonly end?: string;
}
