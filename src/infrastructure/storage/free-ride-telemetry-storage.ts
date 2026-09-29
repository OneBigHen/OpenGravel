/**
 * Durable home of a Free Ride's live telemetry state
 * (`src/application/ride-session/free-ride-telemetry.ts`).
 *
 * localStorage, keyed to the session, like the Ride Focus pointer and the
 * rider's strip choices, the other ride-scoped UI state:
 *
 * - It is synchronous, so the last state can still be written from
 *   `pagehide`, when an IndexedDB transaction may never commit.
 * - It is readable before IndexedDB opens, so the first frame after a reload
 *   already shows the restored values.
 * - The session journal in IndexedDB stays the authority on what the ride
 *   *did*. This is a derived aggregate that can be lost without loss of
 *   truth: without it the strip starts from zero rather than guessing.
 *
 * One entry, `{ version, sessionId, state }`, so a finished or abandoned ride
 * never leaves per-session keys behind: the next Free Ride overwrites it, and
 * a read for any other session is `null`. Every failure is swallowed and
 * reported as `null` / `false`, never thrown.
 */

import type { FreeRideTelemetryStoragePort } from "@/application/ride-session/free-ride-telemetry";
import { parseRecordingTelemetryState } from "@/domain/recording/telemetry";

export const FREE_RIDE_TELEMETRY_STORAGE_KEY = "opengravel.vnext.free-ride-telemetry";

export interface FreeRideTelemetryStorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

function defaultStorage(): FreeRideTelemetryStorageLike | null {
  try {
    return typeof window === "undefined" ? null : window.localStorage;
  } catch {
    return null;
  }
}

export function createLocalStorageFreeRideTelemetry(
  storage: FreeRideTelemetryStorageLike | null = defaultStorage(),
): FreeRideTelemetryStoragePort {
  return {
    read(sessionId) {
      try {
        const raw = storage?.getItem(FREE_RIDE_TELEMETRY_STORAGE_KEY);
        if (raw === null || raw === undefined) return null;
        const entry: unknown = JSON.parse(raw);
        if (typeof entry !== "object" || entry === null) return null;
        const { version, sessionId: storedSession, state } = entry as Record<string, unknown>;
        if (version !== 1 || storedSession !== sessionId) return null;
        return parseRecordingTelemetryState(state);
      } catch {
        return null;
      }
    },
    write(sessionId, state) {
      if (storage === null) return false;
      try {
        storage.setItem(FREE_RIDE_TELEMETRY_STORAGE_KEY, JSON.stringify({ version: 1, sessionId, state }));
        return true;
      } catch {
        return false;
      }
    },
    clear() {
      try {
        storage?.removeItem(FREE_RIDE_TELEMETRY_STORAGE_KEY);
      } catch {
        // Best effort: a leftover entry names a session that is over and is never read for another.
      }
    },
  };
}
