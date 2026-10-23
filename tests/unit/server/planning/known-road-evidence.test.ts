import { describe, expect, it, vi } from "vitest";
import { memoizedKnownRoadEvidence } from "@/server/planning/known-road-evidence";
import { knownRoadEvidence, type KnownRoadsPort } from "@/application/roads/known-roads";

describe("request-local catalogue evidence", () => {
  it("preserves evidence for different lines and exact boxes, including repeated normalized copies", () => {
    const first = [{ lon: -75, lat: 40 }, { lon: -74.98, lat: 40 }];
    const second = [{ lon: -75, lat: 41 }, { lon: -74.98, lat: 41 }];
    const port: KnownRoadsPort = {
      curvyRoadsNear: bounds => bounds.south < 40.5 ? [{ id: "road", name: "Road", rating: 900, line: first }] : [],
      gravelCorridorsNear: bounds => bounds.south > 40.5 ? [{ id: "gravel", label: "Gravel", line: second, confidence: 0.9 }] : [],
    };
    const curvyRoadsNear = vi.fn(port.curvyRoadsNear);
    const gravelCorridorsNear = vi.fn(port.gravelCorridorsNear);
    const evidence = memoizedKnownRoadEvidence({ curvyRoadsNear, gravelCorridorsNear });
    expect(evidence(first)).toEqual(knownRoadEvidence(first, port));
    expect(evidence(second)).toEqual(knownRoadEvidence(second, port));
    expect(evidence(first.map(point => ({ ...point })))).toBe(evidence(first));
    expect(curvyRoadsNear).toHaveBeenCalledTimes(2);
    expect(gravelCorridorsNear).toHaveBeenCalledTimes(2);
    // Caches never survive another request.
    memoizedKnownRoadEvidence({ curvyRoadsNear, gravelCorridorsNear })(first);
    expect(curvyRoadsNear).toHaveBeenCalledTimes(3);
  });
});
