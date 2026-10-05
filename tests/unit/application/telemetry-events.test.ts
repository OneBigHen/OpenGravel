import { describe, expect, it } from "vitest";

import {
  TELEMETRY_EVENT_NAMES,
  TELEMETRY_EVENT_PROPERTY_KEYS,
  TELEMETRY_PROPERTY_ENUMS,
  sanitizeTelemetryProperties,
  type TelemetryEventName,
} from "@/application/telemetry/events";
import {
  distanceBand,
  durationBand,
  latencyBand,
} from "@/application/telemetry/vocabulary";

/**
 * The typed event boundary (Task 11.4, 13-OBSERVABILITY §3–§5,
 * 11-OFFLINE-IDENTITY-SHARING-PRIVACY §14–§15).
 *
 * What is tested here is the allowlist itself: the exact semantic event set,
 * the exact bounded property vocabularies, and the exact per-event property
 * keys. The sanitizer is the runtime half of the same allowlist — a cast may
 * silence TypeScript, but it can never widen what reaches a transport.
 */

const EXPECTED_EVENT_NAMES = [
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
  "import_completed",
  "draw_started",
  "draw_completed",
  "draw_failed",
  "road_span_constraint_added",
  "avoid_area_added",
  "advisor_proposal_requested",
  "advisor_proposal_ready",
  "advisor_proposal_applied",
  "advisor_proposal_discarded",
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
  "workflow_span_recorded",
] as const;

/**
 * The bounded vocabulary table (13 §4). Every value is an enumeration member or
 * a band label — there is deliberately no slot for a coordinate, a raw id, a
 * filename, a free-text message or a metric scalar.
 */
const EXPECTED_PROPERTY_ENUMS = {
  routeMode: ["to", "loop", "free-ride"],
  source: [
    "rider",
    "map",
    "drawing",
    "import",
    "advisor",
    "settings",
    "recovery",
    "system-location",
  ],
  roadCharacter: ["efficient", "balanced", "curvy", "backroads"],
  surfacePolicy: ["pavement", "mostly-pavement", "mixed", "dirt-preferred"],
  candidateCount: ["0", "1-2", "3-5", "6-plus"],
  providerSet: [
    "core-only",
    "core-with-traffic",
    "core-with-weather",
    "core-with-traffic-and-weather",
  ],
  durationBand: [
    "under-1s",
    "1-10s",
    "10-60s",
    "1-10min",
    "10-60min",
    "1-3h",
    "over-3h",
  ],
  distanceBand: ["under-10km", "10-50km", "50-150km", "150-300km", "over-300km"],
  latencyBand: ["under-500ms", "500ms-2s", "2-10s", "10-30s", "over-30s"],
  selectedRole: [
    "best-ride",
    "fastest",
    "fast-and-fun",
    "more-twisties",
    "more-dirt",
    "lower-workload",
  ],
  errorClass: [
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
  ],
  capabilityStatus: ["available", "degraded", "requires-network", "unavailable"],
  workflow: [
    "app-open-to-planner-usable",
    "plan-click-to-first-route",
    "first-route-to-alternatives-settled",
    "planner-to-navigation-start",
    "import-start-to-usable-route",
    "advisor-request-to-proposal",
  ],
};

const EXPECTED_EVENT_KEYS: Record<string, readonly string[]> = {
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
  import_completed: ["source"],
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
};

/**
 * Strictly excluded payloads (11 §14–§15): geometry, PII, raw identifiers,
 * secrets and imported filenames must survive no event name, ever.
 */
const FORBIDDEN_PROBES: Readonly<Record<string, unknown>> = {
  coordinates: [[-75.3, 40.1]],
  routeGeometry: [{ lat: 40.1, lon: -75.3 }],
  rideId: "ride_01234567-89ab-cdef-0123-456789abcdef",
  recordingId: "rec_01234567-89ab-cdef-0123-456789abcdef",
  shareToken: "tok_9f8e7d6c5b4a",
  filename: "sunday-therapy-ride.gpx",
  password: "hunter2",
  token: "sk-secret-value",
  note: "free text, 42 Walnut St",
};

describe("the semantic event allowlist (13 §3)", () => {
  it("is exactly the §3 semantic set plus the workflow-span record", () => {
    expect([...TELEMETRY_EVENT_NAMES]).toEqual([...EXPECTED_EVENT_NAMES]);
  });

  it("pins one property-key set per event (13 §4 'where relevant')", () => {
    const actual = Object.fromEntries(
      Object.entries(TELEMETRY_EVENT_PROPERTY_KEYS).map(([name, keys]) => [
        name,
        [...keys],
      ]),
    );
    expect(actual).toEqual(EXPECTED_EVENT_KEYS);
  });
});

describe("the bounded property vocabularies (13 §4)", () => {
  it("is exactly the bounded enumeration/band table", () => {
    const actual = Object.fromEntries(
      Object.entries(TELEMETRY_PROPERTY_ENUMS).map(([key, values]) => [
        key,
        [...values],
      ]),
    );
    expect(actual).toEqual(EXPECTED_PROPERTY_ENUMS);
  });
});

describe("sanitizeTelemetryProperties — the runtime half of the allowlist", () => {
  it("keeps valid allowlisted values for the event", () => {
    const properties = {
      routeMode: "to",
      source: "rider",
      roadCharacter: "curvy",
      surfacePolicy: "mixed",
      providerSet: "core-only",
    };
    expect(
      sanitizeTelemetryProperties("route_plan_requested", properties),
    ).toEqual(properties);
  });

  it("drops a property the event does not allow", () => {
    expect(
      sanitizeTelemetryProperties("planner_opened", { source: "rider" }),
    ).toEqual({});
  });

  it("drops unknown keys instead of forwarding them", () => {
    expect(
      sanitizeTelemetryProperties("ride_saved", {
        rideId: "ride_x",
        title: "therapy loop",
        anythingElse: 42,
      }),
    ).toEqual({});
  });

  it("drops non-string values even under an allowed key (no geometry, no scalars)", () => {
    expect(
      sanitizeTelemetryProperties("route_alternatives_ready", {
        candidateCount: 4,
      }),
    ).toEqual({});
    expect(
      sanitizeTelemetryProperties("route_alternatives_ready", {
        candidateCount: ["3-5"],
      }),
    ).toEqual({});
    expect(
      sanitizeTelemetryProperties("ride_completed", {
        distanceBand: { min: 10, max: 50 },
      }),
    ).toEqual({});
  });

  it("drops out-of-vocabulary values — unknown stays unknown", () => {
    expect(
      sanitizeTelemetryProperties("route_plan_requested", {
        source: "assistant",
        routeMode: "warp",
      }),
    ).toEqual({});
  });

  it("fails closed for an unknown event name", () => {
    expect(
      sanitizeTelemetryProperties("bogus_event" as TelemetryEventName, {
        source: "rider",
      }),
    ).toEqual({});
  });

  it("fails closed for a non-object payload", () => {
    expect(sanitizeTelemetryProperties("ride_saved", null)).toEqual({});
    expect(sanitizeTelemetryProperties("ride_saved", "ride_saved")).toEqual({});
  });

  it("lets no strictly excluded payload survive any event (11 §14–§15)", () => {
    for (const name of TELEMETRY_EVENT_NAMES) {
      expect(sanitizeTelemetryProperties(name, FORBIDDEN_PROBES)).toEqual({});
    }
  });
});

describe("band functions (13 §4)", () => {
  it("bands durations and refuses non-measurements", () => {
    expect(durationBand(0)).toBe("under-1s");
    expect(durationBand(999)).toBe("under-1s");
    expect(durationBand(1_000)).toBe("1-10s");
    expect(durationBand(59_999)).toBe("10-60s");
    expect(durationBand(60_000)).toBe("1-10min");
    expect(durationBand(600_000)).toBe("10-60min");
    expect(durationBand(3_600_000)).toBe("1-3h");
    expect(durationBand(10_800_000)).toBe("over-3h");
    expect(durationBand(-5)).toBeNull();
    expect(durationBand(Number.NaN)).toBeNull();
    expect(durationBand(Number.POSITIVE_INFINITY)).toBeNull();
  });

  it("bands distances and refuses non-measurements", () => {
    expect(distanceBand(0)).toBe("under-10km");
    expect(distanceBand(10_000)).toBe("10-50km");
    expect(distanceBand(50_000)).toBe("50-150km");
    expect(distanceBand(150_000)).toBe("150-300km");
    expect(distanceBand(300_000)).toBe("over-300km");
    expect(distanceBand(Number.NaN)).toBeNull();
  });

  it("bands latencies and refuses non-measurements", () => {
    expect(latencyBand(0)).toBe("under-500ms");
    expect(latencyBand(500)).toBe("500ms-2s");
    expect(latencyBand(2_000)).toBe("2-10s");
    expect(latencyBand(10_000)).toBe("10-30s");
    expect(latencyBand(30_000)).toBe("over-30s");
    expect(latencyBand(-1)).toBeNull();
    expect(latencyBand(Number.NaN)).toBeNull();
  });
});
