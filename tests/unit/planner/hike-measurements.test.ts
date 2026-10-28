import { describe, expect, it } from "vitest";
import { formatFeet, formatLongDuration } from "@/application/planner/measurements";

describe("hike measurements", () => {
  it("reads multi-day estimates in days and hours", () => {
    expect(formatLongDuration(79 * 60)).toBe("1 h 19 min");
    expect(formatLongDuration(4519 * 60)).toBe("3 d 3 h");
    expect(formatLongDuration(48 * 3600)).toBe("2 d");
  });
  it("groups thousands in feet without a locale", () => {
    expect(formatFeet(4383.6)).toBe("14,382 ft");
    expect(formatFeet(259)).toBe("850 ft");
    expect(formatFeet(Number.NaN)).toBe("Unknown");
  });
});
