/**
 * Which departure the map's daylight split is about
 * (docs/vnext/design/MAP-EXPERIENCE-NEXT.md Wave 2, item 8).
 *
 * The briefing already resolves an arrive-by ride to its own departure; the map
 * annotates the same ride, so it has to read the same instant. A ride that leaves
 * "now" needs a clock the hook owns, and this pins the pure part of that decision.
 */

import { describe, expect, it } from "vitest";

import { plannerDepartureOf } from "@/ui/planner/hooks/usePlannerDaylight";
import { arriveByTime } from "@/application/planner/arrive-by";

describe("plannerDepartureOf", () => {
  it("keeps an authored departure that already has an instant", () => {
    expect(
      plannerDepartureOf({
        departure: { kind: "future", at: "2026-09-17T22:30:00.000Z" },
        time: { kind: "none" },
        durationSeconds: 6_000,
      }),
    ).toEqual({ kind: "future", at: "2026-09-17T22:30:00.000Z" });
  });

  it("leaves when it must to arrive on time, as the briefing does", () => {
    // Arrive by 6:00 PM local for a 100-minute ride: leave at 4:20 PM.
    const departure = plannerDepartureOf({
      departure: { kind: "now" },
      time: arriveByTime({ date: "2026-09-17", localTime: "18:00" }),
      durationSeconds: 6_000,
    });

    expect(departure.kind).toBe("future");
    const at = departure.kind === "future" ? new Date(departure.at).getTime() : Number.NaN;
    expect(new Date(at).getHours()).toBe(16);
    expect(new Date(at).getMinutes()).toBe(20);
  });

  it("keeps the authored departure when there is no route to time", () => {
    expect(
      plannerDepartureOf({
        departure: { kind: "now" },
        time: arriveByTime({ date: "2026-09-17", localTime: "18:00" }),
        durationSeconds: null,
      }),
    ).toEqual({ kind: "now" });
  });
});
