/**
 * Durable bootstrap pointer for the active Ride Focus session
 * (`src/application/persistence/ride-focus-pointer.ts`; 08 §13, 04 §28).
 *
 * localStorage, for the same reason the ride-document pointer uses it: it is the
 * one store that is readable *before* IndexedDB opens, so `/ride` can decide
 * whether there is a session to resume without paying for a database connection
 * first. IndexedDB stays authoritative — this is a hint that names a session, and
 * a hint that does not parse is reported as `corrupt` rather than guessed at.
 *
 * A storage failure is `unreadable`, never `absent`: an unavailable localStorage
 * must not be reported as "no ride", which would send a resumable session to the
 * empty state (the same distinction the bootstrap pointer draws).
 */

import {
  isRideFocusPointer,
  type RideFocusPointer,
  type RideFocusPointerPort,
  type RideFocusPointerRead,
} from "@/application/persistence/ride-focus-pointer";

export const RIDE_FOCUS_POINTER_KEY = "opengravel.vnext.ride-focus";

export function createLocalStorageRideFocusPointer(): RideFocusPointerPort {
  return {
    read(): RideFocusPointerRead {
      if (typeof window === "undefined") return { status: "absent" };
      let value: string | null;
      try {
        value = window.localStorage.getItem(RIDE_FOCUS_POINTER_KEY);
      } catch {
        return { status: "unreadable" };
      }
      if (value === null) return { status: "absent" };
      let parsed: unknown;
      try {
        parsed = JSON.parse(value);
      } catch {
        return { status: "corrupt" };
      }
      return isRideFocusPointer(parsed)
        ? { status: "found", pointer: parsed }
        : { status: "corrupt" };
    },

    write(pointer: Omit<RideFocusPointer, "version">): void {
      if (typeof window === "undefined") return;
      try {
        window.localStorage.setItem(
          RIDE_FOCUS_POINTER_KEY,
          JSON.stringify({ version: 1, ...pointer }),
        );
      } catch {
        // The journal in IndexedDB remains authoritative; the next handoff writes
        // the pointer again.
      }
    },

    clear(): void {
      if (typeof window === "undefined") return;
      try {
        window.localStorage.removeItem(RIDE_FOCUS_POINTER_KEY);
      } catch {
        // Nothing to do: an unreadable store has no pointer to drop.
      }
    },
  };
}
