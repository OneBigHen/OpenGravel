/**
 * The typed event boundary (Task 11.4; 13-OBSERVABILITY §3–§4;
 * 11-OFFLINE-IDENTITY-SHARING-PRIVACY §14–§15).
 *
 * This module is the privacy event model: one allowlist of semantic events,
 * one allowlist of property keys per event, and one bounded vocabulary per
 * property. `sanitizeTelemetryProperties` enforces the same table at runtime,
 * so a cast can silence TypeScript but can never widen what reaches a
 * transport. Anything outside the table — geometry, PII, raw identifiers,
 * secrets, filenames, free text, scalar metrics — is dropped before sending.
 */

import {
  TELEMETRY_CANDIDATE_COUNT_BANDS,
  TELEMETRY_CAPABILITY_STATUSES,
  TELEMETRY_DISTANCE_BANDS,
  TELEMETRY_DURATION_BANDS,
  TELEMETRY_ERROR_CLASSES,
  TELEMETRY_LATENCY_BANDS,
  TELEMETRY_PROVIDER_SETS,
  TELEMETRY_ROAD_CHARACTERS,
  TELEMETRY_ROUTE_MODES,
  TELEMETRY_ROUTE_ROLES,
  TELEMETRY_SOURCES,
  TELEMETRY_SURFACE_POLICIES,
  TELEMETRY_WORKFLOWS,
  type TelemetryCandidateCountBand,
  type TelemetryCapabilityStatus,
  type TelemetryDistanceBand,
  type TelemetryDurationBand,
  type TelemetryErrorClass,
  type TelemetryLatencyBand,
  type TelemetryProviderSet,
  type TelemetryRoadCharacter,
  type TelemetryRouteMode,
  type TelemetryRouteRole,
  type TelemetrySource,
  type TelemetrySurfacePolicy,
  type TelemetryWorkflowName,
} from "@/application/telemetry/vocabulary";

/**
 * The semantic event set (13 §3): the concrete events behind the fixed
 * `workflow_*`, `advisor_*`, `ride_*`, `reroute_*` and
 * `free_ride_suggestion_*` families. Event names describe product workflows,
 * never provider integration points (VNX-007).
 */
export const TELEMETRY_EVENT_NAMES = [
  // planner lifecycle
  "planner_opened",
  "ride_intent_changed",
  "route_plan_requested",
  "route_primary_ready",
  "route_alternatives_ready",
  "route_plan_failed",
  "route_selected",
  "route_edit_committed",
  "route_edit_undone",
  "prepare_opened",
  "ride_saved",
  "export_completed",
  // map interaction and drawing
  "draw_started",
  "draw_completed",
  "draw_failed",
  "road_span_constraint_added",
  "avoid_area_added",
  // advisor
  "advisor_proposal_requested",
  "advisor_proposal_ready",
  "advisor_proposal_applied",
  "advisor_proposal_discarded",
  // ride lifecycle and navigation
  "ride_started",
  "ride_resumed",
  "off_route",
  "reroute_requested",
  "reroute_ready",
  "reroute_failed",
  "free_ride_suggestion_offered",
  "free_ride_suggestion_accepted",
  "free_ride_suggestion_declined",
  "ride_completed",
  // workflow spans (13 §5)
  "workflow_span_recorded",
] as const;

export type TelemetryEventName = (typeof TELEMETRY_EVENT_NAMES)[number];

/** The bounded value type of every telemetry property (13 §4). */
export type TelemetryPropertyValueMap = {
  routeMode: TelemetryRouteMode;
  source: TelemetrySource;
  roadCharacter: TelemetryRoadCharacter;
  surfacePolicy: TelemetrySurfacePolicy;
  candidateCount: TelemetryCandidateCountBand;
  providerSet: TelemetryProviderSet;
  durationBand: TelemetryDurationBand;
  distanceBand: TelemetryDistanceBand;
  latencyBand: TelemetryLatencyBand;
  selectedRole: TelemetryRouteRole;
  errorClass: TelemetryErrorClass;
  capabilityStatus: TelemetryCapabilityStatus;
  workflow: TelemetryWorkflowName;
};

export type TelemetryPropertyKey = keyof TelemetryPropertyValueMap;

/**
 * The single runtime source for the bounded vocabulary of each property.
 * Value types above derive from the same arrays, so the type and the runtime
 * validator cannot drift apart.
 */
export const TELEMETRY_PROPERTY_ENUMS = {
  routeMode: TELEMETRY_ROUTE_MODES,
  source: TELEMETRY_SOURCES,
  roadCharacter: TELEMETRY_ROAD_CHARACTERS,
  surfacePolicy: TELEMETRY_SURFACE_POLICIES,
  candidateCount: TELEMETRY_CANDIDATE_COUNT_BANDS,
  providerSet: TELEMETRY_PROVIDER_SETS,
  durationBand: TELEMETRY_DURATION_BANDS,
  distanceBand: TELEMETRY_DISTANCE_BANDS,
  latencyBand: TELEMETRY_LATENCY_BANDS,
  selectedRole: TELEMETRY_ROUTE_ROLES,
  errorClass: TELEMETRY_ERROR_CLASSES,
  capabilityStatus: TELEMETRY_CAPABILITY_STATUSES,
  workflow: TELEMETRY_WORKFLOWS,
} as const satisfies {
  readonly [K in TelemetryPropertyKey]: readonly string[];
};

/**
 * Which bounded properties each event may carry (13 §4 "where relevant").
 * An event with `[]` sends its occurrence and nothing else.
 */
export const TELEMETRY_EVENT_PROPERTY_KEYS = {
  planner_opened: [],
  ride_intent_changed: ["source"],
  route_plan_requested: [
    "routeMode",
    "source",
    "roadCharacter",
    "surfacePolicy",
    "providerSet",
  ],
  route_primary_ready: [
    "routeMode",
    "latencyBand",
    "distanceBand",
    "durationBand",
  ],
  route_alternatives_ready: ["routeMode", "candidateCount", "latencyBand"],
  route_plan_failed: ["routeMode", "errorClass"],
  route_selected: ["selectedRole", "source"],
  route_edit_committed: ["source"],
  route_edit_undone: ["source"],
  prepare_opened: [],
  ride_saved: [],
  export_completed: ["distanceBand", "durationBand"],
  draw_started: ["source"],
  draw_completed: ["source", "durationBand"],
  draw_failed: ["source", "errorClass"],
  road_span_constraint_added: ["source"],
  avoid_area_added: ["source"],
  advisor_proposal_requested: ["capabilityStatus"],
  advisor_proposal_ready: ["capabilityStatus", "latencyBand"],
  advisor_proposal_applied: ["source"],
  advisor_proposal_discarded: [],
  ride_started: ["routeMode", "source"],
  ride_resumed: ["routeMode"],
  off_route: ["routeMode"],
  reroute_requested: [],
  reroute_ready: ["latencyBand"],
  reroute_failed: ["errorClass"],
  free_ride_suggestion_offered: [],
  free_ride_suggestion_accepted: ["source"],
  free_ride_suggestion_declined: [],
  ride_completed: ["routeMode", "distanceBand", "durationBand"],
  workflow_span_recorded: ["workflow", "durationBand"],
} as const satisfies {
  readonly [E in TelemetryEventName]: readonly TelemetryPropertyKey[];
};

/** The compile-time property contract of one event. */
export type TelemetryEventProperties<E extends TelemetryEventName> = {
  readonly [K in (typeof TELEMETRY_EVENT_PROPERTY_KEYS)[E][number]]?: TelemetryPropertyValueMap[K];
};

/** The only property shape that ever reaches a transport. */
export type SanitizedTelemetryProperties = Readonly<Record<string, string>>;

/**
 * Build correlation (13 §6): the application version, the build id and
 * optional policy/graph version bands — carried with every event, never mixed
 * into the property allowlist.
 */
export interface TelemetryBuildCorrelation {
  readonly appVersion: string;
  readonly buildId: string;
  readonly routePolicyVersion?: string | undefined;
  readonly graphVersionBand?: string | undefined;
}

/** One privacy-safe record handed to a transport. */
export interface TelemetryEnvelope {
  readonly name: TelemetryEventName;
  readonly properties: SanitizedTelemetryProperties;
  readonly build: TelemetryBuildCorrelation;
}

/**
 * Enforces the allowlist at runtime. Drops everything the typed boundary
 * cannot prove: unknown event names (fail closed), unknown keys, values
 * outside the bounded vocabulary ("unknown stays unknown" — never coerced),
 * and every non-string payload under an allowed key.
 */
export function sanitizeTelemetryProperties(
  name: TelemetryEventName,
  properties: unknown,
): SanitizedTelemetryProperties {
  const allowedKeys =
    (
      TELEMETRY_EVENT_PROPERTY_KEYS as Partial<
        Record<string, readonly TelemetryPropertyKey[]>
      >
    )[name] ?? [];
  if (typeof properties !== "object" || properties === null) {
    return Object.freeze({});
  }
  const source = properties as Partial<Record<string, unknown>>;
  const sanitized: Record<string, string> = {};
  for (const key of allowedKeys) {
    const value = source[key];
    if (typeof value !== "string") continue;
    const vocabulary: readonly string[] = TELEMETRY_PROPERTY_ENUMS[key];
    if (!vocabulary.includes(value)) continue;
    sanitized[key] = value;
  }
  return Object.freeze(sanitized);
}
