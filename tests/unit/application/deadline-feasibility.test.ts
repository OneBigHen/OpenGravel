import { describe, expect, it } from "vitest";

import { deadlineFeasibility } from "@/application/planner/deadline-feasibility";
import type { TimeIntent } from "@/domain/ride/types";

const deadline = (kind: "arriveBy" | "returnBy", hour: number): TimeIntent => ({
  kind,
  date: "2030-01-02",
  localTime: `${String(hour).padStart(2, "0")}:00`,
  toleranceMinutes: 15,
});

describe("deadline feasibility from selected route duration", () => {
  const now = new Date(2030, 0, 2, 15, 0, 0);

  it("schedules an arrive-by departure from the routed duration", () => {
    const result = deadlineFeasibility(deadline("arriveBy", 18), { kind: "now" }, 90 * 60, now);
    expect(result).toMatchObject({ status: "met", scheduledDeparture: new Date(2030, 0, 2, 16, 30, 0) });
    expect(result?.estimatedArrival).toEqual(new Date(2030, 0, 2, 18, 0, 0));
  });

  it("reports when an arrive-by deadline needs a departure in the past", () => {
    const result = deadlineFeasibility(deadline("arriveBy", 16), { kind: "now" }, 2 * 60 * 60, now);
    expect(result?.status).toBe("missed");
    expect(result?.scheduledDeparture).toBeNull();
    expect(result?.estimatedArrival).toEqual(new Date(2030, 0, 2, 17, 0, 0));
  });

  it("checks return-by against the selected departure and route time", () => {
    const result = deadlineFeasibility(deadline("returnBy", 18), { kind: "future", at: new Date(2030, 0, 2, 17, 0, 0).toISOString() }, 2 * 60 * 60, now);
    expect(result?.status).toBe("missed");
    expect(result?.estimatedArrival).toEqual(new Date(2030, 0, 2, 19, 0, 0));
  });

  it("does not invent feasibility without a deadline or a valid route duration", () => {
    expect(deadlineFeasibility({ kind: "none" }, { kind: "now" }, 60, now)).toBeNull();
    expect(deadlineFeasibility(deadline("returnBy", 18), { kind: "now" }, Number.NaN, now)).toBeNull();
  });
});
