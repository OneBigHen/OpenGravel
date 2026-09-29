import type { Coordinate } from "@/domain/ride/types";

/** Traffic severity derived from the provider's speed and travel-time fields. */
export type TrafficSpeedClass =
  | "free-flow"
  | "slow"
  | "congested"
  | "closed"
  | "unknown";

export type TrafficAvailability = "available" | "unavailable";
export type TrafficFreshnessStatus = "fresh" | "stale" | "unknown";
export type TrafficDepartureApplicability =
  | "current"
  | "future-unavailable"
  | "past-unavailable"
  | "unknown";

/** The provider-neutral request. Coordinates remain WGS84 `{ lon, lat }`. */
export interface TrafficRequest {
  readonly corridor: readonly Coordinate[];
  /** Optional bounded query points; the adapter samples the corridor otherwise. */
  readonly waypoints?: readonly Coordinate[];
  /** ISO-8601 departure used to decide whether current data is applicable. */
  readonly departureTime: string;
  readonly signal?: AbortSignal;
}

/** One provider segment after the documented response is normalized. */
export interface TrafficSegment {
  readonly id: string;
  readonly geometry: readonly Coordinate[];
  readonly speedClass: TrafficSpeedClass;
  readonly delaySeconds: number | null;
  /** The unit requested from the provider; TomTom is configured for mph. */
  readonly currentSpeed: number | null;
  readonly freeFlowSpeed: number | null;
  readonly confidence: number | null;
  readonly roadClosure: boolean | null;
  /** Fetch time is used when the provider has no observation timestamp. */
  readonly observedAt: string;
}

export interface TrafficFreshness {
  readonly status: TrafficFreshnessStatus;
  readonly fetchedAt: string | null;
  readonly validUntil: string | null;
  readonly departureTime: string;
}

/** A truthful answer: unavailable has no segments and is never a clear answer. */
export interface TrafficResponse {
  readonly availability: TrafficAvailability;
  readonly segments: readonly TrafficSegment[];
  readonly freshness: TrafficFreshness;
  readonly departureApplicability: TrafficDepartureApplicability;
  readonly reason: string | null;
  readonly provenance: string;
  /** Rider-facing status; unavailable adapters must use `Traffic unknown`. */
  readonly label: string;
}

/** The narrow application-facing traffic provider boundary. */
export interface TrafficProvider {
  readonly id: string;
  getTraffic(request: TrafficRequest): Promise<TrafficResponse>;
}
