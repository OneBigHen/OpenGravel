import { describe, expect, it } from "vitest";
import {
  localDateValue,
  rideTimeWindow,
} from "@/application/explore/time-lens";

describe("Ride time lens", () => {
  it("uses Friday evening through Sunday, including the weekend already in progress", () => {
    for (const day of [2, 3, 4]) {
      const window = rideTimeWindow("weekend", "", new Date(2026, 9, day, 12));
      expect(localDateValue(window.start)).toBe("2026-10-02");
      expect(window.start.getHours()).toBe(18);
      expect(localDateValue(window.end)).toBe("2026-10-05");
      expect(window.end.getHours()).toBe(0);
    }
  });
  it("advances next weekend and uses civil midnight for a picked date", () => {
    const next = rideTimeWindow("next-weekend", "", new Date(2026, 9, 4, 12));
    expect(localDateValue(next.start)).toBe("2026-10-09");
    expect(localDateValue(next.end)).toBe("2026-10-12");
    const picked = rideTimeWindow("date", "2026-11-01", new Date(2026, 9, 4));
    expect(localDateValue(picked.start)).toBe("2026-11-01");
    expect(picked.start.getHours()).toBe(0);
    expect(localDateValue(picked.end)).toBe("2026-11-02");
  });
  it("treats Now as an instant rather than the rest of today", () => {
    const now = new Date("2026-10-03T12:00:00Z");
    const window = rideTimeWindow("now", "", now);
    expect(window.start.getTime()).toBe(now.getTime());
    expect(window.end.getTime() - window.start.getTime()).toBe(1);
  });
});
