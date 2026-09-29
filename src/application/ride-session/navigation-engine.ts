/**
 * RideSession-facing navigation coordinator (08 §3–§9).
 *
 * The engine owns no physical-activity state. It reads the existing controller,
 * dispatches ordinary position/instruction events through it, and keeps only
 * replaceable projections and resource status. A resolved route must match the
 * session's revision-fenced binding before any GPS watch starts.
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
    if (model === null) return;

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
      frame.offRouteState !== "on-route" ||
      issuedInstructions.has(maneuver.instructionId)
    ) {
      return;
    }

    const instruction = {
      instructionId: maneuver.instructionId,
      kind: maneuver.kind,
      maneuver: maneuver.maneuver,
      roadName: maneuver.roadName,
      distanceMeters: frame.distanceToManeuverMeters ?? 0,
      targetStopId: maneuver.targetStopId,
    };
    const issued = await options.session.dispatch(
      instructionIssuedEvent(instruction, eventAt),
    );
    if (issued.outcome !== "applied") return;
    issuedInstructions.add(maneuver.instructionId);
    await speech.announce(instruction);
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

  function routeMatchesSession(): boolean {
    const navigation = options.session.navigationState();
    if (navigation === null) {
      message = "There is no active RideSession to navigate.";
      return false;
    }
    if (navigation.activity === "guided" || navigation.resumeActivity === "guided") {
      if (options.route?.mode !== "guided" || !sameBinding(navigation.plan.route, options.route.binding)) {
        message = "The resolved route does not match the RideSession binding.";
        return false;
      }
    }
    if (navigation.activity === "track" || navigation.resumeActivity === "track") {
      if (options.route?.mode !== "track") {
        message = "The resolved track does not match the RideSession activity.";
        return false;
      }
    }
    if (navigation.activity === "free" || navigation.resumeActivity === "free") {
      if (options.route !== null) {
        message = "Free Ride cannot be driven by a bound navigation route.";
        return false;
      }
    }
    return true;
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
        position: positionState,
        frame,
        speech: speech.snapshot(),
        wakeLock: wakeLock.snapshot(),
        aheadGuidanceSuspended:
          !sourceUsable || navigation === null || navigation.aheadGuidanceSuspended,
      };
    },

    async start(): Promise<boolean> {
      if (!routeMatchesSession()) {
        status = "failed";
        return false;
      }
      if (routeFailure !== null) {
        status = "failed";
        message = routeFailure;
        return false;
      }
      await this.syncLifecycle();
      return true;
    },

    async syncLifecycle(): Promise<void> {
      const navigation = options.session.navigationState();
      if (navigation === null) {
        status = "failed";
        message = "There is no active RideSession to navigate.";
        await Promise.all([position.stop(), wakeLock.release()]);
        return;
      }
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
