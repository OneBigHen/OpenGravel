/**
 * The ride or hike on the phone's Lock Screen and Dynamic Island (iOS Live
 * Activity).
 *
 * The native side only lays out what it is given, so every word is decided
 * here, from the same view model the ride screen draws. Three kinds:
 *
 * - `guided`: the next maneuver, the distance to it, the road, ETA and what is
 *   left.
 * - `free`: a Free Ride or a recording, which has no maneuver: elapsed time,
 *   distance and speed.
 * - `hike`: following a breadcrumb trail on foot: distance left, ETA when
 *   known, the climb so far, the straight-line way back to the start, and a
 *   warning when off the trail.
 *
 * A turn the app speaks also lights the Lock Screen with an alert, the way
 * Apple Maps does. Updates are throttled: the phone rations how often an app
 * may update an activity, and nothing here is worth spending that on.
 */

import type { BreadcrumbNavigationWaypoint } from "@/application/persistence/ride-focus-pointer";
import type { RideFocusViewModel } from "@/application/ride-session/ride-focus-view-model";
import { formatDistance } from "@/application/planner/measurements";
import { haversine } from "@/domain/geometry/analysis";
import type { SessionNavigationState } from "@/domain/ride-session/navigation";

export type LiveActivityKind = "guided" | "free" | "hike";

export interface LiveActivityState {
  readonly kind: LiveActivityKind;
  /** "left", "right", "slight-left", "slight-right", "straight", "uturn", "continue", "arrive", or "" when there is none. */
  readonly glyph: string;
  /** "in 0.3 mi", "now", or "". */
  readonly distance: string;
  /** "Turn left", or a status line such as "Free ride" or "Next: Overlook". */
  readonly action: string;
  /** "onto Hawk Mountain Rd", or "". */
  readonly road: string;
  /** "3:42 PM", or "". */
  readonly eta: string;
  /** "24 mi · 41 min" (guided), "3.2 mi" (hike), or "". */
  readonly remaining: string;
  /** 0–1 along the route, or -1 when unknown. */
  readonly progress: number;
  /** "Off the trail", or "". */
  readonly warning: string;
  /** Seconds recorded so far, or -1 when there is no recording clock. The Lock Screen counts on from it by itself. */
  readonly elapsedSeconds: number;
  /** Distance travelled so far, or "". */
  readonly distanceDone: string;
  /** "42 mph", or "". */
  readonly speed: string;
  /** Climb so far, "820 ft", or "". */
  readonly gain: string;
  /** Straight-line distance back to where the trail began, or "". */
  readonly toStart: string;
}

export interface LiveActivityAlert {
  readonly title: string;
  readonly body: string;
}

/** The native Live Activity, or a no-op outside the app. */
export interface LiveActivityPort {
  start(title: string, state: LiveActivityState): Promise<void>;
  update(state: LiveActivityState, alert?: LiveActivityAlert): Promise<void>;
  end(): Promise<void>;
}

/** What the mapper reads; all of it is already on the ride screen's store. */
export interface LiveActivityInput {
  readonly viewModel: RideFocusViewModel | null;
  readonly navigation: SessionNavigationState | null;
  readonly breadcrumbWaypoints: readonly BreadcrumbNavigationWaypoint[] | null;
  /** The planning activity (ride or hike); a followed trail on foot is a hike. */
  readonly hiking: boolean;
}

const UNKNOWN = new Set(["Unknown", "—", ""]);
const known = (text: string | null | undefined): string => (text === null || text === undefined || UNKNOWN.has(text.trim()) ? "" : text);

/** "12:34" or "1:02:03" back to seconds; `-1` when it is not a clock. */
export function clockSeconds(text: string): number {
  const parts = text.trim().split(":");
  if (parts.length < 2 || parts.length > 3 || parts.some((part) => !/^\d{1,2}$/.test(part))) return -1;
  return parts.reduce((total, part) => total * 60 + Number(part), 0);
}

/** Past the next waypoint by this much along the trail, so the waypoint underfoot is not "next". */
const WAYPOINT_PASSED_METERS = 15;

/** The off-route states that read as "off the trail" on foot. */
const OFF_TRAIL = new Set(["off-route", "rejoining"]);

const BLANK: Omit<LiveActivityState, "kind"> = {
  glyph: "", distance: "", action: "", road: "", eta: "", remaining: "", progress: -1,
  warning: "", elapsedSeconds: -1, distanceDone: "", speed: "", gain: "", toStart: "",
};

function progressOf(viewModel: RideFocusViewModel): number {
  const fraction = viewModel.progress.fraction;
  return fraction === null || !Number.isFinite(fraction) ? -1 : Math.round(fraction * 100) / 100;
}

function hikeState(input: LiveActivityInput, viewModel: RideFocusViewModel, waypoints: readonly BreadcrumbNavigationWaypoint[]): LiveActivityState {
  const navigation = input.navigation;
  const position = navigation !== null && (navigation.position.quality === "fresh-good" || navigation.position.quality === "fresh-poor")
    ? navigation.position.coordinate
    : null;
  const fraction = viewModel.progress.fraction;
  const total = waypoints.at(-1)?.distanceAlongMeters ?? 0;
  const along = fraction === null || !Number.isFinite(fraction) ? null : fraction * total;
  const next = along === null
    ? null
    : waypoints.find((point, index) => index > 0 && point.distanceAlongMeters > along + WAYPOINT_PASSED_METERS) ?? waypoints.at(-1) ?? null;
  const left = along === null || total <= 0 ? "" : formatDistance(Math.max(0, total - along));
  const off = navigation !== null && navigation.offRouteState !== null && OFF_TRAIL.has(navigation.offRouteState);
  return {
    ...BLANK,
    kind: "hike",
    distance: position === null || next === null ? "" : known(formatDistance(haversine(position, next.coordinate))),
    action: position === null ? "Waiting for location" : next === null ? "Following the trail" : next.name || "Next waypoint",
    eta: known(viewModel.secondary.etaText),
    remaining: left === "Unknown" ? "" : left,
    progress: progressOf(viewModel),
    warning: off ? "Off the trail" : "",
    gain: viewModel.climbGainText ?? "",
    toStart: position === null || waypoints[0] === undefined ? "" : known(formatDistance(haversine(position, waypoints[0].coordinate))),
  };
}

function freeState(viewModel: RideFocusViewModel): LiveActivityState {
  const hud = viewModel.recording;
  return {
    ...BLANK,
    kind: "free",
    action: viewModel.activityLabel,
    elapsedSeconds: hud === null || hud.waitingForFix ? -1 : clockSeconds(hud.elapsedTimeText),
    distanceDone: hud === null ? "" : known(hud.distanceText),
    speed: known(viewModel.position.speedText ?? hud?.currentSpeedText),
    gain: viewModel.climbGainText ?? "",
    progress: progressOf(viewModel),
  };
}

function guidedState(viewModel: RideFocusViewModel): LiveActivityState {
  const guidance = viewModel.guidance;
  const maneuver = guidance.kind === "maneuver" ? guidance.maneuver : null;
  const road = maneuver === null || maneuver.roadName === null
    ? ""
    : `${maneuver.roadPreposition === "on" ? "on" : "onto"} ${maneuver.roadName}`;
  const action = maneuver !== null
    ? maneuver.actionText
    : guidance.kind === "suspended"
      ? guidance.text
      : "Follow the route";
  return {
    ...BLANK,
    kind: "guided",
    glyph: maneuver?.glyph ?? "",
    distance: maneuver?.distanceText ?? "",
    action,
    road,
    eta: known(viewModel.secondary.etaText),
    remaining: known(viewModel.secondary.remainingText),
    progress: progressOf(viewModel),
  };
}

/** What the Lock Screen shows now, or `null` when no ride or hike is live. */
export function liveActivityState(input: LiveActivityInput): { readonly title: string; readonly state: LiveActivityState } | null {
  const viewModel = input.viewModel;
  if (viewModel === null || viewModel.terminal !== null || viewModel.activity === "completed") return null;
  const navigation = input.navigation;
  const waypoints = input.breadcrumbWaypoints;
  const followingTrail = waypoints !== null && waypoints.length > 0 && navigation !== null &&
    (navigation.activity === "track" || navigation.resumeActivity === "track");
  if (followingTrail && input.hiking) {
    return { title: viewModel.activity === "paused" ? "Hike paused" : "Hike", state: hikeState(input, viewModel, waypoints) };
  }
  const free = viewModel.activity === "free" || followingTrail ||
    (viewModel.activity === "paused" && navigation?.plan.route === null);
  return { title: viewModel.activityLabel, state: free ? freeState(viewModel) : guidedState(viewModel) };
}

/** Everything that matters for "did this change enough to spend an update"; the ticking clock is the phone's. */
function sameContent(a: LiveActivityState, b: LiveActivityState): boolean {
  return a.kind === b.kind && a.glyph === b.glyph && a.distance === b.distance && a.action === b.action &&
    a.road === b.road && a.eta === b.eta && a.remaining === b.remaining && a.progress === b.progress &&
    a.warning === b.warning && (a.elapsedSeconds < 0) === (b.elapsedSeconds < 0) && a.distanceDone === b.distanceDone &&
    a.speed === b.speed && a.gain === b.gain && a.toStart === b.toStart;
}

/** A new maneuver, a new waypoint, or a warning appearing or clearing: worth an update at once. */
const urgentKey = (state: LiveActivityState): string => `${state.kind}|${state.glyph}|${state.action}|${state.road}|${state.warning}`;

export const LIVE_ACTIVITY_MIN_INTERVAL_MS = 5_000;

export interface LiveActivitySyncOptions {
  /** Whether the rider wants a Lock Screen activity (Settings); read on every sync. */
  readonly enabled?: () => boolean;
  readonly now?: () => number;
  readonly minIntervalMs?: number;
  readonly schedule?: (run: () => void, delayMs: number) => unknown;
  readonly unschedule?: (handle: unknown) => void;
}

/**
 * Keeps the Live Activity in step with the ride: starts it with the first live
 * state, sends real changes no more often than every five seconds unless the
 * maneuver or a warning changed, and ends it when the ride or hike ends or the
 * rider turns it off. A change that has to wait is sent when the wait is over.
 * Failures are swallowed: the Lock Screen is a convenience, never a reason a
 * ride stops.
 */
export function createLiveActivitySync(port: LiveActivityPort, options: LiveActivitySyncOptions = {}) {
  const enabled = options.enabled ?? (() => true);
  const now = options.now ?? Date.now;
  const minInterval = options.minIntervalMs ?? LIVE_ACTIVITY_MIN_INTERVAL_MS;
  const schedule = options.schedule ?? ((run: () => void, delay: number) => setTimeout(run, delay));
  const unschedule = options.unschedule ?? ((handle: unknown) => clearTimeout(handle as ReturnType<typeof setTimeout>));
  let running = false;
  /** The newest state the rider's phone should show. */
  let wanted: LiveActivityState | null = null;
  /** What the phone was last sent, and when. */
  let sent: LiveActivityState | null = null;
  let sentAt = 0;
  let timer: unknown = null;
  let chain: Promise<unknown> = Promise.resolve();
  const enqueue = (work: () => Promise<void>): void => {
    chain = chain.then(work).catch(() => undefined);
  };
  const cancelTimer = (): void => {
    if (timer === null) return;
    unschedule(timer);
    timer = null;
  };
  const push = (state: LiveActivityState): void => {
    cancelTimer();
    sent = state;
    sentAt = now();
    enqueue(() => port.update(state));
  };
  const stop = (): void => {
    cancelTimer();
    if (!running) return;
    running = false;
    wanted = null;
    sent = null;
    enqueue(() => port.end());
  };
  return {
    /** Call with every new store state. */
    sync(input: LiveActivityInput): void {
      const next = enabled() ? liveActivityState(input) : null;
      if (next === null) return stop();
      wanted = next.state;
      if (!running || (sent !== null && sent.kind !== next.state.kind)) {
        // First live state, or the ride turned into a hike or a recording: a fresh activity.
        if (running) enqueue(() => port.end());
        cancelTimer();
        running = true;
        sent = next.state;
        sentAt = now();
        enqueue(() => port.start(next.title, next.state));
        return;
      }
      if (sent !== null && sameContent(sent, next.state)) {
        cancelTimer();
        return;
      }
      if (sent === null || urgentKey(sent) !== urgentKey(next.state) || now() - sentAt >= minInterval) {
        push(next.state);
        return;
      }
      if (timer === null) {
        timer = schedule(() => {
          timer = null;
          if (running && wanted !== null && (sent === null || !sameContent(sent, wanted))) push(wanted);
        }, Math.max(0, minInterval - (now() - sentAt)));
      }
    },
    /** A turn was just announced: light the Lock Screen with it, now. */
    alert(alert: LiveActivityAlert): void {
      if (!running || wanted === null) return;
      const state = wanted;
      cancelTimer();
      sent = state;
      sentAt = now();
      enqueue(() => port.update(state, alert));
    },
    /** Resolves once queued native calls have settled (tests, teardown). */
    flush(): Promise<unknown> {
      return chain;
    },
    /** The ride screen is going away: end the activity. */
    dispose(): void {
      stop();
    },
  };
}
