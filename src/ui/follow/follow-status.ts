/**
 * What the follower's one card says (12-DESIGN-SYSTEM-RESPONSIVE-ACCESSIBILITY §4,
 * §15–§17; 08-RIDE-NAVIGATION-AND-FREE-RIDE §4).
 *
 * Pure, so every sentence a loved one reads is decided and tested without a
 * browser or a map. The rules are the same honesty rules the rider's own screen
 * follows:
 *
 * - **Unknown is never a number.** A fix with no speed shows no speed; a ride
 *   with no point yet says so instead of printing `0 mph`.
 * - **Stale is a state, not an absence.** More than three minutes without a point
 *   is said out loud ("they may be out of signal"), because a still dot on a map
 *   otherwise reads as "stopped, all fine".
 * - **Stopped is measured, not guessed.** A rider counts as stopped only when
 *   their own reported speeds have been under walking pace for two minutes.
 * - **An alert is the rider's screen's claim**, so the banner names the reason it
 *   sent and never diagnoses anything itself. `rider-cancelled` is not dressed up
 *   as an emergency.
 * - **A finish time the rider shared is a promise the clock judges.** Once it has
 *   passed, the card says "overdue" and how long — with the age of the newest fix
 *   beside it. It never softens that into "still riding" because a dot moved, and
 *   it never invents an overrun for a link that carried no finish time at all.
 */

import { expectedFinishState, timeLeftText, type ExpectedFinishState } from "@/domain/live/expected-finish";
import type { LiveAlertReason, LiveFollowSnapshot, LiveTrailPoint } from "@/domain/live/types";
import { LIVE_STALE_AFTER_MS } from "@/domain/live/types";

/** More than this without a point, and the page says the signal may be lost. */
export const STALE_AFTER_MS = LIVE_STALE_AFTER_MS;
/** Under this speed the rider is not travelling; `0.9 m/s` is about 2 mph. */
const STOPPED_SPEED_MPS = 0.9;
/** How long under walking pace before "stopped for …" is the honest sentence. */
const STOPPED_AFTER_MS = 2 * 60_000;
/** Metres per second → miles per hour, the app's one speed unit. */
const MPH_PER_MPS = 2.2369362920544;

/** The card's state. `waiting` is before the rider's first point arrives. */
export type FollowCardKind = "waiting" | "riding" | "stopped" | "paused" | "stale" | "finished" | "overdue" | "alert";

/** The red banner, when the rider's screen raised an alert. */
export interface FollowAlertBanner {
  /** e.g. "Possible crash detected at 3:41 PM — last known location". */
  readonly text: string;
  /**
   * True only when the rider's screen said this is an emergency (a possible
   * crash or an SOS). A cancelled ride keeps the banner but not the 911 button.
   */
  readonly emergency: boolean;
  /** Epoch milliseconds the alert was raised. */
  readonly at: number;
}

/** The one card's whole content, ready to render as text. */
export interface FollowCard {
  readonly kind: FollowCardKind;
  /** The headline, e.g. "Sam is riding". */
  readonly title: string;
  /** The supporting facts, e.g. "updated 40 s ago · 38 mph". Never empty. */
  readonly detail: string;
  readonly alert: FollowAlertBanner | null;
  /** The rider's own expected finish, or `null` when they shared none. */
  readonly plan: FollowPlanLine | null;
}

/** The rider's expected finish, as the card says it. */
export interface FollowPlanLine {
  /** e.g. "Expected finish 4:10 PM · 32 min left". */
  readonly text: string;
  /** True once the clock has passed it: the line is a warning, not a plan. */
  readonly late: boolean;
}

export interface FollowCardInput {
  readonly snapshot: LiveFollowSnapshot;
  /** Epoch milliseconds: the viewer's clock, passed in so the card is pure. */
  readonly now: number;
  /** BCP-47 locale for clock times; defaults to `en-US` for a stable reading. */
  readonly locale?: string;
}

/** `8300 → "8 s"`, `212000 → "3 min"`, `7 h → "7 h"`. */
function ageText(milliseconds: number): string {
  const seconds = Math.max(0, Math.round(milliseconds / 1000));
  if (seconds < 60) return `${seconds} s`;
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.round(minutes / 60);
  return `${hours} h`;
}

/** `"3:41 PM"` in the viewer's own timezone. */
export function clockText(at: number, locale = "en-US"): string {
  return new Intl.DateTimeFormat(locale, { hour: "numeric", minute: "2-digit" }).format(new Date(at));
}

/** `8.3 → "19 mph"`; an unreported speed is absent, never `0 mph`. */
function speedText(mps: number | null): string | null {
  if (mps === null || !Number.isFinite(mps) || mps < 0) return null;
  return `${Math.round(mps * MPH_PER_MPS)} mph`;
}

/** `0.62 → "62%"`; a battery the device did not report is absent. */
function batteryText(battery: number | null): string | null {
  if (battery === null || !Number.isFinite(battery) || battery < 0 || battery > 1) return null;
  return `${Math.round(battery * 100)}%`;
}

/**
 * How long the newest run of slow points has lasted, or `null` when the trail
 * cannot say (no speeds, or only one point).
 *
 * Walking backwards from the newest point keeps the run contiguous: a gap or a
 * fast point ends it, so a rider who stopped, rolled on and stopped again is
 * timed from the latest stop rather than the first.
 */
function stoppedForMs(trail: readonly LiveTrailPoint[]): number | null {
  const last = trail[trail.length - 1];
  if (last === undefined || last.speed === null) return null;
  let start = last.t;
  for (let index = trail.length - 1; index >= 0; index -= 1) {
    const point = trail[index];
    if (point === undefined) break;
    if (point.speed === null || point.speed >= STOPPED_SPEED_MPS) break;
    start = point.t;
  }
  return Math.max(0, last.t - start);
}

/** The banner sentence for one reason, in plain words. */
function alertSentence(reason: LiveAlertReason, at: number, locale: string): string {
  const clock = clockText(at, locale);
  switch (reason) {
    case "possible-crash":
      return `Possible crash detected at ${clock} — last known location`;
    case "sos":
      return `SOS from the rider at ${clock} — last known location`;
    case "rider-cancelled":
      return `The rider ended the ride at ${clock} — last known location`;
  }
}

/** True only for the reasons that ask the follower to consider calling for help. */
function isEmergency(reason: LiveAlertReason): boolean {
  return reason === "possible-crash" || reason === "sos";
}

/**
 * The expected-finish line, or `null` when the rider shared no finish time.
 *
 * Inside the window it carries the time left, so a follower can answer "when
 * will they be done" from the card. Past it, the line only states the time the
 * rider gave: the overdue headline carries the lateness, and repeating it here
 * would say the same thing twice.
 */
function planLine(state: ExpectedFinishState, locale: string): FollowPlanLine | null {
  if (state.kind === "none") return null;
  const at = clockText(state.expectedFinishAt, locale);
  if (state.kind === "on-time") {
    return { text: `Expected finish ${at} · ${timeLeftText(state.msLeft)} left`, late: false };
  }
  return { text: `Expected finish ${at}`, late: state.kind === "overdue" };
}

/**
 * The card for one snapshot. `alert` takes precedence over everything (it is the
 * reason a follower opens the link again), then a finish time the clock has run
 * past, then finished, then a paused ride, then stale, then stopped or riding.
 */
export function followCard({ snapshot, now, locale = "en-US" }: FollowCardInput): FollowCard {
  const name = snapshot.riderName;
  const { last } = snapshot;
  const finish = expectedFinishState({
    plan: snapshot.plan,
    status: snapshot.status,
    lastFixAt: last === null ? null : last.t,
    now,
  });
  const plan = planLine(finish, locale);
  if (snapshot.alert !== null) {
    const banner = alertSentence(snapshot.alert.reason, snapshot.alert.at, locale);
    return {
      kind: "alert",
      title: isEmergency(snapshot.alert.reason) ? `${name} may need help` : `${name} ended the ride`,
      // The red banner already says what happened; the card says how fresh it is.
      detail: last === null
        ? "No location was shared before the alert."
        : `Last location ${ageText(now - last.t)} ago${batteryText(last.battery) === null ? "" : ` · battery ${batteryText(last.battery)}`}`,
      alert: { text: banner, emergency: isEmergency(snapshot.alert.reason), at: snapshot.alert.at },
      plan,
    };
  }
  // The clock has passed the rider's own finish time and they have not said they
  // are done. That is the most important thing this card can say — whether the
  // fixes stopped before the finish or kept coming past it.
  if (finish.kind === "overdue") {
    const lateBattery = batteryText(last?.battery ?? null);
    return {
      kind: "overdue",
      title: `Overdue by ${finish.minutesLate} min`,
      // The age of the newest fix, said plainly: "overdue" answers "should they
      // be back?" and this answers "when was I last sure they were moving?".
      detail: last === null
        ? "No location shared yet"
        : `Last seen ${ageText(now - last.t)} ago${lateBattery === null ? "" : ` · battery ${lateBattery}`}`,
      alert: null,
      plan,
    };
  }
  if (last === null) {
    return {
      kind: "waiting",
      title: `${name} is getting ready to ride`,
      detail: "No location yet — this page updates by itself.",
      alert: null,
      plan,
    };
  }
  const age = Math.max(0, now - last.t);
  const battery = batteryText(last.battery);
  if (snapshot.status === "finished") {
    return {
      kind: "finished",
      title: `${name} finished the ride at ${clockText(snapshot.updatedAt, locale)}`,
      detail: `Last location ${ageText(age)} ago${battery === null ? "" : ` · battery ${battery}`}`,
      alert: null,
      plan,
    };
  }
  if (snapshot.status === "paused") {
    return {
      kind: "paused",
      title: `${name} paused the ride`,
      detail: `Last update ${ageText(age)} ago${battery === null ? "" : ` · battery ${battery}`}`,
      alert: null,
      plan,
    };
  }
  if (age > STALE_AFTER_MS) {
    return {
      kind: "stale",
      title: `No update for ${ageText(age)} — they may be out of signal`,
      detail: `Last location was at ${clockText(last.t, locale)}${battery === null ? "" : ` · battery ${battery}`}`,
      alert: null,
      plan,
    };
  }
  const stopped = stoppedForMs(snapshot.trail);
  if (stopped !== null && stopped >= STOPPED_AFTER_MS) {
    return {
      kind: "stopped",
      title: `${name} is stopped`,
      detail: `stopped for ${ageText(stopped)} · updated ${ageText(age)} ago${battery === null ? "" : ` · battery ${battery}`}`,
      alert: null,
      plan,
    };
  }
  const speed = last.speed !== null && last.speed >= STOPPED_SPEED_MPS ? speedText(last.speed) : null;
  return {
    kind: "riding",
    title: `${name} is riding`,
    detail: `updated ${ageText(age)} ago${speed === null ? "" : ` · ${speed}`}${battery === null ? "" : ` · battery ${battery}`}`,
    alert: null,
    plan,
  };
}

/**
 * A link that opens the last known position in the viewer's own maps app.
 *
 * Apple Maps on Apple platforms, Google Maps everywhere else: both accept a
 * coordinate without an API key, and the follower is the one who chooses what to
 * do with it.
 */
export function mapsUrl(last: { readonly lat: number; readonly lon: number }): string {
  const coordinate = `${last.lat.toFixed(6)},${last.lon.toFixed(6)}`;
  const apple = typeof navigator !== "undefined" && /iPad|iPhone|iPod|Macintosh/.test(navigator.userAgent);
  return apple ? `https://maps.apple.com/?ll=${coordinate}&q=${coordinate}` : `https://www.google.com/maps/search/?api=1&query=${coordinate}`;
}
