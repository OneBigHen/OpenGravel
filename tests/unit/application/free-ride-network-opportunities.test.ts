import { describe, expect, it } from "vitest";

import {
  buildFreeRideNetwork,
  findFreeRideNetworkOpportunities,
  freeRideFragmentTraversalRatio,
  freeRideNetworkHorizonMeters,
  type FreeRideNetworkDocument,
  type FreeRideNetworkSegment,
} from "@/application/free-ride/network-opportunities";
import type { Coordinate } from "@/domain/ride/types";

function at(lon: number, lat = 40): Coordinate {
  return { lon, lat };
}

function segment(
  id: string,
  fromNodeId: string,
  toNodeId: string,
  fromLon: number,
  toLon: number,
): FreeRideNetworkSegment {
  return {
    id,
    fromNodeId,
    toNodeId,
    geometry: [at(fromLon), at(toLon)],
    lengthMeters: 850,
  };
}

function document(): FreeRideNetworkDocument {
  return {
    schemaVersion: 1,
    sourceBuild: "fixture-v1",
    graphVersion: "graph-v1",
    segments: [
      segment("approach", "n0", "n1", -75.5, -75.49),
      segment("good-a", "n1", "n2", -75.49, -75.48),
      segment("good-b", "n2", "n3", -75.48, -75.47),
      segment("rejoin", "n3", "n4", -75.47, -75.46),
      segment("other", "n1", "n5", -75.49, -75.49),
    ],
    corridors: [
      {
        id: "good-corridor",
        segmentIds: ["good-a", "good-b"],
        entryNodeId: "n1",
        exitNodeId: "n3",
        expectedUtility: 0.9,
        confidence: 0.8,
      },
    ],
  };
}

describe("Free Ride directed network opportunities", () => {
  it("validates and indexes a contiguous directed corridor network", () => {
    const network = buildFreeRideNetwork(document());

    expect(network.segmentsById.get("good-a")?.fromNodeId).toBe("n1");
    expect(network.outgoingByNode.get("n1")?.map((item) => item.id)).toEqual([
      "good-a",
      "other",
    ]);
  });

  it("rejects a corridor whose segment chain is not directed and contiguous", () => {
    const broken = document();
    expect(() =>
      buildFreeRideNetwork({
        ...broken,
        corridors: [
          {
            ...broken.corridors[0]!,
            segmentIds: ["good-a", "rejoin"],
          },
        ],
      }),
    ).toThrow(/contiguous directed path/i);
  });

  it("finds a worthwhile corridor ahead only when it has an onward rejoin", () => {
    const network = buildFreeRideNetwork(document());
    const opportunities = findFreeRideNetworkOpportunities(
      network,
      at(-75.499),
      90,
      35,
    );

    expect(opportunities).toHaveLength(1);
    const opportunity = opportunities[0]!;
    expect(opportunity.corridorId).toBe("good-corridor");
    expect(opportunity.triggerDistanceMeters).toBeGreaterThanOrEqual(400);
    expect(opportunity.via).toEqual([at(-75.49), at(-75.47)]);
    expect(opportunity.destination).toEqual(at(-75.46));
    expect(opportunity.routeFragment).toEqual([
      at(-75.49),
      at(-75.48),
      at(-75.47),
    ]);
  });

  it("does not offer a corridor the rider recently used", () => {
    const network = buildFreeRideNetwork(document());
    const opportunities = findFreeRideNetworkOpportunities(
      network,
      at(-75.499),
      90,
      35,
      new Set(["good-b"]),
    );

    expect(opportunities).toEqual([]);
  });

  it("requires an onward rejoin instead of suggesting a dead-end prize", () => {
    const base = document();
    const network = buildFreeRideNetwork({
      ...base,
      segments: base.segments.filter((item) => item.id !== "rejoin"),
    });

    expect(
      findFreeRideNetworkOpportunities(network, at(-75.499), 90, 35),
    ).toEqual([]);
  });

  it("rejects a current segment that points behind the rider", () => {
    const network = buildFreeRideNetwork(document());
    expect(
      findFreeRideNetworkOpportunities(network, at(-75.499), 270, 35),
    ).toEqual([]);
  });

  it("scales the forward search horizon with riding speed", () => {
    expect(freeRideNetworkHorizonMeters(undefined)).toBeCloseTo(6 * 1_609.344);
    expect(freeRideNetworkHorizonMeters(35)).toBeCloseTo(10 * 1_609.344);
    expect(freeRideNetworkHorizonMeters(55)).toBeCloseTo(16 * 1_609.344);
    expect(freeRideNetworkHorizonMeters(70)).toBeCloseTo(22 * 1_609.344);
  });

  it("measures whether a routed result actually traversed the opportunity fragment", () => {
    const fragment = [at(-75.49), at(-75.48), at(-75.47)];
    const followed = freeRideFragmentTraversalRatio(
      [
        at(-75.5),
        at(-75.49),
        at(-75.48),
        at(-75.47),
        at(-75.46),
      ],
      fragment,
    );
    const crossing = freeRideFragmentTraversalRatio(
      [
        at(-75.48, 39.99),
        at(-75.48, 40.01),
      ],
      fragment,
    );

    expect(followed).toBeGreaterThan(0.95);
    expect(crossing).toBeLessThan(0.2);
  });
});
