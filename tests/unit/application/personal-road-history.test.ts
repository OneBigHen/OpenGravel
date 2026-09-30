import { describe, expect, it } from "vitest";

import {
  assessPersonalRoadHistory,
  personalRideHistory,
  personalNoveltyEvidence,
} from "@/application/roads/personal-road-history";
import type { Coordinate } from "@/domain/ride/types";

const NOW = "2026-09-30T12:00:00.000Z";
const OLD = "2026-07-01T12:00:00.000Z";
const RECENT = "2026-09-25T12:00:00.000Z";

function line(...points: readonly [number, number][]): readonly Coordinate[] {
  return points.map(([lon, lat]) => ({ lon, lat }));
}

describe("personal road history", () => {
  it("uses recorded traces rather than un-ridden imported routes and uses the ride end time", () => {
    const geometry = line([-75.30, 40.20], [-75.29, 40.20]);
    const entries = [
      { geometry, summary: { savedAt: RECENT, recordedTrack: undefined } },
      { geometry, riddenAt: OLD, summary: { savedAt: RECENT, recordedTrack: { summary: {} } } },
    ];
    expect(personalRideHistory(entries)).toEqual([{ geometry, riddenAt: OLD }]);
  });
  it("treats overlap with a saved ride as familiar without counting a crossing", () => {
    const ridden = line(
      [-75.30, 40.20],
      [-75.29, 40.20],
      [-75.28, 40.20],
    );
    const route = line(
      [-75.30, 40.20],
      [-75.29, 40.20],
      [-75.28, 40.20],
      [-75.27, 40.20],
    );
    const result = assessPersonalRoadHistory(route, [{ geometry: ridden, riddenAt: OLD }], { now: NOW });
    expect(result).not.toBeNull();
    expect(result!.familiarShare).toBeGreaterThan(0.55);
    expect(result!.familiarShare).toBeLessThan(0.8);
    expect(result!.newShare).toBeGreaterThan(0.2);

    const crossing = line(
      [-75.29, 40.19],
      [-75.29, 40.21],
    );
    const crossed = assessPersonalRoadHistory(crossing, [{ geometry: ridden, riddenAt: OLD }], { now: NOW });
    expect(crossed).not.toBeNull();
    expect(crossed!.familiarShare).toBe(0);
  });

  it("tracks recent overlap separately from all familiar road", () => {
    const first = line([-75.30, 40.20], [-75.29, 40.20]);
    const second = line([-75.29, 40.20], [-75.28, 40.20]);
    const route = line([-75.30, 40.20], [-75.29, 40.20], [-75.28, 40.20]);
    const result = assessPersonalRoadHistory(route, [
      { geometry: first, riddenAt: OLD },
      { geometry: second, riddenAt: RECENT },
    ], { now: NOW });
    expect(result).not.toBeNull();
    expect(result!.familiarShare).toBeCloseTo(1, 2);
    expect(result!.recentShare).toBeGreaterThan(0.4);
    expect(result!.recentShare).toBeLessThan(0.6);
  });

  it("keeps no local history unknown rather than claiming every road is new", () => {
    const route = line([-75.30, 40.20], [-75.29, 40.20]);
    const evidence = personalNoveltyEvidence(route, [], { now: NOW });
    expect(evidence.status).toBe("unknown");
    expect(evidence.value).toBeNull();
  });

  it("returns a scalar novelty estimate the canonical scorer can consume", () => {
    const ridden = line([-75.30, 40.20], [-75.29, 40.20]);
    const route = line([-75.30, 40.20], [-75.29, 40.20], [-75.28, 40.20]);
    const evidence = personalNoveltyEvidence(route, [{ geometry: ridden, riddenAt: OLD }], { now: NOW });
    expect(evidence.status).toBe("estimated");
    expect(evidence.value).not.toBeNull();
    expect(evidence.value!).toBeGreaterThan(0.4);
    expect(evidence.value!).toBeLessThan(0.6);
    expect(evidence.provenance[0]?.category).toBe("rider");
  });
});
