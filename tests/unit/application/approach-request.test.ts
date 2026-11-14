import { describe, expect, it } from "vitest";

import {
  APPROACH_MIN_METERS,
  APPROACH_STORAGE_KEY,
  APPROACH_TTL_MS,
  approachLabel,
  clearApproach,
  distanceToRideStartMeters,
  needsApproach,
  peekApproach,
  requestApproach,
  takeApproach,
  type ApproachStorage,
} from "@/application/ride-session/approach-request";

function memory(): ApproachStorage & { readonly data: Map<string, string> } {
  const data = new Map<string, string>();
  return {
    data,
    getItem: (key) => data.get(key) ?? null,
    setItem: (key, value) => { data.set(key, value); },
    removeItem: (key) => { data.delete(key); },
  };
}

describe("ride to the start", () => {
  it("offers the action only when the start is more than about 2 miles away", () => {
    expect(needsApproach(APPROACH_MIN_METERS - 1)).toBe(false);
    expect(needsApproach(APPROACH_MIN_METERS + 1)).toBe(true);
    expect(needsApproach(Number.NaN)).toBe(false);
    expect(approachLabel(1_000)).toBeNull();
  });

  it("says the distance in miles a rider would say", () => {
    expect(approachLabel(40 * 1609.344)).toBe("Ride to the start · 40 mi");
    expect(approachLabel(3.5 * 1609.344)).toBe("Ride to the start · 3.5 mi");
    expect(approachLabel(12.4 * 1609.344)).toBe("Ride to the start · 12 mi");
  });

  it("measures a fixture ride that starts about 40 miles away", () => {
    const rider = { lon: -75.4, lat: 40.6 };
    const start = { lon: -75.4, lat: 41.18 };
    const miles = distanceToRideStartMeters(rider, start) / 1609.344;
    expect(miles).toBeGreaterThan(38);
    expect(miles).toBeLessThan(42);
    expect(approachLabel(distanceToRideStartMeters(rider, start))).toMatch(/^Ride to the start · (39|40|41) mi$/);
  });

  it("carries the decision to the ride screen once, for the ride named", () => {
    const storage = memory();
    requestApproach("ride-1", { storage, now: 1_000 });
    expect(peekApproach("ride-2", { storage, now: 2_000 })).toBe(false);
    expect(peekApproach("ride-1", { storage, now: 2_000 })).toBe(true);
    // Peeking keeps it: the ride screen is what uses it up.
    expect(peekApproach("ride-1", { storage, now: 2_000 })).toBe(true);
    expect(takeApproach({ storage, now: 3_000 })).toBe(true);
    expect(takeApproach({ storage, now: 3_000 })).toBe(false);
  });

  it("lets a tap that was never followed through go stale", () => {
    const storage = memory();
    requestApproach("ride-1", { storage, now: 0 });
    expect(takeApproach({ storage, now: APPROACH_TTL_MS + 1 })).toBe(false);
    expect(storage.data.has(APPROACH_STORAGE_KEY)).toBe(false);
  });

  it("can be cleared when the rider is already at the start", () => {
    const storage = memory();
    requestApproach("ride-1", { storage, now: 0 });
    clearApproach({ storage });
    expect(takeApproach({ storage, now: 1 })).toBe(false);
  });

  it("does nothing without storage", () => {
    requestApproach("ride-1", { storage: null });
    expect(peekApproach("ride-1", { storage: null })).toBe(false);
    expect(takeApproach({ storage: null })).toBe(false);
  });
});
