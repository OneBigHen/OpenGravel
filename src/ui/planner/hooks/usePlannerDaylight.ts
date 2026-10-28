"use client";

/**
 * The departure the map's daylight split is about (MAP-EXPERIENCE-NEXT Wave 2,
 * item 8), plus the rider's own time zone for its label.
 *
 * `buildMapScene` is a pure projection and never reads a clock, so the clock is
 * read here — at the one surface that owns it — and handed down as an instant:
 *
 * - an **arrive-by** ride leaves when it must to arrive on time, the same
 *   derivation the briefing uses (`departureForArrival`), so the map's dusk and
 *   the briefing's "Dark by 6:12 pm" cannot describe different rides;
 * - a **future** departure is already an instant and needs no clock;
 * - a **now** departure is the moment the rider is looking at the map, so it is
 *   read from a one-minute clock. A minute is enough: the sun moves about a
 *   quarter of a degree along the horizon in that time, and the scene
 *   fingerprint means the map only re-uploads when the split actually moves.
 *
 * Nothing here is a fallback for an unknown sunset: the split itself declines to
 * answer when the sun calculation cannot, and this hook never invents a
 * departure to fill in for one.
 */

import { useSyncExternalStore } from "react";

import { arrivalTargetOf, departureForArrival } from "@/application/planner/arrive-by";
import type { DepartureIntent, TimeIntent } from "@/domain/ride/types";

/** How often a `now` departure is re-sampled. */
const NOW_REFRESH_MS = 60_000;

/**
 * One minute clock for every surface that asks for it.
 *
 * A subscription to an external system (here, time) is what `useSyncExternalStore`
 * is for, and it gives the snapshot the stability React needs: the value only
 * changes when a minute passes, so a map that is not moving does not re-render.
 * Reading the clock during render or in an effect body would instead either
 * break server rendering or cascade renders.
 */
const clockListeners = new Set<() => void>();
let clockSnapshot: string | null = null;
let clockTimer: number | null = null;

function clockTick(): void {
  clockSnapshot = new Date().toISOString();
  for (const listener of clockListeners) listener();
}

function subscribeToClock(listener: () => void): () => void {
  clockListeners.add(listener);
  if (clockTimer === null) {
    clockSnapshot = new Date().toISOString();
    clockTimer = window.setInterval(clockTick, NOW_REFRESH_MS);
  }
  return () => {
    clockListeners.delete(listener);
    if (clockListeners.size === 0 && clockTimer !== null) {
      window.clearInterval(clockTimer);
      clockTimer = null;
      clockSnapshot = null;
    }
  };
}

/** A stable no-op subscription, for when the ride does not leave "now". */
function subscribeToNothing(): () => void {
  return () => {};
}

function clockValue(): string | null {
  return clockSnapshot;
}

function noClock(): string | null {
  return null;
}

export interface PlannerDaylightInput {
  readonly departure: DepartureIntent;
  readonly time: TimeIntent;
  /** The selected route's engine duration, or `null` when no route is chosen. */
  readonly durationSeconds: number | null;
}

export interface PlannerDaylightContext {
  /** The departure instant, or `null` while a `now` departure has no clock yet. */
  readonly departureAt: string | null;
  /** The rider's own zone; `undefined` lets the label use the device's. */
  readonly riderTimeZone: string | undefined;
}

/** The device's own time zone, read once and never during server rendering. */
function useRiderTimeZone(): string | undefined {
  return useSyncExternalStore(
    () => () => {},
    () => Intl.DateTimeFormat().resolvedOptions().timeZone || undefined,
    () => undefined,
  );
}

/**
 * The departure the map annotates for.
 *
 * An `arriveBy` intent is resolved with the same helper the ride briefing uses,
 * and the result falls back to the authored departure exactly as the briefing
 * does — never to a fabricated instant.
 */
export function plannerDepartureOf(input: PlannerDaylightInput): DepartureIntent {
  const arrival = arrivalTargetOf(input.time);
  if (arrival === null || input.durationSeconds === null) return input.departure;
  return departureForArrival(arrival, input.durationSeconds) ?? input.departure;
}

export function usePlannerDaylight(input: PlannerDaylightInput): PlannerDaylightContext {
  const riderTimeZone = useRiderTimeZone();
  const effective = plannerDepartureOf(input);
  const leavesNow = effective.kind === "now";
  const now = useSyncExternalStore(
    leavesNow ? subscribeToClock : subscribeToNothing,
    leavesNow ? clockValue : noClock,
    noClock,
  );
  return {
    departureAt: effective.kind === "future" ? effective.at : now,
    riderTimeZone,
  };
}
