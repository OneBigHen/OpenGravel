import { describe, expect, it } from "vitest";

import type { LiveFollowSnapshot, LivePoint, LiveTrailPoint } from "@/domain/live/types";
import { STALE_AFTER_MS, clockText, followCard } from "@/ui/follow/follow-status";

/**
 * The follower card's whole vocabulary, tested as text: these are the sentences a
 * loved one reads, so they are decided in one pure function and asserted here
 * rather than inferred from a rendered DOM.
 */

const NOW = Date.UTC(2026, 9, 3, 19, 41, 0);

function point(t: number, overrides: Partial<LivePoint> = {}): LivePoint {
  return {
    t,
    lat: 40.1,
    lon: -75.4,
    speed: 17,
    heading: 90,
    accuracy: 8,
    battery: 0.62,
    ...overrides,
  };
}

function trailOf(entries: readonly LivePoint[]): LiveTrailPoint[] {
  return entries.map((entry) => ({ t: entry.t, lat: entry.lat, lon: entry.lon, speed: entry.speed }));
}

function snapshot(overrides: Partial<LiveFollowSnapshot> = {}): LiveFollowSnapshot {
  return {
    riderName: "Sam",
    status: "riding",
    alert: null,
    updatedAt: NOW - 40_000,
    last: point(NOW - 40_000),
    trail: trailOf([point(NOW - 60_000), point(NOW - 40_000)]),
    route: null,
    ...overrides,
  };
}

describe("follower card", () => {
  it("says a moving rider is riding, with the age, the speed and the battery", () => {
    const card = followCard({ snapshot: snapshot(), now: NOW });
    expect(card.kind).toBe("riding");
    expect(card.title).toBe("Sam is riding");
    expect(card.detail).toBe("updated 40 s ago · 38 mph · battery 62%");
    expect(card.alert).toBeNull();
  });

  it("never prints a speed or a battery the device did not report", () => {
    const card = followCard({
      snapshot: snapshot({ last: point(NOW - 5_000, { speed: null, battery: null }) }),
      now: NOW,
    });
    expect(card.detail).toBe("updated 5 s ago");
    expect(card.detail).not.toContain("mph");
    expect(card.detail).not.toContain("%");
  });

  it("says a rider has stopped only after two minutes under walking pace", () => {
    const brief = [point(NOW - 40_000, { speed: 0 }), point(NOW - 30_000, { speed: 0 })];
    expect(followCard({ snapshot: snapshot({ last: brief[1]!, trail: trailOf(brief) }), now: NOW }).kind).toBe("riding");

    const entries = [
      point(NOW - 480_000, { speed: 12 }),
      point(NOW - 400_000, { speed: 0 }),
      point(NOW - 200_000, { speed: 0 }),
      point(NOW - 40_000, { speed: 0 }),
    ];
    const card = followCard({ snapshot: snapshot({ last: entries[3]!, trail: trailOf(entries) }), now: NOW });
    expect(card.kind).toBe("stopped");
    expect(card.title).toBe("Sam is stopped");
    expect(card.detail).toContain("stopped for 6 min");
  });

  it("says the signal may be lost after three minutes without a point", () => {
    const last = point(NOW - 7 * 60_000);
    const card = followCard({ snapshot: snapshot({ last, trail: trailOf([last]) }), now: NOW });
    expect(card.kind).toBe("stale");
    expect(card.title).toBe("No update for 7 min — they may be out of signal");
    expect(card.detail).toContain("Last location was at ");
    expect(STALE_AFTER_MS).toBe(180_000);

    // Exactly three minutes is still current; a second more is not.
    const boundary = point(NOW - STALE_AFTER_MS);
    expect(followCard({ snapshot: snapshot({ last: boundary, trail: trailOf([boundary]) }), now: NOW }).kind).toBe("riding");
    const past = point(NOW - STALE_AFTER_MS - 1_000);
    expect(followCard({ snapshot: snapshot({ last: past, trail: trailOf([past]) }), now: NOW }).kind).toBe("stale");
  });

  it("says when the rider finished the ride, with the clock time", () => {
    const last = point(NOW - 10 * 60_000);
    const card = followCard({
      snapshot: snapshot({ status: "finished", last, trail: trailOf([last]), updatedAt: NOW - 9 * 60_000 }),
      now: NOW,
    });
    expect(card.kind).toBe("finished");
    expect(card.title).toMatch(/^Sam finished the ride at \d{1,2}:\d{2}\s(?:AM|PM)$/);
    expect(card.detail).toBe("Last location 10 min ago · battery 62%");
  });

  it("keeps a finished ride's sentence even after the points stop arriving", () => {
    const last = point(NOW - 40 * 60_000);
    const card = followCard({
      snapshot: snapshot({ status: "finished", last, trail: trailOf([last]), updatedAt: NOW - 39 * 60_000 }),
      now: NOW,
    });
    expect(card.kind).toBe("finished");
  });

  it("says a paused ride is paused", () => {
    const card = followCard({ snapshot: snapshot({ status: "paused" }), now: NOW });
    expect(card.kind).toBe("paused");
    expect(card.title).toBe("Sam paused the ride");
    expect(card.detail).toBe("Last update 40 s ago · battery 62%");
  });

  it("says it is waiting before the first point arrives", () => {
    const card = followCard({ snapshot: snapshot({ last: null, trail: [] }), now: NOW });
    expect(card.kind).toBe("waiting");
    expect(card.title).toBe("Sam is getting ready to ride");
    expect(card.detail).toContain("No location yet");
  });

  it("raises a possible-crash alert as an emergency, before anything else", () => {
    const last = point(NOW - 9 * 60_000);
    const at = NOW - 9 * 60_000;
    const card = followCard({
      snapshot: snapshot({ status: "alert", alert: { reason: "possible-crash", at }, last, trail: trailOf([last]) }),
      now: NOW,
    });
    expect(card.kind).toBe("alert");
    expect(card.title).toBe("Sam may need help");
    expect(card.alert).not.toBeNull();
    expect(card.alert?.emergency).toBe(true);
    expect(card.alert?.text).toMatch(/^Possible crash detected at \d{1,2}:\d{2}\s(?:AM|PM) — last known location$/);
    // The stale rule does not replace the alert that is the reason for the visit,
    // and the card does not repeat the banner's sentence.
    expect(card.detail).toContain("Last location 9 min ago");
    expect(card.detail).not.toContain("Possible crash");
  });

  it("treats an SOS as an emergency and a cancelled ride as not one", () => {
    const sos = followCard({
      snapshot: snapshot({ status: "alert", alert: { reason: "sos", at: NOW } }),
      now: NOW,
    });
    expect(sos.alert?.emergency).toBe(true);
    expect(sos.alert?.text).toMatch(/^SOS from the rider at /);

    const cancelled = followCard({
      snapshot: snapshot({ status: "alert", alert: { reason: "rider-cancelled", at: NOW } }),
      now: NOW,
    });
    expect(cancelled.kind).toBe("alert");
    expect(cancelled.title).toBe("Sam ended the ride");
    expect(cancelled.alert?.emergency).toBe(false);
    expect(cancelled.alert?.text).toMatch(/^The rider ended the ride at /);
  });

  it("formats clock times in the caller's locale and ages in plain words", () => {
    const at = Date.UTC(2026, 9, 3, 16, 12, 0);
    expect(clockText(at, "en-US")).toMatch(/^\d{1,2}:12\s(?:AM|PM)$/);
    const old = point(NOW - 2 * 3_600_000);
    const card = followCard({ snapshot: snapshot({ last: old, trail: trailOf([old]) }), now: NOW });
    expect(card.title).toBe("No update for 2 h — they may be out of signal");
  });
});
