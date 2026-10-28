import { describe, expect, it } from "vitest";

import {
  EXPECTED_FINISH_MARGIN_MS,
  defaultExpectedFinishAt,
  expectedFinishAtFromTimeOfDay,
  expectedFinishState,
  timeLeftText,
  timeOfDayValue,
} from "@/domain/live/expected-finish";

/**
 * The expected-finish state machine: the one place that decides whether a ride
 * is inside the window its rider named, finished, or past it.
 *
 * Every case here is a fact the follower page is allowed to state. There is no
 * case in which a missing finish time becomes "on time", and no case in which a
 * late ride is softened because its dot is still moving.
 */

const NOW = Date.UTC(2026, 9, 3, 19, 41, 0);
const MINUTE = 60_000;

describe("expected finish state", () => {
  it("says nothing about a link that shared no finish time", () => {
    for (const plan of [null, undefined, { expectedFinishAt: Number.NaN }]) {
      expect(expectedFinishState({ plan, status: "riding", lastFixAt: NOW - MINUTE, now: NOW })).toEqual({ kind: "none" });
    }
  });

  it("is on time while the clock is inside the rider's own window", () => {
    const state = expectedFinishState({
      plan: { expectedFinishAt: NOW + 32 * MINUTE },
      status: "riding",
      lastFixAt: NOW - MINUTE,
      now: NOW,
    });
    expect(state).toMatchObject({ kind: "on-time", msLeft: 32 * MINUTE });
  });

  it("turns overdue the moment the window closes, and says how late in whole minutes", () => {
    const at = NOW - 25 * MINUTE;
    const state = expectedFinishState({ plan: { expectedFinishAt: at }, status: "riding", lastFixAt: at - 5 * MINUTE, now: NOW });
    expect(state).toMatchObject({
      kind: "overdue",
      expectedFinishAt: at,
      msLate: 25 * MINUTE,
      minutesLate: 25,
      lastFixBeforeFinish: true,
    });

    // Exactly on the finish time is the first moment of being late, reported as
    // a minute rather than as "overdue by 0 min".
    const boundary = expectedFinishState({ plan: { expectedFinishAt: NOW }, status: "riding", lastFixAt: NOW, now: NOW });
    expect(boundary.kind).toBe("overdue");
    expect(expectedFinishState({ plan: { expectedFinishAt: NOW - 1 }, status: "riding", lastFixAt: NOW, now: NOW }))
      .toMatchObject({ minutesLate: 1 });
  });

  it("is still overdue when fixes kept arriving past the finish", () => {
    const at = NOW - 40 * MINUTE;
    const state = expectedFinishState({ plan: { expectedFinishAt: at }, status: "riding", lastFixAt: NOW - 30_000, now: NOW });
    expect(state.kind).toBe("overdue");
    // The newest fix came after the finish, so there *is* news since then.
    expect(state).toMatchObject({ lastFixBeforeFinish: false });
  });

  it("stays overdue while the rider is paused, and does not fire once they finish", () => {
    const plan = { expectedFinishAt: NOW - 10 * MINUTE };
    expect(expectedFinishState({ plan, status: "paused", lastFixAt: NOW - MINUTE, now: NOW }).kind).toBe("overdue");
    expect(expectedFinishState({ plan, status: "finished", lastFixAt: NOW - MINUTE, now: NOW }).kind).toBe("finished");
  });

  it("keeps lastFixBeforeFinish false when there is no fix at all", () => {
    const state = expectedFinishState({ plan: { expectedFinishAt: NOW - MINUTE }, status: "riding", lastFixAt: null, now: NOW });
    expect(state).toMatchObject({ kind: "overdue", lastFixBeforeFinish: false });
  });
});

describe("defaulting the expected finish", () => {
  it("adds the margin to the route's own time left", () => {
    expect(defaultExpectedFinishAt(NOW, 90 * MINUTE)).toBe(NOW + 120 * MINUTE);
    // A rider who picks no margin gets the route's own estimate.
    expect(defaultExpectedFinishAt(NOW, 90 * MINUTE, 0)).toBe(NOW + 90 * MINUTE);
    expect(EXPECTED_FINISH_MARGIN_MS).toBe(30 * MINUTE);
  });

  it("has no default without an honest route estimate to start from", () => {
    expect(defaultExpectedFinishAt(NOW, null)).toBeNull();
    expect(defaultExpectedFinishAt(NOW, Number.NaN)).toBeNull();
    expect(defaultExpectedFinishAt(NOW, -1)).toBeNull();
    expect(defaultExpectedFinishAt(Number.NaN, MINUTE)).toBeNull();
  });

  it("rounds up to a whole minute, the shape a time input holds", () => {
    const at = defaultExpectedFinishAt(NOW + 20_000, 0, 0);
    expect(at).not.toBeNull();
    expect((at ?? 0) % MINUTE).toBe(0);
    expect(at).toBe(NOW + MINUTE);
  });
});

describe("a wall-clock finish time as an instant", () => {
  it("reads the time in the device's own timezone today", () => {
    const at = expectedFinishAtFromTimeOfDay("16:40", NOW);
    expect(at).not.toBeNull();
    const date = new Date(at ?? 0);
    expect(date.getHours()).toBe(16);
    expect(date.getMinutes()).toBe(40);
    expect(date.getSeconds()).toBe(0);
  });

  it("reads a time more than half a day behind the clock as the next morning", () => {
    // NOW is 19:41 local-equivalent here only in UTC; use a fixed local morning.
    const morning = new Date(2026, 9, 3, 23, 30, 0).getTime();
    const at = expectedFinishAtFromTimeOfDay("02:00", morning);
    expect(at).not.toBeNull();
    expect((at ?? 0) - morning).toBe(2.5 * 3_600_000);
  });

  it("leaves a time that only just passed in the past, so the page can say so", () => {
    const now = new Date(2026, 9, 3, 10, 0, 0).getTime();
    const at = expectedFinishAtFromTimeOfDay("09:00", now);
    expect(at).toBe(new Date(2026, 9, 3, 9, 0, 0).getTime());
  });

  it("refuses anything that is not a time of day", () => {
    for (const value of ["", "24:00", "9:5", "09:60", "tomorrow", "09:00:00", "-1:00"]) {
      expect(expectedFinishAtFromTimeOfDay(value, NOW), value).toBeNull();
    }
  });

  it("round-trips through the input value in local time", () => {
    const at = new Date(2026, 9, 3, 16, 40, 0).getTime();
    expect(timeOfDayValue(at)).toBe("16:40");
    expect(expectedFinishAtFromTimeOfDay(timeOfDayValue(at), at - 3_600_000)).toBe(at);
    expect(timeOfDayValue(Number.NaN)).toBe("");
  });
});

describe("time left in words", () => {
  it("says minutes under the hour and whole hours above it", () => {
    expect(timeLeftText(18 * MINUTE)).toBe("18 min");
    expect(timeLeftText(64 * MINUTE)).toBe("1 h 4 min");
    expect(timeLeftText(120 * MINUTE)).toBe("2 h");
    expect(timeLeftText(-5 * MINUTE)).toBe("0 min");
  });
});
