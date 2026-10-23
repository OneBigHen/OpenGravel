import { describe, expect, it } from "vitest";
import { approachBlocksFor, finalApproachTargets, blockedRoadOverlap } from "@/application/planner/final-approach";
import type { ProviderCandidate } from "@/application/planner/route-provider";
import { haversine } from "@/domain/geometry/analysis";
import type { Coordinate } from "@/domain/ride/types";
import type { RoadAuthorityVerdict } from "@/application/route-intelligence/coordinator";
import { unknownEvidence } from "@/domain/evidence/types";

const point = (meters: number): Coordinate => ({ lon: -75, lat: 40 + meters / 111_195 });
const line = Array.from({ length: 101 }, (_, i) => point(i * 100));
function verdict(start: number, end: number): RoadAuthorityVerdict {
  return {
    failures: [{ code: "access-prohibited", message: "Closed to motorcycles." }], warnings: [],
    blockedRoads: [{ code: "access-prohibited", geometry: { type: "line", coordinates: [point(start), point(end)] } }],
    evidence: { access: unknownEvidence("unknown"), closures: unknownEvidence("unknown") },
  };
}

describe("final approach decisions", () => {
  const candidate = (restricted: "private" | null, start: number, sand = false): ProviderCandidate => {
    const total = haversine(line[0]!, line.at(-1)!);
    const run = { durationSeconds: null, surface: sand ? "sand" : "asphalt", roadClass: "service", roadEnvironment: "road", urbanDensity: "rural", curvatureRatio: null, toll: null };
    return { providerId: "router", profile: "motorcycle_fastest", geometry: line, distanceMeters: total, durationSeconds: 600,
      roadSummary: { totalMeters: total, surfaceByRoadClassMeters: {}, curvatureMeters: {}, tollMeters: 0,
        roadRuns: [{ ...run, meters: start, roadAccess: "yes" }, { ...run, meters: total - start, roadAccess: restricted }] } };
  };
  it("engine access unknown cannot authorize fallback; sand does not masquerade as an access block", () => {
    expect(approachBlocksFor(candidate(null, 9500), null)).toBeNull();
    expect(approachBlocksFor(candidate("private", 9500, true), verdict(9500, 10_000))).toBeNull();
  });
  it("engine middle blocks and incomplete ordered details cannot authorize fallback", () => {
    const middle = candidate("private", 4000);
    expect(finalApproachTargets(line, approachBlocksFor(middle, null)!)).toEqual([]);
    expect(approachBlocksFor({ ...middle, geometry: line.slice(0, 50) }, null)).toBeNull();
  });
  it("finds an approach before the first block even on a sparse two-point route", () => {
    const targets = finalApproachTargets([line[0]!, line.at(-1)!], verdict(9500, 10_000));
    expect(targets).toHaveLength(3);
    expect(targets[0]!.lat).toBeLessThan(point(9500).lat);
    expect(targets[0]!.lat).toBeGreaterThan(point(9400).lat);
    expect(blockedRoadOverlap([line[0]!, targets[0]!], verdict(9500, 10_000))).toBe(false);
  });
  it("refuses a middle block, including when the same unnamed road has a final block too", () => {
    const middle = verdict(4000, 4500);
    expect(finalApproachTargets(line, middle)).toEqual([]);
    expect(finalApproachTargets(line, { ...middle, blockedRoads: [...middle.blockedRoads!, ...verdict(9500, 10_000).blockedRoads!] })).toEqual([]);
  });
  it("accepts the last 15 percent on longer routes and the last 2 km on shorter routes", () => {
    expect(finalApproachTargets([point(0), point(30_000)], verdict(26_000, 30_000))).toHaveLength(3);
    expect(finalApproachTargets(line, verdict(8200, 10_000))).toHaveLength(3);
  });
  it("unknown, warnings, or a failure without a located blocked road cannot authorize trimming", () => {
    const blocked = verdict(9500, 10_000);
    expect(finalApproachTargets(line, { ...blocked, blockedRoads: undefined })).toEqual([]);
    expect(finalApproachTargets(line, { ...blocked, failures: [] })).toEqual([]);
    expect(finalApproachTargets(line, { ...blocked, blockedRoads: [{ code: "access-prohibited", geometry: { type: "point", coordinate: point(9800) } }] })).toEqual([]);
  });
  it("detects a newly routed line that still uses a short piece of the blocked road", () => {
    expect(blockedRoadOverlap([point(0), point(9540)], verdict(9500, 10_000))).toBe(true);
  });
});
