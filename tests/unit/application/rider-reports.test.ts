import { describe, expect, it } from "vitest";

import { validateAvoidAreaRings } from "@/application/planner/avoid-area-geometry";
import {
  addReport,
  avoidingSpotsSentence,
  newRiderReport,
  parseReports,
  reportMarkerText,
  reportsToAvoidAreas,
  RIDER_REPORT_LIFETIME_MS,
} from "@/application/roads/rider-reports";
import { haversine } from "@/domain/geometry/analysis";

const NOW = Date.UTC(2026, 10, 11, 12);
const point = { lon: -77.9, lat: 40.9 };
const make = (id: string, p = point, kind: "gate-closed" | "road-bad" = "gate-closed", at = NOW) =>
  newRiderReport({ id, point: p, headingDegrees: 90, kind, nowMs: at });

describe("rider reports", () => {
  it("makes a box the avoid-area validator accepts, around the point", () => {
    const [area] = reportsToAvoidAreas([make("a")], NOW);
    expect(area).toBeDefined();
    expect(validateAvoidAreaRings([area!.ring])).toBeNull();
    for (const corner of area!.ring) expect(haversine(corner, point)).toBeGreaterThan(60);
  });
  it("gives nothing for a report older than 30 days", () => {
    const old = make("old", point, "gate-closed", NOW - RIDER_REPORT_LIFETIME_MS - 1000);
    expect(reportsToAvoidAreas([old], NOW)).toEqual([]);
    expect(reportsToAvoidAreas([make("fresh", point, "gate-closed", NOW - RIDER_REPORT_LIFETIME_MS + 60_000)], NOW)).toHaveLength(1);
  });
  it("merges two reports 20 m apart but not 200 m apart", () => {
    const near = { lon: point.lon, lat: point.lat + 20 / 111_320 };
    const far = { lon: point.lon, lat: point.lat + 200 / 111_320 };
    expect(addReport([make("a")], make("b", near), NOW).map((r) => r.id)).toEqual(["b"]);
    expect(addReport([make("a")], make("c", far), NOW)).toHaveLength(2);
  });
  it("drops garbage when reading storage", () => {
    expect(parseReports("nope")).toEqual([]);
    expect(parseReports(JSON.stringify([{ id: "x" }, make("ok")]))).toHaveLength(1);
  });
  it("never says closed in the truth line, and counts apart", () => {
    expect(avoidingSpotsSentence(0)).toBeNull();
    expect(avoidingSpotsSentence(1)).toBe("Avoiding 1 spot you reported.");
    expect(avoidingSpotsSentence(2)).toBe("Avoiding 2 spots you reported.");
    expect(avoidingSpotsSentence(2)).not.toMatch(/closed|open|clear/i);
    expect(reportMarkerText(make("a"), "en-US")).toBe("You marked this gate closed on Nov 11");
  });
});

import { withRiderReportSentence } from "@/application/planner/ride-truth";

describe("truth line with rider reports", () => {
  const base = { tone: "good" as const, text: "Checked 9:14 AM: 4 sources, no closures on this route" };
  it("adds the spot sentence without changing the tone or saying closed", () => {
    const line = withRiderReportSentence(base, { avoided: 1, couldNotAvoid: false });
    expect(line.text).toBe("Checked 9:14 AM: 4 sources, no closures on this route. Avoiding 1 spot you reported.");
    expect(line.tone).toBe("good");
  });
  it("keeps an unknown check unknown", () => {
    const line = withRiderReportSentence({ tone: "unknown", text: "Closure check did not answer" }, { avoided: 2, couldNotAvoid: false });
    expect(line.tone).toBe("unknown");
  });
  it("says when it could not avoid, and leaves the line alone with no reports", () => {
    expect(withRiderReportSentence(base, { avoided: 0, couldNotAvoid: true }).text).toMatch(/Could not avoid the spot you reported\.$/);
    expect(withRiderReportSentence(base, { avoided: 0, couldNotAvoid: false })).toBe(base);
  });
});
