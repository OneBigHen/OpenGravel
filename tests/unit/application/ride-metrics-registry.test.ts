/**
 * The metric registry and the strip model (RIDE-INSTRUMENT-STRIP §3, §4, §4.1,
 * §2.2, §2.3, §17.2).
 *
 * Every live metric is checked for units, the four states, zero versus
 * unavailable, expiry, its spoken form and mode support; the strip model for
 * mode choice, per-mode substitution, the moving lock and slot changes.
 */

import { describe, expect, it } from "vitest";

import {
  METRIC_FRESHNESS,
  NO_VALUE,
  RIDE_METRIC_IDS,
  RIDE_METRIC_REGISTRY,
  defaultMetricSlots,
  metricAvailable,
  metricChoices,
  presetsFor,
  resolveRideMetric,
  type RideMetricContext,
  type RideMetricId,
} from "@/application/ride-metrics/registry";
import {
  buildRideMetricStrip,
  rideMetricMode,
  shownMetricIds,
  storedAfterChoice,
} from "@/application/ride-metrics/strip";
import { createRiderSettings, withMetricSlots } from "@/application/ride-metrics/rider-settings";
import type { NavigationPosition, SessionNavigationState } from "@/domain/ride-session/navigation";
import { asRecordingId } from "@/domain/recording/ids";
import { newRideSessionId } from "@/domain/ride-session/ids";
import { newRideId } from "@/domain/ride/ids";
import { asRouteCandidateId } from "@/domain/route/ids";
import { EMPTY_RECORDING_TELEMETRY, type RecordingTelemetry } from "@/domain/recording/telemetry";

const NOW_MS = Date.parse("2026-09-21T14:00:00.000Z");
const ROUTE = { planningGeneration: 3, routeId: asRouteCandidateId("route_best") };

function context(overrides: Partial<RideMetricContext> = {}): RideMetricContext {
  return {
    mode: "guided",
    units: "imperial",
    nowMs: NOW_MS,
    position: {
      quality: "fresh-good",
      speedMps: 21,
      headingDegrees: 212,
      accuracyMeters: 5,
      observedAtMs: NOW_MS - 1_000,
    },
    route: {
      answer: {
        routeProgress: 0.42,
        remainingDistanceMeters: 29_290,
        remainingDurationSeconds: 1_560,
        etaIso: "2026-09-21T14:26:00.000Z",
        speedLimitKmh: 72.4,
      },
    },
    recording: { summary: { distanceMeters: 16_093, elapsedSeconds: 3_900, movingSeconds: 3_725, pointCount: 400 } },
    ...overrides,
  };
}

function read(id: RideMetricId, overrides: Partial<RideMetricContext> = {}) {
  return resolveRideMetric(id, context(overrides));
}

describe("the registry", () => {
  it("defines every canonical ID exactly once", () => {
    for (const id of RIDE_METRIC_IDS) expect(RIDE_METRIC_REGISTRY[id].id).toBe(id);
    expect(Object.keys(RIDE_METRIC_REGISTRY)).toHaveLength(RIDE_METRIC_IDS.length);
  });

  it("builds only already-credible metrics through slice B (no Smart, route-ahead, grade or motion)", () => {
    const live = RIDE_METRIC_IDS.filter((id) => RIDE_METRIC_REGISTRY[id].availability === "live");
    expect(live.sort()).toEqual([
      "distance.recorded",
      "elevation.current",
      "elevation.gain",
      "elevation.loss",
      "gps.accuracy",
      "heading",
      "route.distanceRemaining",
      "route.eta",
      "route.progress",
      "route.speedLimit",
      "route.timeRemaining",
      "speed.average",
      "speed.current",
      "speed.max",
      "time.moving",
      "time.recorded",
      "time.sinceStop",
    ]);
  });

  it("resolves a planned metric as unsupported, shown as a dash", () => {
    for (const id of ["context.smart", "terrain.grade", "motion.lean", "road.curvesAhead"] as const) {
      const reading = read(id);
      expect(reading.state).toBe("unsupported");
      expect(reading.displayValue).toBe(NO_VALUE);
    }
  });

  it("keeps mode support in metadata: route metrics are guided only, recording metrics Record only", () => {
    expect(metricAvailable("route.eta", "guided")).toBe(true);
    expect(metricAvailable("route.eta", "free-ride")).toBe(false);
    expect(metricAvailable("time.recorded", "recording")).toBe(true);
    expect(metricAvailable("time.recorded", "free-ride")).toBe(false);
    expect(read("route.eta", { mode: "recording" }).state).toBe("unsupported");
    expect(read("distance.recorded", { mode: "guided" }).state).toBe("unsupported");
  });
});

describe("speed.current", () => {
  it("formats imperial and metric", () => {
    expect(read("speed.current")).toMatchObject({ displayValue: "47", unit: "mph", state: "ready", source: "navigation" });
    expect(read("speed.current", { units: "metric" })).toMatchObject({ displayValue: "76", unit: "km/h" });
    expect(read("speed.current").accessibleDetail).toBe("47 miles per hour");
  });

  it("shows a truthful zero", () => {
    expect(read("speed.current", { position: { ...context().position, speedMps: 0 } })).toMatchObject({
      displayValue: "0",
      state: "ready",
    });
  });

  it("waits, never zero, when there is no fix or the device reports no speed", () => {
    const noFix = read("speed.current", {
      position: { quality: "unavailable", speedMps: null, headingDegrees: null, accuracyMeters: null, observedAtMs: null },
    });
    expect(noFix).toMatchObject({ state: "waiting", displayValue: NO_VALUE });
    const noSpeed = read("speed.current", { position: { ...context().position, speedMps: null } });
    expect(noSpeed).toMatchObject({ state: "waiting", displayValue: NO_VALUE });
  });

  it("holds an ageing value as stale, then expires it to a dash", () => {
    const held = read("speed.current", { position: { ...context().position, observedAtMs: NOW_MS - 8_000 } });
    expect(held).toMatchObject({ state: "stale", displayValue: "47", quality: "low" });
    expect(held.accessibleDetail).toContain("last reading 8 seconds ago");
    expect(held.expiresAt).toBe(NOW_MS - 8_000 + METRIC_FRESHNESS.gps.expiresAfterMs);

    const expired = read("speed.current", { position: { ...context().position, observedAtMs: NOW_MS - 16_000 } });
    expect(expired).toMatchObject({ state: "stale", displayValue: NO_VALUE });
  });

  it("reports a withheld (stale-port) speed as stale, not current", () => {
    const reading = read("speed.current", {
      position: { ...context().position, quality: "stale", speedMps: null, observedAtMs: NOW_MS - 42_000 },
    });
    expect(reading).toMatchObject({ state: "stale", displayValue: NO_VALUE });
  });

  it("is supported in every mode", () => {
    for (const mode of ["guided", "recording", "free-ride"] as const) expect(read("speed.current", { mode }).state).toBe("ready");
  });
});

describe("heading and GPS accuracy", () => {
  it("reads heading as an 8-way point", () => {
    expect(read("heading")).toMatchObject({ displayValue: "SW", unit: null, rawValue: 212 });
    expect(read("heading", { position: { ...context().position, headingDegrees: null } }).state).toBe("waiting");
  });

  it("reads accuracy in feet or metres", () => {
    expect(read("gps.accuracy")).toMatchObject({ displayValue: "±16", unit: "ft", source: "navigation" });
    expect(read("gps.accuracy", { units: "metric" })).toMatchObject({ displayValue: "±5", unit: "m" });
    expect(read("gps.accuracy").accessibleDetail).toBe("plus or minus 16 feet");
  });
});

describe("guided route metrics", () => {
  it("formats distance left, with one decimal under 10", () => {
    expect(read("route.distanceRemaining")).toMatchObject({ displayValue: "18", unit: "mi" });
    const near = read("route.distanceRemaining", {
      route: { answer: { ...context().route!.answer!, remainingDistanceMeters: 2_900 } },
    });
    expect(near).toMatchObject({ displayValue: "1.8", unit: "mi" });
    expect(read("route.distanceRemaining", { units: "metric" })).toMatchObject({ displayValue: "29", unit: "km" });
  });

  it("formats time left in minutes, then hours", () => {
    expect(read("route.timeRemaining")).toMatchObject({ displayValue: "26", unit: "min" });
    const long = read("route.timeRemaining", {
      route: { answer: { ...context().route!.answer!, remainingDurationSeconds: 6_480 } },
    });
    expect(long).toMatchObject({ displayValue: "1:48", unit: "h", accessibleDetail: "1 hour 48 minutes" });
  });

  it("shows a truthful zero at the finish", () => {
    const done = read("route.distanceRemaining", {
      route: { answer: { ...context().route!.answer!, remainingDistanceMeters: 0 } },
    });
    expect(done).toMatchObject({ displayValue: "0.0", state: "ready" });
  });

  it("formats arrival as a clock time with its period", () => {
    const eta = read("route.eta");
    expect(eta.state).toBe("ready");
    expect(eta.displayValue).toMatch(/^\d{1,2}:\d{2}$/);
    expect(["AM", "PM"]).toContain(eta.unit);
  });

  it("reads progress as a clamped percentage", () => {
    expect(read("route.progress")).toMatchObject({ displayValue: "42", unit: "%" });
    const over = read("route.progress", { route: { answer: { ...context().route!.answer!, routeProgress: 1.3 } } });
    expect(over.displayValue).toBe("100");
  });

  it("reads the mapped speed limit like the sign, and waits where none is mapped", () => {
    expect(read("route.speedLimit")).toMatchObject({ displayValue: "45", unit: "mph", source: "route-evidence" });
    const unmapped = read("route.speedLimit", { route: { answer: { ...context().route!.answer!, speedLimitKmh: null } } });
    expect(unmapped).toMatchObject({ state: "waiting", displayValue: NO_VALUE });
  });

  it("waits until the engine answers, and says stale when the fix is", () => {
    expect(read("route.timeRemaining", { route: { answer: null } })).toMatchObject({ state: "waiting", displayValue: NO_VALUE });
    const stale = read("route.timeRemaining", {
      route: { answer: null },
      position: { ...context().position, quality: "stale", speedMps: null },
    });
    expect(stale.state).toBe("stale");
  });

  it("is unsupported on a route-free ride", () => {
    expect(read("route.distanceRemaining", { route: null }).state).toBe("unsupported");
  });
});

describe("recording metrics", () => {
  it("reads recorded distance and the active clock", () => {
    expect(read("distance.recorded", { mode: "recording" })).toMatchObject({ displayValue: "10.0", unit: "mi", source: "recording" });
    expect(read("time.recorded", { mode: "recording" })).toMatchObject({ displayValue: "1:02:05", unit: null });
    expect(read("time.recorded", { mode: "recording" }).accessibleDetail).toBe("62 minutes recorded");
  });

  it("waits for the first fix, and is unsupported without a recording", () => {
    expect(read("time.recorded", { mode: "recording", recording: { summary: null } }).state).toBe("waiting");
    expect(read("distance.recorded", { mode: "recording", recording: null }).state).toBe("unsupported");
  });

  it("shows a truthful zero distance once the recording has fixes", () => {
    const zero = read("distance.recorded", {
      mode: "recording",
      recording: { summary: { distanceMeters: 0, elapsedSeconds: 3, movingSeconds: 3, pointCount: 2 } },
    });
    expect(zero).toMatchObject({ displayValue: "0.0", state: "ready" });
  });
});

describe("presets and choices", () => {
  it("offers only presets whose every metric the mode can show", () => {
    expect(presetsFor("guided").map((preset) => preset.id)).toEqual(["navigate"]);
    expect(presetsFor("recording").map((preset) => preset.id)).toEqual(["record"]);
    expect(presetsFor("free-ride")).toEqual([]);
  });

  it("groups the live metrics by category for the mode", () => {
    const guided = metricChoices("guided");
    expect(guided.map((group) => group.category)).toEqual(["Ride", "GPS", "Route", "Terrain"]);
    expect(metricChoices("free-ride").flatMap((group) => group.metrics.map((metric) => metric.id))).toEqual([
      "speed.current",
      "heading",
      "gps.accuracy",
      "elevation.current",
    ]);
  });
});

// ---- Slice B: filtered telemetry metrics (§6, §17.2) -------------------------

const MPH = 1609.344 / 3600;

/** Half an hour moving at 20 mph, max 65 mph, 500 ft up and 250 ft down, moving for 2:05. */
const TELEMETRY: RecordingTelemetry = {
  ...EMPTY_RECORDING_TELEMETRY,
  acceptedDistanceMeters: 16_093.44,
  movingMs: 1_800_000,
  maxSpeedMps: 65 * MPH,
  movement: "moving",
  movingSinceMs: NOW_MS - 125_000,
  lastSampleAtMs: NOW_MS - 1_000,
  elevation: { currentMeters: 300, sampledAtMs: NOW_MS - 1_000, gainMeters: 152.4, lossMeters: 76.2, sampleCount: 1_800 },
};

function recorded(telemetry: RecordingTelemetry | null, overrides: Partial<RideMetricContext> = {}): Partial<RideMetricContext> {
  return { mode: "recording", recording: { summary: context().recording!.summary, telemetry }, ...overrides };
}

describe("moving time", () => {
  it("reads the classifier's moving time as a clock", () => {
    expect(read("time.moving", recorded(TELEMETRY))).toMatchObject({
      displayValue: "30:00",
      unit: null,
      state: "ready",
      source: "derived",
      accessibleDetail: "30 minutes moving",
    });
  });

  it("shows a truthful zero before the rider has moved, and waits without telemetry", () => {
    expect(read("time.moving", recorded({ ...TELEMETRY, movingMs: 0 })).displayValue).toBe("0:00");
    expect(read("time.moving", recorded(null))).toMatchObject({ state: "waiting", displayValue: NO_VALUE });
    expect(read("time.moving", recorded(EMPTY_RECORDING_TELEMETRY))).toMatchObject({ state: "waiting" });
  });

  it("is unsupported on a ride that records nothing, even guided", () => {
    expect(read("time.moving", { mode: "guided", recording: null }).state).toBe("unsupported");
    expect(read("time.moving", { mode: "free-ride", recording: null }).state).toBe("unsupported");
    expect(read("time.moving", recorded(TELEMETRY, { mode: "guided" })).state).toBe("ready");
  });
});

describe("time since the last stop", () => {
  it("runs from the start of the current moving stretch", () => {
    expect(read("time.sinceStop", recorded(TELEMETRY))).toMatchObject({
      displayValue: "2:05",
      state: "ready",
      freshness: "current",
    });
  });

  it("is a true zero while stopped or paused", () => {
    const stopped = read("time.sinceStop", recorded({ ...TELEMETRY, movement: "stopped", movingSinceMs: null }));
    expect(stopped).toMatchObject({ displayValue: "0:00", state: "ready", accessibleDetail: "stopped" });
    expect(read("time.sinceStop", recorded(TELEMETRY, { paused: true }))).toMatchObject({
      displayValue: "0:00",
      accessibleDetail: "stopped, the ride is paused",
    });
  });

  it("holds at the last fix when GPS ages, then expires to a dash", () => {
    const held = read("time.sinceStop", recorded({ ...TELEMETRY, lastSampleAtMs: NOW_MS - 8_000 }));
    expect(held).toMatchObject({ state: "stale", freshness: "held", displayValue: "1:57", quality: "low" });
    expect(held.accessibleDetail).toContain("last reading 8 seconds ago");
    const gone = read("time.sinceStop", recorded({ ...TELEMETRY, lastSampleAtMs: NOW_MS - 16_000 }));
    expect(gone).toMatchObject({ state: "stale", freshness: "expired", displayValue: NO_VALUE });
  });
});

describe("moving average and max speed", () => {
  it("defines average speed as accepted distance over moving time", () => {
    expect(read("speed.average", recorded(TELEMETRY))).toMatchObject({
      displayValue: "20",
      unit: "mph",
      state: "ready",
      accessibleDetail: "20 miles per hour while moving",
    });
    expect(read("speed.average", recorded(TELEMETRY, { units: "metric" }))).toMatchObject({ displayValue: "32", unit: "km/h" });
  });

  it("waits for enough moving time instead of showing an unstable average", () => {
    const early = read("speed.average", recorded({ ...TELEMETRY, movingMs: 4_000, acceptedDistanceMeters: 40 }));
    expect(early).toMatchObject({ state: "waiting", displayValue: NO_VALUE });
  });

  it("reads the filtered max, and waits until a speed has been held", () => {
    expect(read("speed.max", recorded(TELEMETRY))).toMatchObject({ displayValue: "65", unit: "mph", state: "ready" });
    expect(read("speed.max", recorded({ ...TELEMETRY, maxSpeedMps: null }))).toMatchObject({
      state: "waiting",
      displayValue: NO_VALUE,
    });
  });

  it("is recording-backed: unsupported in Free Ride", () => {
    expect(read("speed.max", { mode: "free-ride", recording: null }).state).toBe("unsupported");
  });
});

describe("elevation", () => {
  it("reads gain and loss from the filtered profile in feet or metres", () => {
    expect(read("elevation.gain", recorded(TELEMETRY))).toMatchObject({ displayValue: "500", unit: "ft", state: "ready" });
    expect(read("elevation.loss", recorded(TELEMETRY))).toMatchObject({ displayValue: "250", unit: "ft" });
    expect(read("elevation.gain", recorded(TELEMETRY, { units: "metric" }))).toMatchObject({ displayValue: "152", unit: "m" });
    expect(read("elevation.gain", recorded(TELEMETRY)).accessibleDetail).toBe("500 feet");
  });

  it("shows a truthful zero gain only when altitude exists; never a fake zero without it", () => {
    const flat = read("elevation.gain", recorded({ ...TELEMETRY, elevation: { ...TELEMETRY.elevation, gainMeters: 0 } }));
    expect(flat).toMatchObject({ displayValue: "0", state: "ready" });
    const none = read("elevation.gain", recorded({ ...TELEMETRY, elevation: EMPTY_RECORDING_TELEMETRY.elevation }));
    expect(none).toMatchObject({ state: "waiting", displayValue: NO_VALUE, accessibleDetail: "this device reports no altitude" });
    expect(read("elevation.loss", recorded({ ...TELEMETRY, elevation: EMPTY_RECORDING_TELEMETRY.elevation })).displayValue).toBe(
      NO_VALUE,
    );
  });

  it("reads the current GPS altitude in every mode, under the GPS freshness policy", () => {
    const position = { ...context().position, altitudeMeters: 304.8, altitudeAccuracyMeters: 6 };
    for (const mode of ["guided", "recording", "free-ride"] as const) {
      expect(read("elevation.current", { mode, position })).toMatchObject({ displayValue: "1000", unit: "ft", state: "ready" });
    }
    expect(read("elevation.current", { position, units: "metric" })).toMatchObject({ displayValue: "305", unit: "m" });
    const held = read("elevation.current", { position: { ...position, observedAtMs: NOW_MS - 9_000 } });
    expect(held).toMatchObject({ state: "stale", freshness: "held", displayValue: "1000" });
  });

  it("is a dash, not 0, without altitude or with an unusable vertical accuracy", () => {
    expect(read("elevation.current")).toMatchObject({
      state: "waiting",
      displayValue: NO_VALUE,
      accessibleDetail: "this device reports no altitude",
    });
    const vague = read("elevation.current", {
      position: { ...context().position, altitudeMeters: 300, altitudeAccuracyMeters: 40 },
    });
    expect(vague).toMatchObject({ state: "waiting", displayValue: NO_VALUE, accessibleDetail: "altitude is too uncertain" });
  });
});

describe("freshness (§4.1)", () => {
  it("marks a live value current, held, then expired, with the reason spoken", () => {
    expect(read("speed.current").freshness).toBe("current");
    expect(read("speed.current", { position: { ...context().position, observedAtMs: NOW_MS - 6_000 } }).freshness).toBe("held");
    const gone = read("speed.current", { position: { ...context().position, observedAtMs: NOW_MS - 16_000 } });
    expect(gone).toMatchObject({ freshness: "expired", state: "stale", displayValue: NO_VALUE });
    expect(gone.accessibleDetail).toBe("unavailable, no GPS reading for 16 seconds");
  });

  it("leaves values that do not age without a freshness", () => {
    expect(read("route.timeRemaining").freshness).toBeNull();
    expect(read("time.moving", recorded(TELEMETRY)).freshness).toBeNull();
  });
});

describe("recording-backed availability", () => {
  it("offers recording metrics on Record, and on a guided ride only when it records", () => {
    expect(metricAvailable("time.moving", "recording")).toBe(true);
    expect(metricAvailable("time.moving", "guided")).toBe(false);
    expect(metricAvailable("time.moving", "guided", { recording: true })).toBe(true);
    expect(metricAvailable("time.moving", "free-ride")).toBe(false);
    expect(metricAvailable("elevation.current", "free-ride")).toBe(true);
    const recordingGuided = metricChoices("guided", { recording: true }).flatMap((group) => group.metrics.map((m) => m.id));
    expect(recordingGuided).toEqual(expect.arrayContaining(["time.moving", "speed.average", "elevation.gain"]));
    expect(metricChoices("guided").flatMap((group) => group.metrics.map((m) => m.id))).not.toContain("time.moving");
  });
});

// ---- The strip model -------------------------------------------------------

const FRESH: NavigationPosition = {
  coordinate: { lon: -75.4385, lat: 40.1385 },
  observedAt: "2026-09-21T14:00:00.000Z",
  ageMs: 1_000,
  accuracyMeters: 5,
  headingDegrees: 212,
  speedMps: 21,
  quality: "fresh-good",
};

function navigation(overrides: Partial<SessionNavigationState> = {}): SessionNavigationState {
  return {
    sessionId: newRideSessionId(),
    activity: "guided",
    resumeActivity: null,
    startedAt: "2026-09-21T13:00:00.000Z",
    endedAt: null,
    endReason: null,
    plan: { rideId: newRideId(), rideRevision: 4, route: ROUTE },
    recordingId: null,
    position: FRESH,
    aheadGuidanceSuspended: false,
    instruction: null,
    offRouteState: "on-route",
    nextStopId: null,
    completedStopIds: [],
    remainingStopIds: [],
    ...overrides,
  };
}

function strip(nav: SessionNavigationState, settings = createRiderSettings()) {
  return buildRideMetricStrip({
    navigation: nav,
    telemetry: context().route!.answer,
    recordingSummary: context().recording!.summary,
    settings,
    nowMs: NOW_MS,
  });
}

describe("the strip model", () => {
  it("chooses the mode from the route and the recording", () => {
    expect(rideMetricMode(navigation())).toBe("guided");
    expect(rideMetricMode(navigation({ activity: "free", plan: { ...navigation().plan, route: null } }))).toBe("free-ride");
    expect(
      rideMetricMode(navigation({ activity: "free", plan: { ...navigation().plan, route: null }, recordingId: asRecordingId("rec_1") })),
    ).toBe("recording");
  });

  it("shows exactly three slots with the guided defaults", () => {
    const model = strip(navigation());
    expect(model.slots).toHaveLength(3);
    expect(model.shownIds).toEqual(["speed.current", "route.distanceRemaining", "route.timeRemaining"]);
    expect(model.preset?.id).toBe("navigate");
    expect(model.slots[0].spokenValue).toBe("Speed, 47 miles per hour.");
    expect(model.slots[1].caption).toBe("Dist left");
  });

  it("uses the Record defaults while recording and the Free Ride defaults without one", () => {
    const routeless = { ...navigation().plan, route: null };
    expect(strip(navigation({ activity: "free", plan: routeless, recordingId: asRecordingId("rec_1") })).shownIds).toEqual([
      "speed.current",
      "distance.recorded",
      "time.moving",
    ]);
    expect(strip(navigation({ activity: "free", plan: routeless })).shownIds).toEqual(["speed.current", "heading", "gps.accuracy"]);
  });

  it("displays a stored metric the mode cannot show as the mode default, without losing the choice", () => {
    // A stored choice a later slice builds (grade) is kept, but shown as a default.
    expect(shownMetricIds(["terrain.grade", "route.eta", "speed.current"], "guided")).toEqual([
      "route.distanceRemaining",
      "route.eta",
      "speed.current",
    ]);
  });

  it("allows customizing while paused, or on a fresh speed at or under 5 mph", () => {
    expect(strip(navigation({ activity: "paused" })).customizable).toBe(true);
    expect(strip(navigation({ position: { ...FRESH, speedMps: 2 } })).customizable).toBe(true);
    expect(strip(navigation({ position: { ...FRESH, speedMps: 2.3 } })).customizable).toBe(false);
    expect(strip(navigation()).customizable).toBe(false);
  });

  it("never treats a stale or missing speed as stopped", () => {
    expect(strip(navigation({ position: { ...FRESH, speedMps: 0, ageMs: 9_000 } })).customizable).toBe(false);
    expect(strip(navigation({ position: { ...FRESH, speedMps: null } })).customizable).toBe(false);
    expect(strip(navigation({ activity: "completed" })).customizable).toBe(false);
  });

  it("reads rideMetrics for guided rides and recordingMetrics otherwise", () => {
    const settings = withMetricSlots(createRiderSettings(), "rideMetrics", ["route.eta", "heading", "speed.current"]);
    expect(strip(navigation(), settings).shownIds).toEqual(["route.eta", "heading", "speed.current"]);
    expect(strip(navigation(), settings).preset).toBeNull();
    const routeless = { ...navigation().plan, route: null };
    expect(strip(navigation({ activity: "free", plan: routeless, recordingId: asRecordingId("r") }), settings).preferenceKey).toBe(
      "recordingMetrics",
    );
  });

  it("carries the over-the-limit state only onto a shown speed", () => {
    const over = buildRideMetricStrip({
      navigation: navigation(),
      telemetry: context().route!.answer,
      recordingSummary: null,
      settings: createRiderSettings(),
      nowMs: NOW_MS,
      overLimit: true,
    });
    expect(over.overLimit).toBe(true);
    const hidden = buildRideMetricStrip({
      navigation: navigation(),
      telemetry: context().route!.answer,
      recordingSummary: null,
      settings: withMetricSlots(createRiderSettings(), "rideMetrics", ["route.eta", "heading", "route.progress"]),
      nowMs: NOW_MS,
      overLimit: true,
    });
    expect(hidden.overLimit).toBe(false);
  });
});

describe("the strip with slice B telemetry", () => {
  it("shows moving time on a guided ride that records, and substitutes it on one that does not", () => {
    const settings = withMetricSlots(createRiderSettings(), "rideMetrics", ["speed.current", "time.moving", "route.eta"]);
    const input = {
      telemetry: context().route!.answer,
      recordingSummary: context().recording!.summary,
      recordingTelemetry: TELEMETRY,
      settings,
      nowMs: NOW_MS,
    };
    const recording = buildRideMetricStrip({ ...input, navigation: navigation({ recordingId: asRecordingId("rec_g") }) });
    expect(recording.shownIds).toEqual(["speed.current", "time.moving", "route.eta"]);
    expect(recording.sources).toEqual({ recording: true });
    expect(recording.slots[1].reading.displayValue).toBe("30:00");
    const plain = buildRideMetricStrip({ ...input, navigation: navigation() });
    expect(plain.shownIds).toEqual(["speed.current", "route.distanceRemaining", "route.eta"]);
  });

  it("passes altitude and the paused state through to the resolvers", () => {
    const model = buildRideMetricStrip({
      navigation: navigation({
        activity: "paused",
        plan: { ...navigation().plan, route: null },
        recordingId: asRecordingId("rec_p"),
        position: { ...FRESH, altitudeMeters: 304.8, altitudeAccuracyMeters: 5 },
      }),
      telemetry: null,
      recordingSummary: context().recording!.summary,
      recordingTelemetry: TELEMETRY,
      settings: withMetricSlots(createRiderSettings(), "recordingMetrics", ["elevation.current", "time.sinceStop", "speed.max"]),
      nowMs: NOW_MS,
    });
    expect(model.slots.map((slot) => slot.reading.displayValue)).toEqual(["1000", "0:00", "65"]);
  });

  it("keeps a slice A Record layout as stored (Rec time), though the default is now moving time", () => {
    const stored = ["speed.current", "distance.recorded", "time.recorded"] as const;
    expect(shownMetricIds(stored, "recording")).toEqual(stored);
  });
});

describe("changing one slot (§2.2)", () => {
  it("changes only the chosen slot", () => {
    const stored = ["speed.current", "route.distanceRemaining", "route.timeRemaining"] as const;
    expect(storedAfterChoice(stored, stored, 1, "route.eta")).toEqual(["speed.current", "route.eta", "route.timeRemaining"]);
  });

  it("swaps with the slot that already shows the metric", () => {
    const stored = ["speed.current", "route.distanceRemaining", "route.timeRemaining"] as const;
    expect(storedAfterChoice(stored, stored, 2, "speed.current")).toEqual([
      "route.timeRemaining",
      "route.distanceRemaining",
      "speed.current",
    ]);
  });

  it("keeps a substituted slot's stored choice when another slot changes", () => {
    const stored = ["speed.current", "distance.recorded", "time.recorded"] as const;
    const shown = shownMetricIds(stored, "free-ride");
    expect(shown).toEqual(["speed.current", "heading", "gps.accuracy"]);
    expect(storedAfterChoice(stored, shown, 0, "heading")).toEqual(["heading", "speed.current", "time.recorded"]);
  });
});

// ---- Free Ride live telemetry (§6, §11) --------------------------------------

describe("Free Ride live telemetry", () => {
  const LIVE_METRICS = ["time.moving", "time.sinceStop", "speed.average", "speed.max", "elevation.gain", "elevation.loss"] as const;
  const live = { recording: false, liveTelemetry: true } as const;
  const freeRide = (telemetry: RecordingTelemetry | null, overrides: Partial<RideMetricContext> = {}): Partial<RideMetricContext> => ({
    mode: "free-ride",
    route: null,
    recording: null,
    liveTelemetry: telemetry,
    ...overrides,
  });

  it("offers moving time, since stop, average, max, gain and loss in Free Ride with a live source", () => {
    for (const id of LIVE_METRICS) expect(metricAvailable(id, "free-ride", live)).toBe(true);
    expect(metricAvailable("distance.recorded", "free-ride", live)).toBe(false);
    const choices = metricChoices("free-ride", live);
    expect(choices.map((group) => group.category)).toEqual(["Ride", "GPS", "Terrain"]);
    expect(choices.flatMap((group) => group.metrics.map((metric) => metric.id)).sort()).toEqual([
      "elevation.current",
      "elevation.gain",
      "elevation.loss",
      "gps.accuracy",
      "heading",
      "speed.average",
      "speed.current",
      "speed.max",
      "time.moving",
      "time.sinceStop",
    ]);
  });

  it("offers none of them without the live source, and never on a guided ride that does not record", () => {
    for (const id of LIVE_METRICS) {
      expect(metricAvailable(id, "free-ride", { recording: false })).toBe(false);
      expect(metricAvailable(id, "guided", live)).toBe(false);
      expect(read(id, { mode: "guided", recording: null, liveTelemetry: TELEMETRY }).state).toBe("unsupported");
    }
  });

  it("reads the live fold as the recording's telemetry reads", () => {
    expect(read("time.moving", freeRide(TELEMETRY))).toMatchObject({ displayValue: "30:00", state: "ready" });
    expect(read("speed.max", freeRide(TELEMETRY))).toMatchObject({ displayValue: "65", unit: "mph", state: "ready" });
    expect(read("speed.average", freeRide(TELEMETRY))).toMatchObject({ displayValue: "20", state: "ready" });
    expect(read("time.sinceStop", freeRide(TELEMETRY))).toMatchObject({ displayValue: "2:05", state: "ready" });
    for (const id of LIVE_METRICS) {
      expect(read(id, freeRide(TELEMETRY))).toEqual(read(id, recorded(TELEMETRY)));
    }
  });

  it("waits, as a dash, before the first credible fix", () => {
    for (const id of LIVE_METRICS) {
      expect(read(id, freeRide(EMPTY_RECORDING_TELEMETRY))).toMatchObject({ state: "waiting", displayValue: NO_VALUE });
      expect(read(id, freeRide(null))).toMatchObject({ state: "waiting" });
    }
  });

  it("is a true zero since stop while the Free Ride is paused", () => {
    expect(read("time.sinceStop", freeRide(TELEMETRY, { paused: true }))).toMatchObject({ displayValue: "0:00" });
  });

  it("keeps the Free Ride defaults; the layout it shares with Record now shows Record's moving time", () => {
    expect(defaultMetricSlots("free-ride")).toEqual(["speed.current", "heading", "gps.accuracy"]);
    const routeless = { ...navigation().plan, route: null };
    const nav = navigation({ activity: "free", plan: routeless });
    const withLive = buildRideMetricStrip({
      navigation: nav,
      telemetry: null,
      recordingSummary: null,
      liveTelemetry: TELEMETRY,
      settings: createRiderSettings(),
      nowMs: NOW_MS,
    });
    expect(withLive.sources).toEqual(live);
    // The stored layout is Record's default (§5.1: one layout for Record and Free Ride): Distance
    // cannot show here and becomes Heading; Moving time now can, so it stays in its slot.
    expect(withLive.shownIds).toEqual(["speed.current", "heading", "time.moving"]);
    const gps = buildRideMetricStrip({
      navigation: nav,
      telemetry: null,
      recordingSummary: null,
      liveTelemetry: TELEMETRY,
      settings: withMetricSlots(createRiderSettings(), "recordingMetrics", ["speed.current", "heading", "gps.accuracy"]),
      nowMs: NOW_MS,
    });
    expect(gps.shownIds).toEqual(["speed.current", "heading", "gps.accuracy"]);

    const chosen = buildRideMetricStrip({
      navigation: nav,
      telemetry: null,
      recordingSummary: null,
      liveTelemetry: TELEMETRY,
      settings: withMetricSlots(createRiderSettings(), "recordingMetrics", ["speed.current", "time.moving", "speed.max"]),
      nowMs: NOW_MS,
    });
    expect(chosen.shownIds).toEqual(["speed.current", "time.moving", "speed.max"]);
    expect(chosen.slots[1].reading.displayValue).toBe("30:00");
    expect(chosen.slots[2].reading.displayValue).toBe("65");
  });

  it("ignores a live fold on a recording ride and on a guided ride: they keep their own sources", () => {
    const routeless = { ...navigation().plan, route: null };
    const recordingRide = buildRideMetricStrip({
      navigation: navigation({ activity: "free", plan: routeless, recordingId: asRecordingId("rec_1") }),
      telemetry: null,
      recordingSummary: context().recording!.summary,
      recordingTelemetry: { ...TELEMETRY, movingMs: 60_000 },
      liveTelemetry: TELEMETRY,
      settings: createRiderSettings(),
      nowMs: NOW_MS,
    });
    expect(recordingRide.sources).toEqual({ recording: true });
    expect(recordingRide.slots[2].reading.displayValue).toBe("1:00");

    const guided = buildRideMetricStrip({
      navigation: navigation(),
      telemetry: context().route!.answer,
      recordingSummary: null,
      liveTelemetry: TELEMETRY,
      settings: withMetricSlots(createRiderSettings(), "rideMetrics", ["speed.current", "time.moving", "route.eta"]),
      nowMs: NOW_MS,
    });
    expect(guided.sources).toEqual({ recording: false });
    expect(guided.shownIds).not.toContain("time.moving");
  });

  it("leaves a stored Free Ride layout as it was stored when the live source is absent", () => {
    const stored = ["speed.current", "time.moving", "speed.max"] as const;
    expect(shownMetricIds(stored, "free-ride")).toEqual(["speed.current", "heading", "gps.accuracy"]);
    expect(shownMetricIds(stored, "free-ride", live)).toEqual(stored);
  });
});
