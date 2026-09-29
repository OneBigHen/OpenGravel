import type { DepartureIntent, TimeIntent } from "@/domain/ride/types";

/**
 * Arrive-by planning (NV-09). The rider names when they want to be there; the
 * departure the briefing (weather window, traffic) is about follows from the
 * chosen route's time, and moves with it when the route changes. The document
 * keeps only the arrival — the departure is derived, so undo never fights it.
 */

export interface ArrivalTarget {
  /** `YYYY-MM-DD` on the rider's calendar. */
  readonly date: string;
  /** `HH:MM`, 24-hour, rider local time. */
  readonly localTime: string;
}

/** Slack the planner allows around the arrival, as the advisor already uses. */
export const ARRIVE_BY_TOLERANCE_MINUTES = 15;

export function arriveByTime(target: ArrivalTarget): TimeIntent {
  return {
    kind: "arriveBy",
    date: target.date,
    localTime: target.localTime,
    toleranceMinutes: ARRIVE_BY_TOLERANCE_MINUTES,
  };
}

export function arrivalTargetOf(time: TimeIntent): ArrivalTarget | null {
  return time.kind === "arriveBy" ? { date: time.date, localTime: time.localTime } : null;
}

/** The arrival as an instant, read in the device's time zone; null if malformed. */
export function arrivalInstant(target: ArrivalTarget): Date | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(target.date) || !/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(target.localTime)) {
    return null;
  }
  const [year, month, day] = target.date.split("-").map(Number) as [number, number, number];
  const [hours, minutes] = target.localTime.split(":").map(Number) as [number, number];
  const at = new Date(year, month - 1, day, hours, minutes, 0, 0);
  return Number.isFinite(at.getTime()) ? at : null;
}

/** The arrival a `datetime-local` value names, or null. */
export function arrivalFromInput(value: string): ArrivalTarget | null {
  const match = /^(\d{4}-\d{2}-\d{2})T((?:[01]\d|2[0-3]):[0-5]\d)/.exec(value);
  return match === null ? null : { date: match[1] as string, localTime: match[2] as string };
}

/** `YYYY-MM-DDTHH:mm`, the value a `datetime-local` field holds. */
export function arrivalInputValue(target: ArrivalTarget): string {
  return `${target.date}T${target.localTime}`;
}

/**
 * The departure that arrives on time for a ride of `durationSeconds`. Pure: it
 * does not read the clock, so a departure already in the past is still
 * returned as that instant — `arrivalIsLate` says so.
 */
export function departureForArrival(target: ArrivalTarget, durationSeconds: number): DepartureIntent | null {
  const arrive = arrivalInstant(target);
  if (arrive === null || !Number.isFinite(durationSeconds) || durationSeconds < 0) return null;
  return { kind: "future", at: new Date(arrive.getTime() - durationSeconds * 1000).toISOString() };
}

/** True when leaving now already misses the arrival by more than the tolerance. */
export function arrivalIsLate(target: ArrivalTarget, durationSeconds: number, now: Date): boolean {
  const arrive = arrivalInstant(target);
  if (arrive === null || !Number.isFinite(durationSeconds)) return false;
  const earliest = now.getTime() + durationSeconds * 1000;
  return earliest > arrive.getTime() + ARRIVE_BY_TOLERANCE_MINUTES * 60_000;
}
