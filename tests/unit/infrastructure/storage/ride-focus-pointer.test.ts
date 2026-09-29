/**
 * The Ride Focus bootstrap pointer
 * (`src/application/persistence/ride-focus-pointer.ts`; 08 §13, 04 §28).
 *
 * The pointer is what makes `/ride` after a reload find the same session, so its
 * three failure modes have to be distinguishable: nothing there (`absent`), a
 * store that cannot be read (`unreadable`, which is *not* "no ride"), and a value
 * that is not a pointer (`corrupt`). The presentation half — the route's
 * persisted geometry handle — rides along, because the bundle that names it is
 * per-tab and gone after a navigation (§13).
 */

import { afterEach, describe, expect, it, vi } from "vitest";

import {
  isRideFocusPointer,
  rideFocusGeometryRefs,
  type RideFocusPointer,
} from "@/application/persistence/ride-focus-pointer";
import {
  RIDE_FOCUS_POINTER_KEY,
  createLocalStorageRideFocusPointer,
} from "@/infrastructure/storage/ride-focus-pointer";
import type { GeometryRef, RideId } from "@/domain/ride/ids";
import { newRideSessionId } from "@/domain/ride-session/ids";

const POINTER = {
  sessionId: newRideSessionId(),
  rideId: "ride_abc" as RideId,
  routeGeometryRef: "geo_line" as GeometryRef,
  updatedAt: "2026-09-21T14:00:00.000Z",
};

afterEach(() => {
  vi.restoreAllMocks();
  localStorage.removeItem(RIDE_FOCUS_POINTER_KEY);
});

describe("ride focus pointer storage", () => {
  it("round-trips the session identity and the route line's handle", () => {
    const pointer = createLocalStorageRideFocusPointer();
    const guidancePointer = {
      ...POINTER,
      instructions: [{
        text: "Turn left onto Ridge Pike",
        distanceMeters: 420,
        durationSeconds: 62,
        type: "turn",
        maneuver: "left" as const,
        roadName: "Ridge Pike",
        geometryIndex: 1,
      }],
    };

    pointer.write(guidancePointer);

    expect(pointer.read()).toEqual({
      status: "found",
      pointer: { version: 1, ...guidancePointer },
    });
  });

  it("stores no ride content of its own", () => {
    const pointer = createLocalStorageRideFocusPointer();

    pointer.write(POINTER);

    const stored = localStorage.getItem(RIDE_FOCUS_POINTER_KEY) ?? "";
    expect(stored).toContain('"version":1');
    expect(stored).not.toContain("intent");
    expect(stored).not.toContain("coordinates");
  });

  it("reports absence, and clears what it wrote", () => {
    const pointer = createLocalStorageRideFocusPointer();

    expect(pointer.read()).toEqual({ status: "absent" });
    pointer.write(POINTER);
    pointer.clear();
    expect(pointer.read()).toEqual({ status: "absent" });
  });

  it("projects only the active route geometry as a protected reference", () => {
    const pointer = createLocalStorageRideFocusPointer();

    expect(rideFocusGeometryRefs(pointer)).toEqual([]);
    pointer.write(POINTER);
    expect(rideFocusGeometryRefs(pointer)).toEqual([POINTER.routeGeometryRef]);
    pointer.write({ ...POINTER, routeGeometryRef: null });
    expect(rideFocusGeometryRefs(pointer)).toEqual([]);
  });

  it("rejects shapes it must not trust, rather than coercing them", () => {
    const unusable: readonly unknown[] = [
      null,
      [],
      "pointer",
      { version: 2, ...POINTER },
      { version: 1, ...POINTER, sessionId: "not-a-session" },
      { version: 1, ...POINTER, rideId: "not-a-ride" },
      { version: 1, ...POINTER, updatedAt: "" },
      { version: 1, ...POINTER, routeGeometryRef: 7 },
      { version: 1, ...POINTER, instructions: [{ text: "turn", distanceMeters: 1, durationSeconds: 2, type: "turn", geometryIndex: -1 }] },
      { version: 1, ...POINTER, instructions: Array.from({ length: 513 }, () => ({ text: "", distanceMeters: 1, durationSeconds: 1, type: "turn" })) },
    ];

    for (const value of unusable) {
      expect(isRideFocusPointer(value)).toBe(false);
    }
    expect(isRideFocusPointer({ version: 1, ...POINTER })).toBe(true);
    expect(isRideFocusPointer({ version: 1, ...POINTER, routeGeometryRef: null })).toBe(true);
  });

  it("reports an unparseable value as corrupt", () => {
    localStorage.setItem(RIDE_FOCUS_POINTER_KEY, "not-json");
    const pointer = createLocalStorageRideFocusPointer();
    expect(pointer.read()).toEqual({ status: "corrupt" });
    expect(rideFocusGeometryRefs(pointer)).toBeNull();
  });

  it("distinguishes a store it cannot read from a pointer that is not there", () => {
    const pointer = createLocalStorageRideFocusPointer();
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("storage is blocked");
    });

    // An unavailable localStorage must not be reported as "no ride": that would
    // send a resumable session to the empty state.
    expect(pointer.read()).toEqual({ status: "unreadable" });
    expect(rideFocusGeometryRefs(pointer)).toBeNull();
  });

  it("survives a write into a full or blocked store", () => {
    const pointer = createLocalStorageRideFocusPointer();
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("quota exceeded");
    });

    expect(() => pointer.write(POINTER)).not.toThrow();
  });
});

/** The stored shape is the one the adapter validates, and vice versa. */
describe("pointer shape", () => {
  it("accepts exactly what the adapter writes", () => {
    const pointer = createLocalStorageRideFocusPointer();
    pointer.write(POINTER);
    const raw: unknown = JSON.parse(localStorage.getItem(RIDE_FOCUS_POINTER_KEY) ?? "null");
    expect(isRideFocusPointer(raw)).toBe(true);
    expect((raw as RideFocusPointer).sessionId).toBe(POINTER.sessionId);
  });
});
