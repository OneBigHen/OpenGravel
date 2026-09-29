/**
 * The ride on the phone's Lock Screen and Dynamic Island (iOS Live Activity).
 *
 * The native side only lays out text it is given, so every word is decided
 * here, from the same view model the ride screen draws: the next maneuver, the
 * distance to it, the road, ETA and what is left. A turn the app speaks also
 * lights the Lock Screen with an alert, the way Apple Maps does.
 */

import type { RideFocusViewModel } from "./ride-focus-view-model";

export interface RideActivityState {
  readonly glyph: string;
  readonly distance: string;
  readonly action: string;
  readonly road: string;
  readonly eta: string;
  readonly remaining: string;
  /** 0–1 along the route, or -1 when unknown. */
  readonly progress: number;
}

export interface RideActivityAlert {
  readonly title: string;
  readonly body: string;
}

/** The native Live Activity, or a no-op outside the app. */
export interface RideActivityPort {
  start(title: string, state: RideActivityState): Promise<void>;
  update(state: RideActivityState, alert?: RideActivityAlert): Promise<void>;
  end(): Promise<void>;
}

const UNKNOWN = new Set(["Unknown", "—", ""]);
const known = (text: string): string => (UNKNOWN.has(text.trim()) ? "" : text);

/** What the Lock Screen shows now, or `null` when no ride is live. */
export function rideActivityState(viewModel: RideFocusViewModel | null): { readonly title: string; readonly state: RideActivityState } | null {
  if (viewModel === null || viewModel.terminal !== null || viewModel.activity === "completed") return null;
  const guidance = viewModel.guidance;
  const maneuver = guidance.kind === "maneuver" ? guidance.maneuver : null;
  const road = maneuver === null || maneuver.roadName === null
    ? ""
    : `${maneuver.roadPreposition === "on" ? "on" : "onto"} ${maneuver.roadName}`;
  const action = maneuver !== null
    ? maneuver.actionText
    : guidance.kind === "suspended"
      ? guidance.text
      : viewModel.activity === "free"
        ? "Riding your own way"
        : "Follow the route";
  const fraction = viewModel.progress.fraction;
  return {
    title: viewModel.activityLabel,
    state: {
      glyph: maneuver?.glyph ?? "",
      distance: maneuver?.distanceText ?? "",
      action,
      road,
      eta: known(viewModel.secondary.etaText),
      remaining: known(viewModel.secondary.remainingText),
      progress: fraction === null || !Number.isFinite(fraction) ? -1 : Math.round(fraction * 100) / 100,
    },
  };
}

const same = (a: RideActivityState, b: RideActivityState): boolean =>
  a.glyph === b.glyph && a.distance === b.distance && a.action === b.action && a.road === b.road &&
  a.eta === b.eta && a.remaining === b.remaining && a.progress === b.progress;

/**
 * Keeps the Live Activity in step with the ride: starts it with the first live
 * state, sends only real changes, and ends it when the ride ends. Failures are
 * swallowed: the Lock Screen is a convenience, never a reason a ride stops.
 */
export function createRideActivitySync(port: RideActivityPort) {
  let running = false;
  let last: RideActivityState | null = null;
  let chain: Promise<unknown> = Promise.resolve();
  const enqueue = (work: () => Promise<void>): void => {
    chain = chain.then(work).catch(() => undefined);
  };
  return {
    /** Call with every new view model. */
    sync(viewModel: RideFocusViewModel | null): void {
      const next = rideActivityState(viewModel);
      if (next === null) {
        if (!running) return;
        running = false;
        last = null;
        enqueue(() => port.end());
        return;
      }
      if (!running) {
        running = true;
        last = next.state;
        enqueue(() => port.start(next.title, next.state));
        return;
      }
      if (last !== null && same(last, next.state)) return;
      last = next.state;
      enqueue(() => port.update(next.state));
    },
    /** A turn was just announced: light the Lock Screen with it. */
    alert(alert: RideActivityAlert): void {
      if (!running || last === null) return;
      const state = last;
      enqueue(() => port.update(state, alert));
    },
    /** Resolves once queued native calls have settled (tests, teardown). */
    flush(): Promise<unknown> {
      return chain;
    },
  };
}
