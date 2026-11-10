/**
 * Runs one track/scenario through the real navigation stack.
 *
 * The stack is the product's: `buildGuidedNavigationRoute` normalizes provider
 * instructions, `createRideSessionController` owns the session, the position
 * pipeline owns smoothing and derived speed, and the navigation engine owns
 * matching, progress, off-route state and speech. Only the GPS source and the
 * speech port are test doubles, and the GPS source is the committed replay above.
 */

import { buildGuidedNavigationRoute } from "@/application/ride-session/navigation-route";
import type { ResolvedNavigationRoute } from "@/application/ride-session/navigation-engine";
import type { ProgressFrame } from "@/domain/ride-session/progress";
import {
  createRideNavigationEngine,
  type RideNavigationEngine,
} from "@/application/ride-session/navigation-engine";
import {
  createRideSessionController,
  type RideSessionController,
} from "@/application/ride-session/ride-session-controller";
import type { SpeechCue } from "@/application/ride-session/speech";
import { defaultRideIntent } from "@/domain/ride/create";
import { newRideId, type PointId } from "@/domain/ride/ids";
import type { Coordinate, RideIntent } from "@/domain/ride/types";import type {
  RideSessionEvent,
  RideSessionState,
} from "@/domain/ride-session/types";
import { asRouteCandidateId } from "@/domain/route/ids";

import type { RideSimRoute, RideSimTrack } from "./fixtures";
import { createReplayPositionSource, type ReplayFix } from "./replay-position-source";
import {
  buildTimeline,
  type BuiltTimeline,
  type RideSimScenario,
} from "./track-timeline";

export interface CapturedCue {
  readonly cue: SpeechCue;
  readonly atMs: number;
  /** The engine's frame at the instant the cue was offered. */
  readonly frame: ProgressFrame | null;
}

export interface ScenarioRun {
  readonly track: RideSimTrack;
  readonly route: RideSimRoute;
  readonly resolved: ResolvedNavigationRoute;
  readonly timeline: BuiltTimeline;
  readonly fixes: readonly ReplayFix[];
  /** The exact coordinates the source emitted, noise included. */
  readonly observations: readonly Coordinate[];
  readonly frames: readonly (ProgressFrame | null)[];
  readonly events: readonly RideSessionEvent[];
  readonly cues: readonly CapturedCue[];
  readonly finalState: RideSessionState | null;
  readonly finalFrame: ProgressFrame | null;
  readonly guidanceAvailable: boolean;
  readonly guidanceMessage: string | null;
  /** The session snapshot immediately after the first off-route transition. */
  readonly firstOffRoute: { readonly at: string; readonly state: RideSessionState } | null;
  readonly authoredIntent: RideIntent;
  readonly startMs: number;
}

export interface RunScenarioOptions {
  readonly track: RideSimTrack;
  readonly route: RideSimRoute;
  readonly scenario: RideSimScenario;
  /** Simulated ride start; every observation instant derives from it. */
  readonly startMs: number;
}

function intentFor(route: RideSimRoute): RideIntent {
  const start = route.geometry[0];
  const finish = route.geometry[route.geometry.length - 1];
  if (start === undefined || finish === undefined) {
    throw new Error("a ride-sim route needs a start and a finish");
  }
  return {
    ...defaultRideIntent(),
    shape: "destination",
    start: {
      id: "pt_ride_sim_start" as PointId,
      kind: "start",
      coordinate: { ...start },
      provenance: { type: "derived", reason: "ride-sim track start" },
    },
    finish: {
      id: "pt_ride_sim_finish" as PointId,
      kind: "finish",
      coordinate: { ...finish },
      provenance: { type: "derived", reason: "ride-sim track finish" },
    },
  };
}

/** Records every dispatch while delegating the state machine to the controller. */
function instrument(
  controller: RideSessionController,
  events: RideSessionEvent[],
  onFirstOffRoute: (at: string, state: RideSessionState) => void,
): RideSessionController {
  const dispatch = async (event: RideSessionEvent) => {
    const result = await controller.dispatch(event);
    events.push(event);
    if (event.type === "off-route.changed" && event.state === "off-route" && result.state !== null) {
      onFirstOffRoute(event.at, result.state);
    }
    return result;
  };
  return new Proxy(controller, {
    get(target, property) {
      if (property === "dispatch") return dispatch;
      const value: unknown = Reflect.get(target, property, target);
      return typeof value === "function" ? value.bind(target) : value;
    },
  });
}

export async function runScenario(options: RunScenarioOptions): Promise<ScenarioRun> {
  const { track, route, scenario, startMs } = options;
  const timeline = buildTimeline(track, route, scenario, startMs);
  const replay = createReplayPositionSource({
    fixes: timeline.fixes,
    noise: scenario === "noise" ? { meters: 8, seed: track.noiseSeed } : null,
  });
  const clock = (): string => new Date(replay.nowMs()).toISOString();

  const routeId = asRouteCandidateId(`route_ride_sim_${track.id}`);
  const binding = { planningGeneration: 1, routeId };
  const controller = createRideSessionController({ now: clock });
  const events: RideSessionEvent[] = [];
  let firstOffRoute: { at: string; state: RideSessionState } | null = null;
  const session = instrument(controller, events, (at, state) => {
    firstOffRoute ??= { at, state };
  });
  const started = await controller.start({
    activity: "guided",
    rideId: newRideId(),
    rideRevision: 1,
    route: binding,
    at: new Date(startMs - 1_000).toISOString(),
  });
  if (started.outcome !== "applied") {
    throw new Error(`ride-sim could not start a guided session: ${started.message ?? started.code ?? "unknown"}`);
  }

  const resolved = buildGuidedNavigationRoute(binding, route.geometry, route.instructions);
  const cues: CapturedCue[] = [];
  let engine: RideNavigationEngine | null = null;
  const speech = {
    async speak(cue: SpeechCue): Promise<void> {
      cues.push({
        cue,
        atMs: replay.nowMs(),
        frame: engine?.snapshot().frame ?? null,
      });
    },
  };
  engine = createRideNavigationEngine({
    session,
    route: resolved,
    positionSource: replay,
    speech,
    wakeLock: null,
    now: clock,
  });
  await engine.start();

  const frames: (ProgressFrame | null)[] = [];
  await replay.playEach(async () => {
    await engine.flush();
    frames.push(engine.snapshot().frame);
  });
  await engine.flush();

  const snapshot = controller.snapshot();
  return {
    track,
    route,
    resolved,
    timeline,
    fixes: timeline.fixes,
    observations: replay.observations(),
    frames,
    events,
    cues,
    finalState: snapshot,
    finalFrame: engine.snapshot().frame,
    guidanceAvailable: engine.snapshot().guidanceAvailable,
    guidanceMessage: engine.snapshot().guidanceMessage,
    firstOffRoute,
    authoredIntent: intentFor(route),
    startMs,
  };
}
