/**
 * Bounded telemetry vocabularies (Task 11.4; 13-OBSERVABILITY §4).
 *
 * Every property the privacy event model carries is an enumeration member or a
 * coarse band label. There is deliberately no slot here for a coordinate, a raw
 * object id, a filename, a free-text message or a precise metric scalar — if a
 * concept has no bounded vocabulary yet, it stays out of telemetry instead of
 * leaking as raw data (11-OFFLINE-IDENTITY-SHARING-PRIVACY §14–§15).
 *
 * Domain-backed vocabularies mirror the typed command vocabulary
 * (VNX-003/OGV-INT-001): they may only contain values the domain already
 * accepts, and the unit tests pin them to the complete domain set.
 */

import type {
  CommandSource,
  RoadCharacterIntent,
  SurfaceIntent,
} from "@/domain/ride/types";
import type { RouteRole } from "@/domain/route/types";

/** Planning mode (04-USER-EXPERIENCE-CONTRACT §6): To, Loop, Free Ride. */
export const TELEMETRY_ROUTE_MODES = ["to", "loop", "free-ride"] as const;
export type TelemetryRouteMode = (typeof TELEMETRY_ROUTE_MODES)[number];

/** The typed command source vocabulary (03-DOMAIN-CONTRACT §28). */
export const TELEMETRY_SOURCES = [
  "rider",
  "map",
  "drawing",
  "import",
  "advisor",
  "settings",
  "recovery",
  "system-location",
] as const satisfies readonly CommandSource[];
export type TelemetrySource = (typeof TELEMETRY_SOURCES)[number];

/** `RoadCharacterIntent` — the requested road character. */
export const TELEMETRY_ROAD_CHARACTERS = [
  "efficient",
  "balanced",
  "curvy",
  "backroads",
] as const satisfies readonly RoadCharacterIntent[];
export type TelemetryRoadCharacter =
  (typeof TELEMETRY_ROAD_CHARACTERS)[number];

/** `SurfaceIntent["preference"]` — the requested surface policy. */
export const TELEMETRY_SURFACE_POLICIES = [
  "pavement",
  "mostly-pavement",
  "mixed",
  "dirt-preferred",
] as const satisfies readonly SurfaceIntent["preference"][];
export type TelemetrySurfacePolicy =
  (typeof TELEMETRY_SURFACE_POLICIES)[number];

/** `RouteRole` — a role label, never a route id (13 §4). */
export const TELEMETRY_ROUTE_ROLES = [
  "best-ride",
  "fastest",
  "fast-and-fun",
  "more-twisties",
  "more-dirt",
  "lower-workload",
] as const satisfies readonly RouteRole[];
export type TelemetryRouteRole = (typeof TELEMETRY_ROUTE_ROLES)[number];

/** Alternative count band — counts are banded, never exact (13 §4). */
export const TELEMETRY_CANDIDATE_COUNT_BANDS = [
  "0",
  "1-2",
  "3-5",
  "6-plus",
] as const;
export type TelemetryCandidateCountBand =
  (typeof TELEMETRY_CANDIDATE_COUNT_BANDS)[number];

/**
 * Provider capability context (13 §2, §4): which capability families the
 * deployment can reach. Capability families only — never a vendor name
 * (VNX-007).
 */
export const TELEMETRY_PROVIDER_SETS = [
  "core-only",
  "core-with-traffic",
  "core-with-weather",
  "core-with-traffic-and-weather",
] as const;
export type TelemetryProviderSet = (typeof TELEMETRY_PROVIDER_SETS)[number];

/**
 * Error classes (13 §4): a bounded taxonomy drawn from the stable error
 * vocabularies (ImportFlowErrorCode, ADVISOR_ERROR_CLASSES, RideSessionError).
 * Telemetry records the class, never an error message (11 §14).
 */
export const TELEMETRY_ERROR_CLASSES = [
  "invalid-input",
  "no-result",
  "timeout",
  "rate-limit",
  "unavailable",
  "stale-revision",
  "cancelled",
  "read-failed",
  "write-failed",
  "guard-rejected",
] as const;
export type TelemetryErrorClass = (typeof TELEMETRY_ERROR_CLASSES)[number];

/** Capability status band (02-ARCHITECTURE-CONTRACT §12 capability model). */
export const TELEMETRY_CAPABILITY_STATUSES = [
  "available",
  "degraded",
  "requires-network",
  "unavailable",
] as const;
export type TelemetryCapabilityStatus =
  (typeof TELEMETRY_CAPABILITY_STATUSES)[number];

/**
 * The six workflow spans of 13 §5. Span timing is recorded as a band against
 * one of these names — never as a per-action timer profile of the rider
 * (13 §14).
 */
export const TELEMETRY_WORKFLOWS = [
  "app-open-to-planner-usable",
  "plan-click-to-first-route",
  "first-route-to-alternatives-settled",
  "planner-to-navigation-start",
  "import-start-to-usable-route",
  "advisor-request-to-proposal",
] as const;
export type TelemetryWorkflowName = (typeof TELEMETRY_WORKFLOWS)[number];

/** Duration bands (13 §4). */
export const TELEMETRY_DURATION_BANDS = [
  "under-1s",
  "1-10s",
  "10-60s",
  "1-10min",
  "10-60min",
  "1-3h",
  "over-3h",
] as const;
export type TelemetryDurationBand = (typeof TELEMETRY_DURATION_BANDS)[number];

/** Distance bands (13 §4). */
export const TELEMETRY_DISTANCE_BANDS = [
  "under-10km",
  "10-50km",
  "50-150km",
  "150-300km",
  "over-300km",
] as const;
export type TelemetryDistanceBand = (typeof TELEMETRY_DISTANCE_BANDS)[number];

/** Latency bands (13 §4). */
export const TELEMETRY_LATENCY_BANDS = [
  "under-500ms",
  "500ms-2s",
  "2-10s",
  "10-30s",
  "over-30s",
] as const;
export type TelemetryLatencyBand = (typeof TELEMETRY_LATENCY_BANDS)[number];

/**
 * Bands a duration. A value that is not a measurement returns `null` —
 * "unknown stays unknown" and is omitted instead of coerced into a band.
 */
export function durationBand(ms: number): TelemetryDurationBand | null {
  if (!Number.isFinite(ms) || ms < 0) return null;
  if (ms < 1_000) return "under-1s";
  if (ms < 10_000) return "1-10s";
  if (ms < 60_000) return "10-60s";
  if (ms < 600_000) return "1-10min";
  if (ms < 3_600_000) return "10-60min";
  if (ms < 10_800_000) return "1-3h";
  return "over-3h";
}

/**
 * Bands a distance in meters. Non-measurements return `null` (unknown stays
 * unknown).
 */
export function distanceBand(meters: number): TelemetryDistanceBand | null {
  if (!Number.isFinite(meters) || meters < 0) return null;
  if (meters < 10_000) return "under-10km";
  if (meters < 50_000) return "10-50km";
  if (meters < 150_000) return "50-150km";
  if (meters < 300_000) return "150-300km";
  return "over-300km";
}

/**
 * Bands a latency in milliseconds. Non-measurements return `null` (unknown
 * stays unknown).
 */
export function latencyBand(ms: number): TelemetryLatencyBand | null {
  if (!Number.isFinite(ms) || ms < 0) return null;
  if (ms < 500) return "under-500ms";
  if (ms < 2_000) return "500ms-2s";
  if (ms < 10_000) return "2-10s";
  if (ms < 30_000) return "10-30s";
  return "over-30s";
}
