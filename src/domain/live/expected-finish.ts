/**
 * The rider's expected finish, and what the clock has done to it.
 *
 * A live link can carry one promise the rider made: "I expect to be done by
 * 4:10". This module decides, from that claim alone, whether the ride is still
 * inside it, has finished, or has run past it — and how the rider's screen turns
 * a clock time into that claim in the first place.
 *
 * Two honesty rules, the same ones the rest of the live feature follows:
 *
 * - **No expectation is not an expectation met.** A link without a finish time
 *   is `none`: it never reads as on time, and it never reads as overdue.
 * - **Past the time is past the time.** Being late is a fact about the clock and
 *   the rider's own claim, so it is said as soon as the time passes — whether
 *   the newest fix arrived a minute ago or an hour ago. Anything the fixes know
 *   (that the rider was still on the route past their finish, or that they have
 *   gone quiet since before it) is reported separately, never used to soften it.
 */

import type { LiveExpectedFinish, LiveRideStatus } from "./types";

/** The margin a rider's screen adds to the route's own estimate by default. */
export const EXPECTED_FINISH_MARGIN_MS = 30 * 60_000;

const MINUTE_MS = 60_000;
const HOUR_MS = 3_600_000;
/**
 * Half a day: how far in the past a wall-clock time may be before it is read as
 * the next morning rather than today. A rider typing `2:00` at 23:00 means
 * 02:00 tomorrow (three hours out), not the 02:00 that has just gone.
 */
const HALF_DAY_MS = 12 * HOUR_MS;

/** `^([01]\d|2[0-3]):([0-5]\d)$`, the `input[type=time]` value shape. */
const TIME_OF_DAY = /^([01]\d|2[0-3]):([0-5]\d)$/;

/** The rider's expectation as the follower page may judge it. */
export type ExpectedFinishState =
  /** No finish time was shared: nothing to be early for and nothing to be late for. */
  | { readonly kind: "none" }
  /** The rider said they were done. The expectation has no more work to do. */
  | { readonly kind: "finished"; readonly expectedFinishAt: number }
  /** The clock is still inside the rider's own window. */
  | { readonly kind: "on-time"; readonly expectedFinishAt: number; readonly msLeft: number }
  /** The clock has passed the rider's own window and the ride is not done. */
  | {
      readonly kind: "overdue";
      readonly expectedFinishAt: number;
      readonly msLate: number;
      /** Whole minutes late, at least one, for the sentence a follower reads. */
      readonly minutesLate: number;
      /**
       * True when the newest fix is older than the expected finish: there has
       * been no news since before the rider said they would be done.
       */
      readonly lastFixBeforeFinish: boolean;
    };

export interface ExpectedFinishInput {
  readonly plan: LiveExpectedFinish | null | undefined;
  readonly status: LiveRideStatus;
  /** Epoch milliseconds of the newest fix, or `null` before the first one. */
  readonly lastFixAt: number | null;
  /** Epoch milliseconds: the viewer's clock, passed in so this stays pure. */
  readonly now: number;
}

/** True for a plan the follower page may act on. */
function isUsable(plan: LiveExpectedFinish | null | undefined): plan is LiveExpectedFinish {
  return plan !== null && plan !== undefined && Number.isFinite(plan.expectedFinishAt);
}

/** Where the clock stands against the rider's own expected finish. */
export function expectedFinishState({ plan, status, lastFixAt, now }: ExpectedFinishInput): ExpectedFinishState {
  if (!isUsable(plan)) return { kind: "none" };
  const expectedFinishAt = plan.expectedFinishAt;
  if (status === "finished") return { kind: "finished", expectedFinishAt };
  if (now < expectedFinishAt) return { kind: "on-time", expectedFinishAt, msLeft: expectedFinishAt - now };
  const msLate = Math.max(0, now - expectedFinishAt);
  return {
    kind: "overdue",
    expectedFinishAt,
    msLate,
    minutesLate: Math.max(1, Math.round(msLate / MINUTE_MS)),
    lastFixBeforeFinish: lastFixAt !== null && lastFixAt < expectedFinishAt,
  };
}

/**
 * The default a rider's screen offers: the route's own time left, plus the
 * margin, as a whole minute (the value an `input[type=time]` can hold).
 *
 * `null` when the ride has no honest estimate to start from — a Free Ride with
 * no route has no finish time until the rider types one.
 */
export function defaultExpectedFinishAt(
  nowMs: number,
  remainingRideMs: number | null,
  marginMs: number = EXPECTED_FINISH_MARGIN_MS,
): number | null {
  if (!Number.isFinite(nowMs) || remainingRideMs === null || !Number.isFinite(remainingRideMs) || remainingRideMs < 0) {
    return null;
  }
  const at = nowMs + remainingRideMs + (Number.isFinite(marginMs) ? Math.max(0, marginMs) : 0);
  return Math.ceil(at / MINUTE_MS) * MINUTE_MS;
}

/**
 * A wall-clock time the rider picked (`"16:40"`, in the device's own timezone)
 * as the instant it names, or `null` when the value is not a time of day.
 *
 * The date comes from `nowMs`: a time more than half a day behind the clock is
 * read as the next morning, which is what a rider finishing after midnight
 * means. A time just behind the clock stays behind it — that is the rider's own
 * claim, and saying so ("overdue") is more honest than silently moving it.
 */
export function expectedFinishAtFromTimeOfDay(value: string, nowMs: number): number | null {
  const match = TIME_OF_DAY.exec(value.trim());
  if (match === null || !Number.isFinite(nowMs)) return null;
  const at = new Date(nowMs);
  at.setHours(Number(match[1]), Number(match[2]), 0, 0);
  if (nowMs - at.getTime() > HALF_DAY_MS) at.setDate(at.getDate() + 1);
  return at.getTime();
}

/** `1759516800000 → "16:40"`, the value an `input[type=time]` holds. */
export function timeOfDayValue(atMs: number): string {
  if (!Number.isFinite(atMs)) return "";
  const at = new Date(atMs);
  return `${String(at.getHours()).padStart(2, "0")}:${String(at.getMinutes()).padStart(2, "0")}`;
}

/** `18 * 60_000 → "18 min"`, `4_500_000 → "1 h 15 min"`: time is left, in words. */
export function timeLeftText(ms: number): string {
  const minutes = Math.max(0, Math.round(ms / MINUTE_MS));
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return rest === 0 ? `${hours} h` : `${hours} h ${rest} min`;
}
