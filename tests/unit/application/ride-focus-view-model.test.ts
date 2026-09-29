/**
 * The Ride Focus view model
 * (08-RIDE-NAVIGATION-AND-FREE-RIDE §2–§8, §18, §24; 12 §4, §16, §17;
 * 17-IMPLEMENTATION-PLAN Task 8.5).
 *
 * The surface renders this projection, so the rules a rider depends on are
 * asserted here rather than through a browser:
 *
 * - a stale fix loses speed and heading and keeps its coordinate;
 * - a road name is never fabricated, and a blank one is not a name;
 * - suspended ahead guidance produces no ahead content at all;
 * - unknown progress, remaining distance and ETA stay unknown;
 * - every control's refusal states its reason;
 * - each device failure (permission, wake lock, speech) is a visible,
 *   non-blocking state.
 */

import { EMPTY_RECORDING_TELEMETRY } from "@/domain/recording/telemetry";
import { describe, expect, it } from "vitest";

import {
  buildRideFocusViewModel,
  formatAge,
  formatHeading,
  formatManeuverDistance,
  formatSpeed,
  permissionLabel,
} from "@/application/ride-session/ride-focus-view-model";
import type { RideFocusEnvironmentSnapshot } from "@/application/ride-session/ports/ride-focus-environment";
import type {
  NavigationPosition,
  SessionNavigationState,
} from "@/domain/ride-session/navigation";
import { deriveSessionNavigation } from "@/domain/ride-session/navigation";
import { reduce } from "@/domain/ride-session/reducer";
import type { SessionInstruction } from "@/domain/ride-session/types";
import type { RecordingSummary } from "@/domain/recording/types";
import { asRecordingId } from "@/domain/recording/ids";
import { asSessionInstructionId, newRideSessionId } from "@/domain/ride-session/ids";
import { newRideId } from "@/domain/ride/ids";
import { asRouteCandidateId } from "@/domain/route/ids";

const NOW = "2026-09-21T14:00:00.000Z";

const ROUTE = { planningGeneration: 3, routeId: asRouteCandidateId("route_best") };

const HEALTHY_POSITION: NavigationPosition = {
  coordinate: { lon: -75.4385, lat: 40.1385 },
  observedAt: NOW,
  ageMs: 3_000,
  accuracyMeters: 6,
  headingDegrees: 212,
  speedMps: 14.2,
  quality: "fresh-good",
};

function navigation(overrides: Partial<SessionNavigationState> = {}): SessionNavigationState {
  return {
    sessionId: newRideSessionId(),
    activity: "guided",
    resumeActivity: null,
    startedAt: NOW,
    endedAt: null,
    endReason: null,
    plan: { rideId: newRideId(), rideRevision: 4, route: ROUTE },
    recordingId: null,
    position: HEALTHY_POSITION,
    aheadGuidanceSuspended: false,
    instruction: null,
    offRouteState: null,
    nextStopId: null,
    completedStopIds: [],
    remainingStopIds: [],
    ...overrides,
  };
}

function environment(
  overrides: Partial<RideFocusEnvironmentSnapshot> = {},
): RideFocusEnvironmentSnapshot {
  return { locationPermission: "granted", wakeLock: "active", speech: "ready", ...overrides };
}

function instruction(overrides: Partial<SessionInstruction> = {}): SessionInstruction {
  return {
    instructionId: asSessionInstructionId("ins_1"),
    kind: "turn",
    maneuver: "left",
    roadName: "Gravel Pike",
    distanceMeters: 120,
    targetStopId: null,
    ...overrides,
  };
}

function view(input: {
  readonly navigation?: SessionNavigationState;
  readonly environment?: RideFocusEnvironmentSnapshot;
  readonly telemetry?: Parameters<typeof buildRideFocusViewModel>[0]["telemetry"];
  readonly recordingSummary?: RecordingSummary | null;
  readonly recordingStatus?: Parameters<typeof buildRideFocusViewModel>[0]["recordingStatus"];
  readonly bufferedRecordingPointCount?: number;
  readonly recordingLibraryCommitted?: Parameters<typeof buildRideFocusViewModel>[0]["recordingLibraryCommitted"];
  readonly recordingSourceDeleted?: Parameters<typeof buildRideFocusViewModel>[0]["recordingSourceDeleted"];
  readonly now?: string;
  readonly mapReady?: boolean;
  readonly routeWarnings?: Parameters<typeof buildRideFocusViewModel>[0]["routeWarnings"];
} = {}) {
  return buildRideFocusViewModel({
    navigation: input.navigation ?? navigation(),
    environment: input.environment ?? environment(),
    telemetry: input.telemetry ?? null,
    recordingSummary: input.recordingSummary,
    recordingStatus: input.recordingStatus,
    bufferedRecordingPointCount: input.bufferedRecordingPointCount,
    recordingLibraryCommitted: input.recordingLibraryCommitted,
    recordingSourceDeleted: input.recordingSourceDeleted,
    now: input.now ?? NOW,
    mapReady: input.mapReady,
    routeWarnings: input.routeWarnings,
  });
}

describe("recording activity label", () => {
  it("shows pause state while a recording is associated with the session", () => {
    const result = view({
      navigation: navigation({
        activity: "paused",
        resumeActivity: "free",
        plan: { rideId: newRideId(), rideRevision: 0, route: null },
        recordingId: asRecordingId("rec_paused_label"),
      }),
    });

    expect(result.activityLabel).toBe("Paused");
  });

  it("labels a moving route-free recording as Recording", () => {
    const result = view({
      navigation: navigation({
        activity: "free",
        plan: { rideId: newRideId(), rideRevision: 0, route: null },
        recordingId: asRecordingId("rec_active_label"),
      }),
    });

    expect(result.activityLabel).toBe("Recording");
  });

  it("keeps the recording context in the terminal message after discard clears its reference", () => {
    const result = view({
      navigation: navigation({
        activity: "completed",
        endReason: "abandoned",
        endedAt: NOW,
        recordingId: null,
      }),
      recordingStatus: "discarded",
    });

    expect(result.terminal).toMatchObject({
      reason: "abandoned",
      title: "Recording discarded",
    });
  });
});

describe("position freshness (08 §4)", () => {
  it("labels a fresh, precise fix and shows speed and heading with it", () => {
    const { position } = view();

    expect(position.quality).toBe("fresh-good");
    expect(position.qualityLabel).toBe("Good GPS fix");
    expect(position.tone).toBe("good");
    expect(position.ageText).toBe("updated 3 s ago");
    expect(position.accuracyText).toBe("±6 m");
    expect(position.speedText).toBe("32 mph");
    expect(position.headingText).toBe("SW");
  });

  it("calls a fix with an unreported accuracy weak rather than good", () => {
    // Driven through the real reducer and the real derivation, so what this
    // asserts is the whole path: the port treats an unreported accuracy as
    // *not* good, and the surface renders that verdict as a weak fix rather than
    // a good one (8 §4).
    const started = reduce(null, {
      type: "session.started",
      at: NOW,
      sessionId: newRideSessionId(),
      activity: "guided",
      suggestions: "off",
      plan: { rideId: newRideId(), rideRevision: 1, route: ROUTE },
      itinerary: [],
      recordingId: null,
    });
    if (started.outcome !== "applied") throw new Error(started.message);
    const fixed = reduce(started.state, {
      type: "position.updated",
      at: NOW,
      position: {
        coordinate: { lon: -75.4385, lat: 40.1385 },
        observedAt: NOW,
        accuracyMeters: null,
        headingDegrees: 212,
        speedMps: 14.2,
      },
    });
    if (fixed.outcome !== "applied") throw new Error(fixed.message);

    const { position } = view({
      navigation: deriveSessionNavigation(fixed.state, { now: NOW }),
    });

    expect(position.quality).toBe("fresh-poor");
    expect(position.qualityLabel).toBe("Weak GPS fix");
    expect(position.accuracyText).toBeNull();
    // The fix is usable, so its speed and heading stay current (8 §4 only
    // withholds them for a stale fix).
    expect(position.speedText).toBe("32 mph");
  });

  it("hides speed and heading once the fix is stale, and keeps the coordinate and the age", () => {
    const { position, mapPosition } = view({
      navigation: navigation({
        position: {
          ...HEALTHY_POSITION,
          ageMs: 42_000,
          speedMps: null,
          headingDegrees: null,
          quality: "stale",
        },
      }),
    });

    expect(position.qualityLabel).toBe("Stale GPS");
    expect(position.tone).toBe("bad");
    expect(position.ageText).toBe("last fix 42 s ago");
    expect(position.speedText).toBeNull();
    expect(position.headingText).toBeNull();
    expect(mapPosition?.coordinate).toEqual({ lon: -75.4385, lat: 40.1385 });
  });

  it("states an unavailable position as no fix, with nothing to draw", () => {
    const { position, mapPosition } = view({
      navigation: navigation({
        position: {
          coordinate: null,
          observedAt: null,
          ageMs: null,
          accuracyMeters: null,
          headingDegrees: null,
          speedMps: null,
          quality: "unavailable",
        },
      }),
    });

    expect(position.qualityLabel).toBe("No GPS fix");
    expect(position.hasCoordinate).toBe(false);
    expect(position.speedText).toBeNull();
    expect(mapPosition).toBeNull();
  });

  it("formats ages, speeds and headings without inventing values", () => {
    expect(formatAge(8_300)).toBe("8 s");
    expect(formatAge(212_000)).toBe("4 min");
    expect(formatAge(7_200_000)).toBe("2 h");
    expect(formatAge(null)).toBeNull();
    // An unknown speed is not 0 mph, and an unreported heading is not north.
    expect(formatSpeed(null)).toBeNull();
    expect(formatSpeed(0)).toBe("0 mph");
    expect(formatHeading(null)).toBeNull();
    expect(formatHeading(0)).toBe("N");
    expect(formatHeading(359)).toBe("N");
    expect(formatHeading(-45)).toBe("NW");
  });
});

describe("maneuver copy (08 §2, §6)", () => {
  it("says the distance, the action and the road as one sentence", () => {
    const { guidance } = view({ navigation: navigation({ instruction: instruction() }) });

    expect(guidance.kind).toBe("maneuver");
    if (guidance.kind !== "maneuver") throw new Error("expected a maneuver");
    expect(guidance.maneuver.distanceText).toBe("400 ft");
    expect(guidance.maneuver.actionText).toBe("Turn left");
    expect(guidance.maneuver.roadName).toBe("Gravel Pike");
    expect(guidance.maneuver.label).toBe("Turn left onto Gravel Pike in 400 ft");
    expect(guidance.maneuver.glyph).toBe("left");
  });

  it("maps every normalized maneuver to its HUD glyph", () => {
    const maneuvers: Array<[SessionInstruction, string]> = [
      [instruction({ maneuver: "right" }), "right"],
      [instruction({ maneuver: "slight-left" }), "slight-left"],
      [instruction({ maneuver: "slight-right" }), "slight-right"],
      [instruction({ maneuver: "straight" }), "straight"],
      [instruction({ maneuver: "uturn" }), "uturn"],
      [instruction({ kind: "continue", maneuver: null }), "continue"],
      [instruction({ kind: "arrive", maneuver: null }), "arrive"],
    ];
    for (const [value, glyph] of maneuvers) {
      const result = view({ navigation: navigation({ instruction: value }) });
      if (result.guidance.kind !== "maneuver") throw new Error("expected a maneuver");
      expect(result.guidance.maneuver.glyph).toBe(glyph);
    }
  });

  it("projects a recording HUD with moving time and average speed from the session summary", () => {
    const recordingId = asRecordingId("rec_hud");
    const { recording } = view({
      navigation: navigation({
        activity: "free",
        plan: { rideId: newRideId(), rideRevision: 0, route: null },
        recordingId,
      }),
      recordingSummary: {
        distanceMeters: 1_609,
        elapsedSeconds: 125,
        movingSeconds: 102,
        pointCount: 3,
      },
      now: NOW,
    });

    expect(recording).toEqual({
      distanceText: "1 mi",
      movingTimeText: "1:42",
      elapsedTimeText: "2:05",
      currentSpeedText: "32 mph",
      averageSpeedText: "35 mph",
      waitingForFix: false,
      saveWarningText: null,
      canRetrySave: false,
    });
  });

  it("keeps recorded durations and average speed at the last accepted fix when GPS is stale", () => {
    const recordingId = asRecordingId("rec_stale_hud");
    const { recording } = view({
      navigation: navigation({
        activity: "free",
        plan: { rideId: newRideId(), rideRevision: 0, route: null },
        recordingId,
        position: {
          ...HEALTHY_POSITION,
          ageMs: 60_000,
          quality: "stale",
          speedMps: null,
          headingDegrees: null,
        },
      }),
      recordingSummary: {
        distanceMeters: 1_609,
        elapsedSeconds: 125,
        movingSeconds: 102,
        pointCount: 3,
      },
      now: "2026-09-21T14:01:00.000Z",
    });

    expect(recording).toMatchObject({
      movingTimeText: "1:42",
      elapsedTimeText: "2:05",
      averageSpeedText: "35 mph",
    });
  });

  it("offers a bounded save retry when device storage fills", () => {
    const result = view({
      navigation: navigation({
        activity: "free",
        plan: { rideId: newRideId(), rideRevision: 0, route: null },
        recordingId: asRecordingId("rec_storage_full"),
      }),
      recordingSummary: {
        distanceMeters: 0,
        elapsedSeconds: 0,
        movingSeconds: 0,
        pointCount: 16,
      },
      recordingStatus: "storage-full",
      bufferedRecordingPointCount: 16,
    });

    expect(result.recording?.canRetrySave).toBe(true);
    expect(result.recording?.saveWarningText).toContain("16 GPS points are waiting to be saved");
  });

  it("keeps a corrupt recovered trace paused, unsavable and discardable", () => {
    const result = view({
      navigation: navigation({
        activity: "paused",
        resumeActivity: "free",
        plan: { rideId: newRideId(), rideRevision: 0, route: null },
        recordingId: asRecordingId("rec_partial_recovery"),
      }),
      recordingSummary: {
        distanceMeters: 800,
        elapsedSeconds: 30,
        movingSeconds: 30,
        pointCount: 8,
      },
      recordingStatus: "corrupt",
    });

    expect(result.controls.resume).toMatchObject({ enabled: false });
    expect(result.controls.finish).toMatchObject({ enabled: false });
    expect(result.controls.discard.enabled).toBe(true);
    expect(result.recording?.saveWarningText).toContain("unreadable section");
  });

  it("protects an already saved ride while source cleanup is pending", () => {
    const result = view({
      navigation: navigation({
        activity: "paused",
        resumeActivity: "free",
        plan: { rideId: newRideId(), rideRevision: 0, route: null },
        recordingId: asRecordingId("rec_saved_pending_cleanup"),
      }),
      recordingSummary: {
        distanceMeters: 1_000,
        elapsedSeconds: 60,
        movingSeconds: 60,
        pointCount: 3,
      },
      recordingStatus: "sealed",
      recordingLibraryCommitted: true,
    });

    expect(result.controls.resume.enabled).toBe(false);
    expect(result.controls.finish.enabled).toBe(true);
    expect(result.controls.discard).toMatchObject({ enabled: false });
    expect(result.recording?.saveWarningText).toContain("source trace still needs cleanup");
  });

  it("never fabricates a road name, and treats a blank one as absent", () => {
    const { guidance } = view({
      navigation: navigation({
        instruction: instruction({ roadName: "   " }),
      }),
    });

    if (guidance.kind !== "maneuver") throw new Error("expected a maneuver");
    expect(guidance.maneuver.roadName).toBeNull();
    expect(guidance.maneuver.roadPreposition).toBeNull();
    expect(guidance.maneuver.label).toBe("Turn left in 400 ft");
  });

  it("names the direction of a turn and never claims one for a continue", () => {
    const bearing = view({
      navigation: navigation({ instruction: instruction({ maneuver: "slight-right" }) }),
    });
    if (bearing.guidance.kind !== "maneuver") throw new Error("expected a maneuver");
    expect(bearing.guidance.maneuver.actionText).toBe("Bear right");

    const straight = view({
      navigation: navigation({
        instruction: instruction({ kind: "continue", maneuver: null, roadName: "Ridge Road" }),
      }),
    });
    if (straight.guidance.kind !== "maneuver") throw new Error("expected a maneuver");
    expect(straight.guidance.maneuver.actionText).toBe("Continue");
    expect(straight.guidance.maneuver.label).toBe("Continue on Ridge Road in 400 ft");
  });

  it("reads an immediate arrival as now, not as a distance of zero", () => {
    const { guidance } = view({
      navigation: navigation({
        instruction: instruction({ kind: "arrive", maneuver: null, roadName: null, distanceMeters: 8 }),
      }),
    });

    if (guidance.kind !== "maneuver") throw new Error("expected a maneuver");
    expect(guidance.maneuver.distanceText).toBe("Now");
    expect(guidance.maneuver.label).toBe("Arrive at your destination now");
  });

  it("keeps feet under a fifth of a mile and miles above it", () => {
    expect(formatManeuverDistance(20)).toBe("now");
    expect(formatManeuverDistance(30)).toBe("100 ft");
    expect(formatManeuverDistance(200)).toBe("650 ft");
    expect(formatManeuverDistance(500)).toBe("0.3 mi");
    expect(formatManeuverDistance(4_800)).toBe("3 mi");
  });
});

describe("suspended ahead guidance (OGV-RID-005, 8 §15)", () => {
  it("produces no maneuver content while the ride is not moving", () => {
    const { guidance } = view({
      navigation: navigation({
        activity: "paused",
        resumeActivity: "guided",
        aheadGuidanceSuspended: true,
        instruction: instruction(),
      }),
    });

    expect(guidance.kind).toBe("suspended");
    if (guidance.kind !== "suspended") throw new Error("expected suspension");
    expect(guidance.reason).toBe("not-moving");
    expect(guidance.text).toContain("paused");
  });

  it("says off route, not stopped, when a moving guided ride leaves the line", () => {
    const { guidance } = view({
      navigation: navigation({
        activity: "guided",
        aheadGuidanceSuspended: true,
        offRouteState: "off-route",
        instruction: instruction(),
      }),
    });

    expect(guidance.kind).toBe("suspended");
    if (guidance.kind !== "suspended") throw new Error("expected suspension");
    expect(guidance.reason).toBe("off-route");
    expect(guidance.text).toContain("Off the route");
  });

  it("suspends for a stale fix, with the reason the rider can act on", () => {
    const { guidance } = view({
      navigation: navigation({
        aheadGuidanceSuspended: true,
        position: { ...HEALTHY_POSITION, speedMps: null, headingDegrees: null, quality: "stale" },
        instruction: instruction(),
      }),
    });

    if (guidance.kind !== "suspended") throw new Error("expected suspension");
    expect(guidance.reason).toBe("gps-stale");
  });

  it("suspends for an unavailable fix", () => {
    const { guidance } = view({
      navigation: navigation({
        aheadGuidanceSuspended: true,
        position: { ...HEALTHY_POSITION, coordinate: null, quality: "unavailable" },
      }),
    });

    if (guidance.kind !== "suspended") throw new Error("expected suspension");
    expect(guidance.reason).toBe("gps-unavailable");
  });

  it("waits, rather than inventing a maneuver, when the engine has issued none", () => {
    const { guidance } = view({ navigation: navigation({ instruction: null }) });

    expect(guidance.kind).toBe("waiting");
  });

  it("names a Free Ride instead of telling its rider to follow a route", () => {
    const { guidance } = view({ navigation: navigation({ instruction: null, activity: "free" }) });

    if (guidance.kind !== "waiting") throw new Error("expected waiting");
    expect(guidance.text).not.toContain("route");
  });
});

describe("progress and telemetry (08 §2, §5)", () => {
  it("states unknown progress as unknown and draws no fraction", () => {
    const { progress, secondary } = view({ telemetry: null });

    expect(progress.fraction).toBeNull();
    expect(progress.fractionText).toBe("Route progress unavailable");
    expect(secondary.etaText).toBe("Unknown");
    expect(secondary.remainingText).toBe("Unknown");
  });

  it("uses the session's own stop objective as progress when there is one", () => {
    const { progress } = view({
      navigation: navigation({
        completedStopIds: ["stop_a" as never],
        remainingStopIds: ["stop_b" as never, "stop_c" as never],
      }),
    });

    expect(progress.fraction).toBeNull();
    expect(progress.stopsText).toBe("Stop 1 of 3");
    expect(progress.fractionText).toBe("Stop 1 of 3");
  });

  it("reports the matcher's fraction when the engine has answered", () => {
    const { progress, secondary } = view({
      telemetry: {
        routeProgress: 0.42,
        remainingDistanceMeters: 24_140,
        remainingDurationSeconds: 2_880,
        etaIso: "2026-09-21T15:00:00.000Z",
      },
    });

    expect(progress.fraction).toBeCloseTo(0.42);
    expect(progress.fractionText).toBe("42% along the route");
    expect(secondary.remainingText).toBe("15 mi · 48 min");
    expect(secondary.etaText).toMatch(/^\d{1,2}:\d{2}/);
  });

  it("withholds retained route estimates when the GPS fix is stale", () => {
    const result = view({
      navigation: navigation({
        position: {
          ...HEALTHY_POSITION,
          ageMs: 42_000,
          speedMps: null,
          headingDegrees: null,
          quality: "stale",
        },
      }),
      telemetry: {
        routeProgress: 0.42,
        remainingDistanceMeters: 24_140,
        remainingDurationSeconds: 2_880,
        etaIso: "2026-09-21T15:00:00.000Z",
      },
    });

    expect(result.progress.fraction).toBeNull();
    expect(result.progress.fractionText).toBe("Route progress unavailable");
    expect(result.secondary.remainingText).toBe("Unknown");
    expect(result.secondary.etaText).toBe("Unknown");
    expect(result.warnings.find((warning) => warning.id === "gps-stale")?.text).toContain("route estimates are paused");
  });
});

describe("critical conditions (08 §3, §7, §8, §24)", () => {
  it("raises an unavailable fix as a critical warning", () => {
    const { warnings } = view({
      navigation: navigation({
        position: { ...HEALTHY_POSITION, coordinate: null, quality: "unavailable" },
      }),
    });

    expect(warnings.map((warning) => warning.id)).toContain("gps-unavailable");
    expect(warnings.find((warning) => warning.id === "gps-unavailable")?.severity).toBe("critical");
  });

  it("keeps a blocked permission critical and leaves the session controllable", () => {
    const { warnings, controls } = view({
      environment: environment({ locationPermission: "denied" }),
    });

    expect(warnings.find((warning) => warning.id === "location-denied")?.severity).toBe("critical");
    // 8 §3: Retry / Finish / Discard all remain available.
    expect(controls.retryLocation.enabled).toBe(true);
    expect(controls.finish.enabled).toBe(true);
    expect(controls.discard.enabled).toBe(true);
  });

  it("surfaces a wake-lock failure and an unsupported browser as cautions, not blockers", () => {
    const failed = view({ environment: environment({ wakeLock: "failed" }) });
    expect(failed.warnings.find((warning) => warning.id === "wake-lock")?.severity).toBe("caution");
    expect(failed.controls.pause.enabled).toBe(true);

    const unsupported = view({ environment: environment({ wakeLock: "unsupported" }) });
    expect(unsupported.warnings.find((warning) => warning.id === "wake-lock")?.text).toContain(
      "can't keep the screen awake",
    );
  });

  it("surfaces a speech failure without ending the ride", () => {
    const { warnings, terminal } = view({ environment: environment({ speech: "failed" }) });

    expect(warnings.find((warning) => warning.id === "speech")?.severity).toBe("caution");
    expect(terminal).toBeNull();
  });

  it("carries route conditions through and drops the informational ones", () => {
    const { warnings } = view({
      routeWarnings: [
        { id: "w1", code: "closure", severity: "blocking", message: "Bridge closed." },
        { id: "w2", code: "surface", severity: "warning", message: "Loose gravel ahead." },
        { id: "w3", code: "note", severity: "info", message: "Scenic." },
      ],
    });

    expect(warnings.filter((warning) => warning.id.startsWith("route:"))).toHaveLength(2);
    expect(warnings.find((warning) => warning.id === "route:w1")?.severity).toBe("critical");
    expect(warnings.find((warning) => warning.id === "route:w3")).toBeUndefined();
  });

  it("names the location state in words", () => {
    expect(permissionLabel("denied")).toBe("Location blocked");
    expect(permissionLabel("unsupported")).toBe("Location unsupported");
  });
});

describe("controls (08 §2, §13)", () => {
  it("offers pause while moving and resume while paused, each with a reason when refused", () => {
    const moving = view();
    expect(moving.controls.pause.enabled).toBe(true);
    expect(moving.controls.resume.enabled).toBe(false);
    expect(moving.controls.resume.reason).toBe("The ride is already moving.");

    const paused = view({
      navigation: navigation({ activity: "paused", resumeActivity: "guided" }),
    });
    expect(paused.controls.pause.enabled).toBe(false);
    expect(paused.controls.resume.enabled).toBe(true);
  });

  it("refuses recenter and follow without a position, and says why", () => {
    const { controls } = view({
      navigation: navigation({
        position: { ...HEALTHY_POSITION, coordinate: null, quality: "unavailable" },
      }),
    });

    expect(controls.recenter.enabled).toBe(false);
    expect(controls.follow.enabled).toBe(false);
    expect(controls.recenter.reason).toBe("There is no position to center on yet.");
  });

  it("refuses recenter while the map is not up, naming the map", () => {
    const { controls } = view({ mapReady: false });

    expect(controls.recenter.enabled).toBe(false);
    expect(controls.recenter.reason).toBe("The map isn't loaded yet.");
  });

  it("refuses stop once the ride has ended", () => {
    const { controls, terminal } = view({
      navigation: navigation({ activity: "completed", endReason: "completed", endedAt: NOW }),
    });

    expect(controls.finish.enabled).toBe(false);
    expect(controls.discard.enabled).toBe(false);
    expect(controls.finish.reason).toBe("The ride has already ended.");
    expect(terminal?.reason).toBe("completed");
    expect(terminal?.title).toBe("Ride finished");
  });

  it("tells a finished ride apart from a discarded one", () => {
    const { terminal } = view({
      navigation: navigation({ activity: "completed", endReason: "abandoned", endedAt: NOW }),
    });

    expect(terminal?.reason).toBe("abandoned");
    expect(terminal?.title).toBe("Ride discarded");
  });
});

describe("the finish summary", () => {
  const RIDE = {
    ...EMPTY_RECORDING_TELEMETRY,
    acceptedDistanceMeters: 16_093,
    movingMs: 30 * 60_000,
    maxSpeedMps: 22.352,
  };

  it("puts a finished ride's numbers on the terminal, and none on a discarded one", () => {
    const finished = buildRideFocusViewModel({
      navigation: navigation({ activity: "completed", endReason: "completed", endedAt: NOW }),
      environment: environment(),
      telemetry: null,
      liveTelemetry: RIDE,
      now: NOW,
    }).terminal;
    expect(finished?.reason).toBe("completed");
    const stats = finished?.reason === "completed" ? finished.stats ?? [] : [];
    expect(stats.map((stat) => [stat.id, stat.value])).toEqual([["distance", "10"], ["moving", "30"], ["average", "20"], ["max", "50"]]);

    const discarded = buildRideFocusViewModel({
      navigation: navigation({ activity: "completed", endReason: "abandoned", endedAt: NOW }),
      environment: environment(),
      telemetry: null,
      liveTelemetry: RIDE,
      now: NOW,
    }).terminal;
    expect(discarded).not.toHaveProperty("stats");
  });
});

describe("the posted speed limit (NV-04)", () => {
  const TELEMETRY = {
    routeProgress: 0.2,
    remainingDistanceMeters: 10_000,
    remainingDurationSeconds: 900,
    etaIso: "2026-09-21T14:15:00.000Z",
  };

  it("reads the OSM limit in US sign steps, and warns only past 5 mph over", () => {
    // 14.2 m/s ≈ 32 mph against a 35 mph (56 km/h) sign: not over.
    expect(view({ telemetry: { ...TELEMETRY, speedLimitKmh: 56 } }).speedLimit).toEqual({ mph: 35, over: false });
    // Against 25 mph (40 km/h): 7 over.
    expect(view({ telemetry: { ...TELEMETRY, speedLimitKmh: 40 } }).speedLimit).toEqual({ mph: 25, over: true });
  });

  it("shows no sign where none is mapped, off a guided ride, or on a stale fix", () => {
    expect(view({ telemetry: TELEMETRY }).speedLimit).toBeNull();
    expect(view({ telemetry: { ...TELEMETRY, speedLimitKmh: null } }).speedLimit).toBeNull();
    expect(
      view({ navigation: navigation({ activity: "free" }), telemetry: { ...TELEMETRY, speedLimitKmh: 56 } }).speedLimit,
    ).toBeNull();
    const stale = navigation({
      position: { ...HEALTHY_POSITION, ageMs: 42_000, speedMps: null, headingDegrees: null, quality: "stale" },
    });
    expect(view({ navigation: stale, telemetry: { ...TELEMETRY, speedLimitKmh: 56 } }).speedLimit).toBeNull();
  });
});
