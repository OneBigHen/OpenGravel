import { describe, expect, it } from "vitest";

import {
  arrivalFromInput,
  arrivalIsLate,
  arrivalTargetOf,
  arriveByTime,
  departureForArrival,
} from "@/application/planner/arrive-by";
import { validateTimeIntent } from "@/domain/ride/validate";

/** NV-09: the departure follows from the arrival and the route's time. */
describe("arrive-by", () => {
  const arrival = { date: "2026-06-21", localTime: "18:00" };

  it("leaves the route's duration before the arrival", () => {
    const departure = departureForArrival(arrival, 5_400);
    expect(departure).toEqual({ kind: "future", at: new Date(2026, 5, 21, 16, 30).toISOString() });
  });

  it("refuses a malformed arrival or duration", () => {
    expect(departureForArrival({ date: "2026-6-21", localTime: "18:00" }, 60)).toBeNull();
    expect(departureForArrival({ date: "2026-06-21", localTime: "25:00" }, 60)).toBeNull();
    expect(departureForArrival(arrival, Number.NaN)).toBeNull();
  });

  it("is late only past the tolerance", () => {
    expect(arrivalIsLate(arrival, 5_400, new Date(2026, 5, 21, 16, 40))).toBe(false);
    expect(arrivalIsLate(arrival, 5_400, new Date(2026, 5, 21, 16, 50))).toBe(true);
  });

  it("round-trips through the time intent and the datetime field", () => {
    const time = arriveByTime(arrival);
    expect(validateTimeIntent(time)).toEqual([]);
    expect(arrivalTargetOf(time)).toEqual(arrival);
    expect(arrivalTargetOf({ kind: "none" })).toBeNull();
    expect(arrivalFromInput("2026-06-21T18:00")).toEqual(arrival);
    expect(arrivalFromInput("")).toBeNull();
  });
});
