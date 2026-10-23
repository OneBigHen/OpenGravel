/**
 * RideSession-facing navigation coordinator (08 §3–§9).
 *
 * The engine owns no physical-activity state. It reads the existing controller,
 * dispatches ordinary position/instruction events through it, and keeps only
 * replaceable projections and resource status. Tracking and guidance are
 * separate: a resolved route must match the session's revision-fenced binding
 * before the engine issues any maneuver, but the position pipeline that moves
 * and records the ride starts even when the route is missing or unusable, and
 * the engine then says guidance is off rather than failing the ride.
 */

import {
  buildProgressModel,
  matchRouteProgress,
  type ProgressFrame,
  type ProgressRoute,
} from "@/domain/ride-session/progress";
import {
  instructionIssuedEvent,
  offRouteChangedEvent,
  positionUpdatedEvent,
} from "@/domain/ride-session/create";
import type { SessionRouteBinding } from "@/domain/ride-session/types";
import type { PositionFix, RideSessionState } from "@/domain/ride-session/types";
import type { RideSessionController } from "./ride-session-controller";
import {
  createPositionPipeline,
  type PositionPipeline,
  type PositionPipelineState,
  type PositionSource,
} from "./position-pipeline";
import {
  createSpeechCoordinator,
  type SpeechCoordinator,
  type SpeechCue,
  type SpeechPort,
  type SpeechState,
} from "./speech";
import {
  createWakeLockCoordinator,
  type WakeLockCoordinator,
  type WakeLockPort,
  type WakeLockState,
} from "./wake-lock";

export interface ResolvedNavigationRoute extends ProgressRoute {
  /** Required for guided routes; absent for a track-only imported line. */
  readonly binding?: SessionRouteBinding | null;
}

export interface RideNavigationEngineOptions {
  readonly session: RideSessionController;
  /** `null` is valid for Free Ride: GPS continues without route progress. */
  readonly route: ResolvedNavigationRoute | null;
  readonly positionSource: PositionSource;
  readonly speech?: SpeechPort;
  readonly wakeLock?: WakeLockPort | null;
  /** Accepted positions are sent to the recording authority after session journaling. */
  readonly onAcceptedFix?: (fix: PositionFix, state: RideSessionState) => Promise<void> | void;
  /**
   * Every fix the session applied, recording or not, before the recording
   * hand-off (Free Ride live telemetry folds these). Synchronous and must not throw.
   */
  readonly onSessionFix?: (fix: PositionFix, state: RideSessionState) => void;
  /** Receipt clock for journal events; GPS observation time stays on the fix. */
  readonly now?: () => string;
}

export interface RideNavigationEngineState {
  readonly status: "idle" | "active" | "paused" | "stopped" | "failed";
  readonly message: string | null;
  /**
   * True when this engine can match the session's route. `false` means the ride
   * still tracks (position, recording, map, progress) but turn-by-turn guidance
   * is off, and {@link guidanceMessage} says why in rider words. A missing or
   * unusable route is not a failed ride (8 §3, §13).
   */
  readonly guidanceAvailable: boolean;
  readonly guidanceMessage: string | null;
  readonly position: PositionPipelineState;
  readonly frame: ProgressFrame | null;
  readonly speech: SpeechState;
  readonly wakeLock: WakeLockState;
  readonly aheadGuidanceSuspended: boolean;
}

export interface RideNavigationEngine {
  snapshot(): RideNavigationEngineState;
  /** Starts resources for the controller's current activity. */
  start(): Promise<boolean>;
  /** Reconciles GPS/wake resources after pause, resume, completion or recovery. */
  syncLifecycle(): Promise<void>;
  /**
   * Restarts the position source the ride already uses, when it is running
   * (DV-05, DV-10): a stalled native watcher is replaced, never supplemented.
   */
  retryPosition?(): Promise<void>;
  /** Stops engine resources without ending or mutating the RideSession. */
  stop(): Promise<void>;
  flush(): Promise<void>;
}

function sameBinding(
  first: SessionRouteBinding | null,
  second: SessionRouteBinding | null | undefined,
): boolean {
  return (
    first !== null &&
    second !== null &&
    second !== undefined &&
    first.routeId === second.routeId &&
    first.planningGeneration === second.planningGeneration
  );
}

export function createRideNavigationEngine(
  options: RideNavigationEngineOptions,
): RideNavigationEngine {
  let model: ReturnType<typeof buildProgressModel> | null = null;
  let routeFailure: string | null = null;
  if (options.route !== null) {
    try {
      model = buildProgressModel(options.route);
    } catch {
      routeFailure = "The resolved route has no usable geometry.";
    }
  }
  const speech: SpeechCoordinator = createSpeechCoordinator(
    options.speech ?? null,
  );
  const wakeLock: WakeLockCoordinator = createWakeLockCoordinator(
    options.wakeLock ?? null,
  );
  const issuedInstructions = new Set<string>();
  const now = options.now ?? ((): string => new Date().toISOString());
  let frame: ProgressFrame | null = null;
  let status: RideNavigationEngineState["status"] = "idle";
  let message: string | null = null;
  /** Why turn guidance is off while the ride keeps tracking; `null` when usable. */
  let guidanceMessage: string | null = null;
  let chain: Promise<unknown> = Promise.resolve();
  // null means this source is plain GPS and the web matcher owns deviation.
  // Once a native navigator reports deviation, its verdict is authoritative
  // for that engine lifetime so native UI and automatic rerouting agree.
  let sourceOffRoute: boolean | null = null;

  async function handleSourceRouteDeviation(offRoute: boolean): Promise<void> {
    sourceOffRoute = offRoute;
    const navigation = options.session.navigationState();
    if (navigation === null || navigation.activity !== "guided") return;
    const state = offRoute ? "off-route" : "on-route";
    if (navigation.offRouteState === state) return;
    await options.session.dispatch(offRouteChangedEvent(state, now()));
  }

  async function handleFix(fix: PositionPipelineState["lastFix"]): Promise<void> {
    if (fix === null) return;
    const navigationBefore = options.session.navigationState();
    if (
      navigationBefore === null ||
      navigationBefore.activity === "paused" ||
      navigationBefore.activity === "completed"
    ) {
      return;
    }
    const eventAt = now();
    const positioned = await options.session.dispatch(positionUpdatedEvent(fix, eventAt));
    if (positioned.outcome !== "applied") return;
    const appliedState = options.session.snapshot();
    if (appliedState !== null) {
      try {
        options.onSessionFix?.(fix, appliedState);
      } catch {
        // A telemetry observer never stops navigation.
      }
    }
    if (appliedState !== null && appliedState.recordingId !== null) {
      await options.onAcceptedFix?.(fix, appliedState);
    }
    const navigation = options.session.navigationState();
    if (
      navigation === null ||
      navigation.position.quality === "stale" ||
      navigation.position.quality === "unavailable"
    ) {
      return;
    }
    // A route this engine may not guide by is not matched at all: matching it
    // would let a foreign line decide the ride's off-route state.
    if (model === null || guidanceMessage !== null) return;

    const matchedFrame = matchRouteProgress(model, fix, frame ?? undefined);
    frame = sourceOffRoute === null
      ? matchedFrame
      : {
          ...matchedFrame,
          offRouteState: sourceOffRoute ? "off-route" : "on-route",
        };
    // Browser/plain GPS uses the web continuity matcher. A native navigator
    // that reports deviation owns this verdict instead: Ferrostar\'s
    // "Return to the Route" state must be the same state that wakes rerouting.
    if (sourceOffRoute === null && navigation.offRouteState !== frame.offRouteState) {
      await options.session.dispatch(offRouteChangedEvent(frame.offRouteState, eventAt));
    }
    const maneuver = frame.nextManeuver;
    if (
      maneuver === null ||
      options.route?.mode !== "guided" ||
      navigation.activity !== "guided" ||
      frame.offRouteState !== "on-route"
    ) {
      return;
    }

    // The matcher's own measurement of this frame, never a stored snapshot: a
    // card or a sentence built from the distance at issue time freezes at the
    // leg's first length (8 §6, DV-06).
    const distanceMeters = frame.distanceToManeuverMeters;
    if (distanceMeters === null) return;
    const cue: SpeechCue = {
      instructionId: maneuver.instructionId,
      kind: maneuver.kind,
      maneuver: maneuver.maneuver,
      roadName: maneuver.roadName,
      ...(maneuver.exitNumber === undefined || maneuver.exitNumber === null
        ? {}
        : { exitNumber: maneuver.exitNumber }),
      distanceMeters,
      targetStopId: maneuver.targetStopId,
    };
    if (!issuedInstructions.has(maneuver.instructionId)) {
      const issued = await options.session.dispatch(
        instructionIssuedEvent(cue, eventAt),
      );
      if (issued.outcome !== "applied") return;
      issuedInstructions.add(maneuver.instructionId);
    }
    // Offered on every fix; the coordinator speaks one maneuver once per
    // distance band (2 mi, 0.5 mi, 100 m) and nothing after it is passed.
    await speech.announce(cue);
  }

  const position: PositionPipeline = createPositionPipeline({
    source: options.positionSource,
    onRouteDeviation(offRoute) {
      const run = chain.then(() => handleSourceRouteDeviation(offRoute));
      chain = run.then(
        () => undefined,
        () => undefined,
      );
      return run;
    },
    onFix(fix) {
      const run = chain.then(() => handleFix(fix));
      chain = run.then(
        () => undefined,
        () => undefined,
      );
      return run;
    },
  });

  /**
   * Whether this engine may produce turn-by-turn guidance for the session. A
   * route that is missing, unusable, or bound to another answer turns guidance
   * off; it never stops the position pipeline that moves and records the ride.
   */
  function guidanceFailure(): string | null {
    const navigation = options.session.navigationState();
    if (navigation === null) return "There is no active RideSession to navigate.";
    const activity =
      navigation.activity === "paused" ? navigation.resumeActivity : navigation.activity;
    if (activity === "guided") {
      if (options.route === null) {
        return "The route line isn't available, so turn-by-turn guidance is off. Your ride is still tracking.";
      }
      if (
        options.route.mode !== "guided" ||
        !sameBinding(navigation.plan.route, options.route.binding)
      ) {
        return "The resolved route does not match the RideSession binding, so turn-by-turn guidance is off. Your ride is still tracking.";
      }
    }
    if (activity === "track" && options.route?.mode !== "track") {
      return "The resolved track does not match the RideSession activity, so track guidance is off. Your ride is still tracking.";
    }
    if (activity === "free" && options.route !== null) {
      return "Free Ride cannot be driven by a bound navigation route, so turn-by-turn guidance is off. Your ride is still tracking.";
    }
    return routeFailure;
  }

  async function activate(): Promise<void> {
    status = "active";
    message = null;
    await Promise.all([position.start(), wakeLock.acquire()]);
  }

  return {
    snapshot(): RideNavigationEngineState {
      const positionState = position.snapshot();
      const navigation = options.session.navigationState();
      const sourceUsable =
        positionState.status === "tracking" || positionState.status === "recovered";
      return {
        status,
        message,
        guidanceAvailable: guidanceMessage === null,
        guidanceMessage,
        position: positionState,
        frame,
        speech: speech.snapshot(),
        wakeLock: wakeLock.snapshot(),
        aheadGuidanceSuspended:
          !sourceUsable || navigation === null || navigation.aheadGuidanceSuspended,
      };
    },

    async start(): Promise<boolean> {
      if (options.session.navigationState() === null) {
        status = "failed";
        message = "There is no active RideSession to navigate.";
        return false;
      }
      // Tracking and guidance are separate promises: a guided ride whose line
      // did not resolve still records, moves and draws, with turn guidance off.
      await this.syncLifecycle();
      return true;
    },

    async syncLifecycle(): Promise<void> {
      const navigation = options.session.navigationState();
      if (navigation === null) {
        status = "failed";
        message = "There is no active RideSession to navigate.";
        guidanceMessage = message;
        await Promise.all([position.stop(), wakeLock.release()]);
        return;
      }
      guidanceMessage = guidanceFailure();
      if (navigation.activity === "paused") {
        status = "paused";
        await Promise.all([position.stop(), wakeLock.release()]);
        return;
      }
      if (navigation.activity === "completed") {
        status = "stopped";
        await Promise.all([position.stop(), wakeLock.release()]);
        return;
      }
      await activate();
    },

    async retryPosition(): Promise<void> {
      if (status !== "active") return;
      await position.retry();
    },

    async stop(): Promise<void> {
      status = "stopped";
      await Promise.all([position.stop(), wakeLock.release()]);
      await chain;
    },

    async flush(): Promise<void> {
      await position.flush();
      await chain;
      await options.session.flush();
    },
  };
}
