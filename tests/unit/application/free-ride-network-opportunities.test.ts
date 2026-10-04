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
            exitNodeId: "n4",
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
  it("rejects a route that rides the corridor backwards or out of order", () => {
    const fragment = [at(-75.49), at(-75.48), at(-75.47)];
    const reversed = freeRideFragmentTraversalRatio(
      [at(-75.46), at(-75.47), at(-75.48), at(-75.49), at(-75.5)],
      fragment,
    );

    expect(reversed).toBeLessThan(0.6);
  });

  it("rejoins on the straightest forward continuation, never a U-turn", () => {
    const base = document();
    const network = buildFreeRideNetwork({
      ...base,
      segments: [
        ...base.segments,
        // Sorts before "rejoin" by id, but bends 90 degrees north.
        {
          id: "a-side-road",
          fromNodeId: "n3",
          toNodeId: "n6",
          geometry: [at(-75.47), at(-75.47, 40.01)],
          lengthMeters: 1_100,
        },
        // A U-turn back down the corridor is never a rejoin.
        segment("a-back", "n3", "n2", -75.47, -75.48),
      ],
    });

    const opportunity = findFreeRideNetworkOpportunities(
      network,
      at(-75.499),
      90,
      35,
    )[0];

    expect(opportunity?.destination).toEqual(at(-75.46));
  });

  it("measures the trigger distance along the shortest directed path ahead", () => {
    const network = buildFreeRideNetwork({
      schemaVersion: 1,
      sourceBuild: "shortest-v1",
      graphVersion: "graph-v1",
      segments: [
        segment("approach", "n0", "n1", -75.5, -75.49),
        { ...segment("detour-a", "n1", "n7", -75.49, -75.485), lengthMeters: 3_000 },
        { ...segment("detour-b", "n7", "n8", -75.485, -75.48), lengthMeters: 3_000 },
        segment("direct", "n1", "n8", -75.49, -75.48),
        segment("prize", "n8", "n9", -75.48, -75.47),
        segment("onward", "n9", "n10", -75.47, -75.46),
      ],
      corridors: [{
        id: "prize-corridor",
        segmentIds: ["prize"],
        entryNodeId: "n8",
        exitNodeId: "n9",
        expectedUtility: 0.9,
        confidence: 0.9,
      }],
    });

    const opportunity = findFreeRideNetworkOpportunities(
      network,
      at(-75.499),
      90,
      35,
    )[0];

    // Remaining approach (~765 m) plus the 850 m direct link, not the 6 km detour.
    expect(opportunity?.triggerDistanceMeters).toBeGreaterThan(1_000);
    expect(opportunity?.triggerDistanceMeters).toBeLessThan(2_000);
  });

  it("searches a large regional network quickly enough to run while riding", () => {
    const size = 90;
    const segments: FreeRideNetworkSegment[] = [];
    const step = 0.004;
    const node = (x: number, y: number): string => `g${x}_${y}`;
    for (let x = 0; x < size; x += 1) {
      for (let y = 0; y < size; y += 1) {
        const lon = -76 + x * step;
        const lat = 40 + y * step;
        if (x + 1 < size) {
          segments.push({
            id: `e${x}_${y}`,
            fromNodeId: node(x, y),
            toNodeId: node(x + 1, y),
            geometry: [at(lon, lat), at(lon + step, lat)],
            lengthMeters: 340,
          });
        }
        if (y + 1 < size) {
          segments.push({
            id: `n${x}_${y}`,
            fromNodeId: node(x, y),
            toNodeId: node(x, y + 1),
            geometry: [at(lon, lat), at(lon, lat + step)],
            lengthMeters: 445,
          });
        }
      }
    }
    const network = buildFreeRideNetwork({
      schemaVersion: 1,
      sourceBuild: "grid-v1",
      graphVersion: "graph-v1",
      segments,
      corridors: [{
        id: "grid-corridor",
        segmentIds: ["e20_10", "e21_10"],
        entryNodeId: node(20, 10),
        exitNodeId: node(22, 10),
        expectedUtility: 0.8,
        confidence: 0.8,
      }],
    });

    const started = performance.now();
    const opportunities = findFreeRideNetworkOpportunities(
      network,
      at(-76 + 0.0005, 40 + 10 * step),
      90,
      70,
    );
    const elapsed = performance.now() - started;

    expect(segments.length).toBeGreaterThan(15_000);
    expect(opportunities.map((item) => item.corridorId)).toEqual(["grid-corridor"]);
    expect(elapsed).toBeLessThan(1_500);
  });
});
