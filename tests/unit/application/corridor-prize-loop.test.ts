import { describe, expect, it } from "vitest";

import {
  searchCorridorPrizeLoops,
  type ConnectorTimeEstimator,
  type CorridorPrize,
} from "@/application/planner/corridor-prize-loop";
import type { Coordinate } from "@/domain/ride/types";

function at(lon: number, lat = 40): Coordinate {
  return { lon, lat };
}

const origin = at(-75.5);

function prize(
  id: string,
  entryLon: number,
  exitLon: number,
  traversalSeconds: number,
  utility: number,
  groupId?: string,
): CorridorPrize {
  return {
    id,
    entry: at(entryLon),
    exit: at(exitLon),
    traversalSeconds,
    utility,
    ...(groupId === undefined ? {} : { groupId }),
  };
}

const estimate: ConnectorTimeEstimator = (from, to) => {
  const degrees = Math.abs(to.lon - from.lon) + Math.abs(to.lat - from.lat);
  return degrees * 10_000;
};

describe("corridor-prize loop beam", () => {
  it("reserves the return home inside the time budget", () => {
    const results = searchCorridorPrizeLoops({
      origin,
      budgetSeconds: 1_800,
      prizes: [
        prize("near", -75.49, -75.48, 600, 0.9),
        prize("far", -75.40, -75.39, 600, 1),
      ],
      estimateConnectorSeconds: estimate,
      options: {
        maxPrizes: 2,
        maxConnectorShare: 0.7,
        minimumPrizeUtility: 0,
      },
    });

    expect(results.length).toBeGreaterThan(0);
    expect(results.every((result) => result.estimatedSeconds <= 1_800)).toBe(true);
    expect(results.some((result) => result.prizeIds.includes("far"))).toBe(false);
  });

  it("prefers sustained high-value corridor time over a tiny flashy fragment", () => {
    const results = searchCorridorPrizeLoops({
      origin,
      budgetSeconds: 3_000,
      prizes: [
        prize("tiny-perfect", -75.49, -75.485, 120, 1),
        prize("sustained", -75.48, -75.46, 900, 0.8),
      ],
      estimateConnectorSeconds: estimate,
      options: {
        maxPrizes: 1,
        minimumPrizeUtility: 0,
        maxConnectorShare: 0.8,
      },
    });

    expect(results[0]?.prizeIds).toEqual(["sustained"]);
    expect(results[0]!.collectedValueSeconds).toBeGreaterThan(
      results.find((result) => result.prizeIds[0] === "tiny-perfect")!
        .collectedValueSeconds,
    );
  });

  it("rejects sequences that spend too much time connecting prizes", () => {
    const loose = searchCorridorPrizeLoops({
      origin,
      budgetSeconds: 4_000,
      prizes: [
        prize("remote", -75.35, -75.34, 500, 1),
      ],
      estimateConnectorSeconds: estimate,
      options: {
        maxConnectorShare: 0.9,
        minimumPrizeUtility: 0,
      },
    });
    const strict = searchCorridorPrizeLoops({
      origin,
      budgetSeconds: 4_000,
      prizes: [
        prize("remote", -75.35, -75.34, 500, 1),
      ],
      estimateConnectorSeconds: estimate,
      options: {
        maxConnectorShare: 0.3,
        minimumPrizeUtility: 0,
      },
    });

    expect(loose.length).toBeGreaterThan(0);
    expect(strict).toEqual([]);
  });

  it("does not collect two overlapping windows from the same source group", () => {
    const results = searchCorridorPrizeLoops({
      origin,
      budgetSeconds: 5_000,
      prizes: [
        prize("window-a", -75.49, -75.47, 700, 0.9, "source-1"),
        prize("window-b", -75.47, -75.45, 700, 0.9, "source-1"),
        prize("different", -75.45, -75.43, 700, 0.7, "source-2"),
      ],
      estimateConnectorSeconds: estimate,
      options: {
        maxPrizes: 3,
        maxConnectorShare: 0.8,
        minimumPrizeUtility: 0,
      },
    });

    expect(
      results.every(
        (result) =>
          !(
            result.prizeIds.includes("window-a") &&
            result.prizeIds.includes("window-b")
          ),
      ),
    ).toBe(true);
  });

  it("filters weak prizes before beam expansion", () => {
    const results = searchCorridorPrizeLoops({
      origin,
      budgetSeconds: 3_000,
      prizes: [
        prize("weak", -75.49, -75.48, 900, 0.2),
        prize("useful", -75.48, -75.46, 900, 0.7),
      ],
      estimateConnectorSeconds: estimate,
      options: {
        minimumPrizeUtility: 0.35,
        maxConnectorShare: 0.8,
      },
    });

    expect(results.length).toBeGreaterThan(0);
    expect(results.every((result) => !result.prizeIds.includes("weak"))).toBe(true);
  });

  it("returns a bounded deterministic result set with ordered provider anchors", () => {
    const prizes = [
      prize("a", -75.49, -75.48, 500, 0.8),
      prize("b", -75.47, -75.46, 500, 0.7),
      prize("c", -75.45, -75.44, 500, 0.6),
      prize("d", -75.43, -75.42, 500, 0.5),
    ];
    const input = {
      origin,
      budgetSeconds: 5_000,
      prizes,
      estimateConnectorSeconds: estimate,
      options: {
        maxPrizes: 3,
        beamWidth: 4,
        maxResults: 2,
        minimumPrizeUtility: 0,
        maxConnectorShare: 0.8,
      },
    } as const;

    const first = searchCorridorPrizeLoops(input);
    const second = searchCorridorPrizeLoops(input);

    expect(first).toEqual(second);
    expect(first.length).toBeLessThanOrEqual(2);
    for (const result of first) {
      expect(result.prizeIds.length).toBeLessThanOrEqual(3);
      expect(result.anchors).toHaveLength(result.prizeIds.length * 2);
      expect(result.budgetUtilization).toBeLessThanOrEqual(1);
    }
  });

  it("fails closed on malformed options and unusable connector estimates", () => {
    expect(
      searchCorridorPrizeLoops({
        origin,
        budgetSeconds: 3_000,
        prizes: [prize("a", -75.49, -75.48, 500, 0.8)],
        estimateConnectorSeconds: () => null,
      }),
    ).toEqual([]);

    expect(
      searchCorridorPrizeLoops({
        origin,
        budgetSeconds: 3_000,
        prizes: [prize("a", -75.49, -75.48, 500, 0.8)],
        estimateConnectorSeconds: estimate,
        options: { beamWidth: 0 },
      }),
    ).toEqual([]);
  });

  it("keeps a wasteful first leg alive when a second corridor closes an efficient loop", () => {
    // Out east on one corridor, back west on a parallel one. Either corridor
    // alone is mostly connector; together they make a tight loop.
    const results = searchCorridorPrizeLoops({
      origin,
      budgetSeconds: 10_000,
      prizes: [
        { id: "east", entry: at(-75.49), exit: at(-75.4), traversalSeconds: 900, utility: 0.8 },
        { id: "west", entry: at(-75.4, 40.02), exit: at(-75.49, 40.02), traversalSeconds: 900, utility: 0.8 },
      ],
      estimateConnectorSeconds: estimate,
      options: { maxPrizes: 2, maxConnectorShare: 0.45, minimumPrizeUtility: 0 },
    });

    expect(results.map((result) => result.prizeIds)).toContainEqual(["east", "west"]);
    expect(results.every((result) => result.connectorShare <= 0.45)).toBe(true);
  });
});
