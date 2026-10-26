import { describe, expect, it } from "vitest";

import { surfaceReportAge } from "@/ui/explore/surface-report-copy";

const NOW = Date.parse("2026-10-20T12:00:00.000Z");
const MS_PER_DAY = 86_400_000;

/**
 * A surface report is as old as its own date says. The road detail used to print
 * the record's raw ISO timestamp, and then — once it was reading the aggregated
 * age — "Today" beside every report, because that age is measured against the
 * report itself.
 */
describe("surfaceReportAge", () => {
  it("says how old a report is in words a rider reads", () => {
    expect(surfaceReportAge("2026-10-20T08:00:00.000Z", NOW)).toBe("Today");
    expect(surfaceReportAge(new Date(NOW - MS_PER_DAY).toISOString(), NOW)).toBe("Yesterday");
    expect(surfaceReportAge(new Date(NOW - 5 * MS_PER_DAY).toISOString(), NOW)).toBe("5 days ago");
    expect(surfaceReportAge(new Date(NOW - 120 * MS_PER_DAY).toISOString(), NOW)).toBe("4 months ago");
    expect(surfaceReportAge(new Date(NOW - 400 * MS_PER_DAY).toISOString(), NOW)).toBe("A year ago");
    expect(surfaceReportAge(new Date(NOW - 800 * MS_PER_DAY).toISOString(), NOW)).toBe("2 years ago");
  });

  it("never turns an unreadable date into a fresh one", () => {
    expect(surfaceReportAge(null, NOW)).toBe("Date unknown");
    expect(surfaceReportAge(undefined, NOW)).toBe("Date unknown");
    expect(surfaceReportAge("not-a-date", NOW)).toBe("Date unknown");
    // A report dated in the future is not a claim about freshness either.
    expect(surfaceReportAge("2027-01-01T00:00:00.000Z", NOW)).toBe("Today");
  });
});
