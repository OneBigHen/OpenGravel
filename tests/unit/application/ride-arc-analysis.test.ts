import { describe, expect, it } from "vitest";

import {
  analyzeRideArc,
  type RideArcSegment,
} from "@/application/planner/ride-arc-analysis";

function segment(
  id: string,
  minutes: number,
  worthwhile: number | null,
  miles = minutes * 0.7,
): RideArcSegment {
  return {
    id,
    durationSeconds: minutes * 60,
    distanceMeters: miles * 1609.344,
    worthwhile,
  };
}

describe("Ride Arc analysis", () => {
  it("finds an efficient escape, sustained core and terminal leg from evidence", () => {
    const result = analyzeRideArc([
      segment("escape-1", 5, 0.2),
      segment("escape-2", 5, 0.35),
      segment("core-1", 10, 0.8),
      segment("bridge", 1, 0.4),
      segment("core-2", 12, 0.9),
      segment("return-1", 6, 0.3),
      segment("return-2", 5, 0.25),
    ]);

    expect(result).not.toBeNull();
    expect(result!.coreDetected).toBe(true);
    expect(result!.escape?.durationSeconds).toBe(10 * 60);
    expect(result!.core?.durationSeconds).toBe(23 * 60);
    expect(result!.terminal?.durationSeconds).toBe(11 * 60);
    expect(result!.coreBridgeSeconds).toBe(60);
    expect(result!.coreWorthwhileShare).toBeCloseTo(22 / 23);
    expect(result!.worthwhileMinuteRatio).toBeCloseTo(22 / 44);
  });

  it("splits core candidates across a long low-value connector and picks the stronger sustained run", () => {
    const result = analyzeRideArc(
      [
        segment("escape", 5, 0.2),
        segment("good-a", 9, 0.8),
        segment("long-filler", 5, 0.25),
        segment("good-b1", 7, 0.85),
        segment("good-b2", 8, 0.9),
        segment("return", 5, 0.2),
      ],
      {
        maximumBridgeSeconds: 120,
        minimumCoreWorthwhileSeconds: 6 * 60,
      },
    );

    expect(result).not.toBeNull();
    expect(result!.coreDetected).toBe(true);
    expect(result!.core?.startSegmentIndex).toBe(3);
    expect(result!.core?.endSegmentIndex).toBe(4);
    expect(result!.core?.durationSeconds).toBe(15 * 60);
  });

  it("bridges a short unknown connector without pretending it is worthwhile", () => {
    const result = analyzeRideArc(
      [
        segment("escape", 4, 0.2),
        segment("good-a", 7, 0.8),
        segment("unknown-short", 1, null),
        segment("good-b", 7, 0.85),
        segment("return", 4, 0.2),
      ],
      {
        minimumCoreWorthwhileSeconds: 10 * 60,
        maximumBridgeSeconds: 90,
      },
    );

    expect(result).not.toBeNull();
    expect(result!.coreDetected).toBe(true);
    expect(result!.coreBridgeSeconds).toBe(60);
    expect(result!.unknownEvidenceSeconds).toBe(60);
    expect(result!.worthwhileSeconds).toBe(14 * 60);
    expect(result!.worthwhileMinuteRatio).toBeCloseTo(14 / 23);
  });

  it("refuses phase claims when ordered evidence coverage is too sparse", () => {
    const result = analyzeRideArc([
      segment("unknown-1", 10, null),
      segment("good", 10, 0.9),
      segment("unknown-2", 10, null),
    ]);

    expect(result).not.toBeNull();
    expect(result!.evidenceCoverage).toBeCloseTo(1 / 3);
    expect(result!.worthwhileMinuteRatio).toBeCloseTo(1 / 3);
    expect(result!.coreDetected).toBe(false);
    expect(result!.escape).toBeNull();
    expect(result!.core).toBeNull();
    expect(result!.terminal).toBeNull();
  });

  it("does not invent a core when known roads never sustain worthwhile riding", () => {
    const result = analyzeRideArc([
      segment("one", 10, 0.3),
      segment("two", 10, 0.5),
      segment("three", 10, 0.4),
    ]);

    expect(result).not.toBeNull();
    expect(result!.evidenceCoverage).toBe(1);
    expect(result!.coreDetected).toBe(false);
    expect(result!.worthwhileSeconds).toBe(0);
  });

  it("requires enough worthwhile time, not merely one high-value fragment", () => {
    const result = analyzeRideArc([
      segment("escape", 10, 0.2),
      segment("tiny-perfect", 2, 1),
      segment("return", 10, 0.2),
    ]);

    expect(result).not.toBeNull();
    expect(result!.coreDetected).toBe(false);
    expect(result!.worthwhileMinuteRatio).toBeCloseTo(2 / 22);
  });

  it("uses caller policy for a shorter Quick Ride without changing the analyzer", () => {
    const result = analyzeRideArc(
      [
        segment("out", 4, 0.25),
        segment("good", 6, 0.75),
        segment("home", 4, 0.3),
      ],
      {
        minimumCoreWorthwhileSeconds: 5 * 60,
        minimumCoreWorthwhileShare: 0.7,
      },
    );

    expect(result).not.toBeNull();
    expect(result!.coreDetected).toBe(true);
    expect(result!.escape?.durationSeconds).toBe(4 * 60);
    expect(result!.core?.durationSeconds).toBe(6 * 60);
    expect(result!.terminal?.durationSeconds).toBe(4 * 60);
  });

  it("fails closed on malformed segment evidence or policy", () => {
    expect(
      analyzeRideArc([
        segment("bad", 5, 1.2),
      ]),
    ).toBeNull();

    expect(
      analyzeRideArc(
        [segment("good", 10, 0.9)],
        { minimumEvidenceCoverage: 1.2 },
      ),
    ).toBeNull();
  });
});
