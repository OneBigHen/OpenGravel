import { describe, expect, it } from "vitest";

import {
  discoverRoads,
  filterRoadCandidates,
  type RoadDiscoveryRoad,
} from "@/application/roads/discovery";
import { createRoadEntity } from "@/domain/roads/road-entity";
import type { RoadEvidenceRecord } from "@/application/roads/road-evidence";

const evidence = (value: string, id: string, confidence = 0.9): RoadEvidenceRecord => ({
  id,
  entityId: createRoadEntity({
    name: "unused",
    class: "secondary",
    endpoints: [{ lon: -75.5, lat: 40.5 }, { lon: -75.4, lat: 40.6 }],
    firstSeen: "2026-09-01T00:00:00.000Z",
    lastSeen: "2026-09-17T00:00:00.000Z",
  }).id,
  source: "recorded-ride",
  observedAt: "2026-09-17T00:00:00.000Z",
  value,
  confidence,
});

function road(
  name: string,
  overrides: Partial<RoadDiscoveryRoad> = {},
): RoadDiscoveryRoad {
  return {
    entity: createRoadEntity({
      name,
      class: "secondary",
      endpoints: [{ lon: -75.5, lat: 40.5 }, { lon: -75.4, lat: 40.6 }],
      firstSeen: "2026-09-01T00:00:00.000Z",
      lastSeen: "2026-09-17T00:00:00.000Z",
    }),
    geometry: [
      { lon: -75.5, lat: 40.5 },
      { lon: -75.45, lat: 40.55 },
      { lon: -75.4, lat: 40.6 },
    ],
    matchedDistanceKm: 1,
    matchedRideCount: 1,
    region: "Lehigh Valley",
    evidence: [],
    ...overrides,
  };
}

describe("road discovery", () => {
  it("ranks deterministically from measured distance, evidence, conflict, and geometry proxy", () => {
    const roads = [
      road("Evidence road", {
        matchedDistanceKm: 3,
        evidence: [{
          ...evidence("gravel", "evidence-gravel"),
          entityId: road("Evidence road").entity.id,
        }],
      }),
      road("Long road", { matchedDistanceKm: 10, matchedRideCount: 0 }),
      road("Short road", { matchedDistanceKm: 3, matchedRideCount: 2 }),
    ];

    const first = discoverRoads({ roads });
    const second = discoverRoads({ roads: [...roads].reverse() });

    expect(first.map((candidate) => candidate.entity.name)).toEqual([
      "Long road",
      "Evidence road",
      "Short road",
    ]);
    expect(second.map((candidate) => candidate.entity.name)).toEqual(first.map((candidate) => candidate.entity.name));
  });

  it("assigns gravel, unknown-surface, and new-to-me slices without fabricating known surface", () => {
    const ridden = road("Ridden gravel", { matchedRideCount: 2, evidence: [{
      ...evidence("gravel", "ridden-gravel"),
      entityId: road("Ridden gravel").entity.id,
    }] });
    const unknown = road("Unseen track", {
      matchedRideCount: 0,
      evidence: [],
      entity: createRoadEntity({
        name: "Unseen track",
        class: "track",
        endpoints: [{ lon: -75.7, lat: 40.5 }, { lon: -75.6, lat: 40.6 }],
        firstSeen: "2026-09-01T00:00:00.000Z",
        lastSeen: "2026-09-17T00:00:00.000Z",
      }),
    });

    const candidates = discoverRoads({ roads: [ridden, unknown], riddenRoadIds: [ridden.entity.id] });
    const gravel = candidates.find((candidate) => candidate.entity.name === "Ridden gravel");
    const unseen = candidates.find((candidate) => candidate.entity.name === "Unseen track");

    expect(gravel?.slices).toContain("gravel");
    expect(gravel?.surfaceValue).toBe("gravel");
    expect(gravel?.slices).not.toContain("new-to-me");
    expect(unseen?.surfaceValue).toBe("unknown");
    expect(unseen?.slices).toEqual(expect.arrayContaining(["gravel", "new-to-me"]));
  });

  it("keeps WHY signals tied to available facts and names the geometry curvature proxy", () => {
    const candidate = discoverRoads({
      roads: [road("Why road", {
        matchedDistanceKm: 4.25,
        matchedRideCount: 2,
        evidence: [{
          ...evidence("gravel", "why-gravel"),
          entityId: road("Why road").entity.id,
        }],
      })],
    })[0];

    expect(candidate?.whyLine).toContain("matched on 2 rides");
    expect(candidate?.whyLine).toContain("gravel likely");
    expect(candidate?.whyLine).toContain("observed geometry curvature proxy");
    expect(candidate?.why.every((signal) => signal.kind !== "evidence-agreement" || signal.label.includes("agrees"))).toBe(true);
  });

  it("returns no candidates for empty roads and filters surface and near-me results honestly", () => {
    expect(discoverRoads({ roads: [] })).toEqual([]);

    const candidates = discoverRoads({ roads: [road("Nearby", {
      geometry: [{ lon: -75.5, lat: 40.5 }, { lon: -75.49, lat: 40.51 }],
      evidence: [],
    }), road("Far", {
      geometry: [{ lon: -80, lat: 45 }, { lon: -79.99, lat: 45.01 }],
      evidence: [],
    })] });

    expect(filterRoadCandidates(candidates, { surface: "unknown", origin: [-75.5, 40.5] })
      .map((candidate) => candidate.entity.name)).toEqual(["Nearby", "Far"]);
    expect(filterRoadCandidates(candidates, { surface: "unknown", origin: [-75.5, 40.5], maxDistanceKm: 50 })
      .map((candidate) => candidate.entity.name)).toEqual(["Nearby"]);
  });
});
