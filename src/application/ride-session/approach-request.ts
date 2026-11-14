/**
 * "Ride to the start": a rider who is nowhere near a ride's start asks to be
 * routed there, then along the ride, as one ride.
 *
 * The ride screen already knows how to do this once a ride has started far
 * from its line ("Head to the start", DV-07): it asks the normal router for the
 * way there and joins it to the ride's own line in the same session. This note
 * only carries the rider's decision across the page changes between the card
 * they tapped and the ride screen, so the question is not asked a second time.
 * It holds no geometry; the way to the start is always planned by the router.
 */

import { haversine } from "@/domain/geometry/analysis";
import type { Coordinate } from "@/domain/ride/types";

export const APPROACH_STORAGE_KEY = "opengravel.ride.approach";
/** A tapped "Ride to the start" that is never followed through goes stale. */
export const APPROACH_TTL_MS = 10 * 60_000;
/** Closer than this the start is where the rider already is. */
export const APPROACH_MIN_METERS = 3_219;

const METERS_PER_MILE = 1609.344;

export interface ApproachStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

interface ApproachNote {
  readonly rideId: string;
  readonly requestedAt: number;
}

function browserStorage(): ApproachStorage | null {
  if (typeof window === "undefined") return null;
  try {
    return window.sessionStorage;
  } catch {
    return null;
  }
}

/** Metres from the rider to a ride's first point. */
export function distanceToRideStartMeters(rider: Coordinate, start: Coordinate): number {
  return haversine(rider, start);
}

/** True when the start is far enough away that riding to it is its own job. */
export function needsApproach(meters: number): boolean {
  return Number.isFinite(meters) && meters > APPROACH_MIN_METERS;
}

/** "Ride to the start · 40 mi", or null when the start is near or unknown. */
export function approachLabel(meters: number): string | null {
  if (!needsApproach(meters)) return null;
  const miles = meters / METERS_PER_MILE;
  return `Ride to the start · ${miles < 10 ? miles.toFixed(1).replace(/\.0$/, "") : Math.round(miles)} mi`;
}

/** Remember that this ride is to be ridden from where the rider is now. */
export function requestApproach(
  rideId: string,
  options: { readonly storage?: ApproachStorage | null; readonly now?: number } = {},
): void {
  const storage = options.storage === undefined ? browserStorage() : options.storage;
  if (storage === null) return;
  try {
    const note: ApproachNote = { rideId, requestedAt: options.now ?? Date.now() };
    storage.setItem(APPROACH_STORAGE_KEY, JSON.stringify(note));
  } catch {
    // Without the note the ride screen asks the ordinary question instead.
  }
}

function read(storage: ApproachStorage, now: number): ApproachNote | null {
  try {
    const raw = storage.getItem(APPROACH_STORAGE_KEY);
    if (raw === null) return null;
    const parsed = JSON.parse(raw) as Partial<ApproachNote>;
    if (typeof parsed.rideId !== "string" || typeof parsed.requestedAt !== "number") return null;
    if (now - parsed.requestedAt > APPROACH_TTL_MS || now < parsed.requestedAt - 60_000) {
      storage.removeItem(APPROACH_STORAGE_KEY);
      return null;
    }
    return { rideId: parsed.rideId, requestedAt: parsed.requestedAt };
  } catch {
    return null;
  }
}

/** Whether this ride was asked to be ridden from afar; the note is kept. */
export function peekApproach(
  rideId: string,
  options: { readonly storage?: ApproachStorage | null; readonly now?: number } = {},
): boolean {
  const storage = options.storage === undefined ? browserStorage() : options.storage;
  if (storage === null) return false;
  return read(storage, options.now ?? Date.now())?.rideId === rideId;
}

/** Whether any ride was asked for; the note is used up. */
export function takeApproach(options: { readonly storage?: ApproachStorage | null; readonly now?: number } = {}): boolean {
  const storage = options.storage === undefined ? browserStorage() : options.storage;
  if (storage === null) return false;
  const note = read(storage, options.now ?? Date.now());
  if (note === null) return false;
  try {
    storage.removeItem(APPROACH_STORAGE_KEY);
  } catch {
    // Nothing to clean up.
  }
  return true;
}

/** Drop the note without using it (the rider is already at the start). */
export function clearApproach(options: { readonly storage?: ApproachStorage | null } = {}): void {
  const storage = options.storage === undefined ? browserStorage() : options.storage;
  try {
    storage?.removeItem(APPROACH_STORAGE_KEY);
  } catch {
    // Nothing to clean up.
  }
}
