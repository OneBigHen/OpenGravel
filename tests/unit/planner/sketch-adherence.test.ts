import { describe, expect, it } from "vitest";

import { runCandidatePipeline } from "@/application/planner/pipeline";
import type { ProviderCandidate } from "@/application/planner/route-provider";
import { SKETCH_ADHERENCE_EVIDENCE_KEY, SKETCH_DEVIATION_WARNING } from "@/application/planner/sketch-corridor";
import { isUsableEvidence } from "@/domain/evidence/types";
import type { Coordinate } from "@/domain/ride/types";
import { PA_NJ_ROUTE_POLICY_VNEXT_1 } from "@/domain/route/policy";

/**
 * Trace adherence is measured, never assumed (06 §18, Task 4.4).
 *
 * The corridor is the rider's drawn line; a candidate is a route an engine
 * produced. The pipeline records how much of the corridor the route actually
 * covers, and says so when the answer went somewhere else — the one thing that
 * must never happen is a route presented as "your sketch" without measuring it.
 */

const POLICY = PA_NJ_ROUTE_POLICY_VNEXT_1;
const ORIGIN: Coordinate = { lon: -75.44, lat: 40.14 };
const METERS_PER_DEGREE_LAT = 111_320;
const METERS_PER_DEGREE_LON = 111_320 * Math.cos((ORIGIN.lat * Math.PI) / 180);

function at(east: number, north: number): Coordinate {
  return {
    lon: ORIGIN.lon + east / METERS_PER_DEGREE_LON,
    lat: ORIGIN.lat + north / METERS_PER_DEGREE_LAT,
  };
}

function line(
  fromEast: number,
  fromNorth: number,
  toEast: number,
  toNorth: number,
): Coordinate[] {
  return Array.from({ length: 21 }, (_value, index) =>
    at(
      fromEast + ((toEast - fromEast) * index) / 20,
      fromNorth + ((toNorth - fromNorth) * index) / 20,
    ),
  );
}

const CORRIDOR = line(0, 0, 4_000, 0);

function candidate(geometry: readonly Coordinate[]): ProviderCandidate {
  return {
    providerId: "stub-router",
    profile: "motorcycle_fastest",
    geometry: [...geometry],
    distanceMeters: 4_000,
    durationSeconds: 600,
    providerMetadata: { fingerprint: `fp_${geometry.length}` },
  };
}

function run(candidates: readonly ProviderCandidate[], sketch?: readonly Coordinate[]) {
  return runCandidatePipeline({
    candidates,
    intent: {},
    policy: POLICY,
    ...(sketch === undefined ? {} : { sketch: { corridor: sketch } }),
  });
}

describe("runCandidatePipeline — sketch adherence", () => {
  it("records a known adherence when the route follows the trace", () => {
    const result = run([candidate(CORRIDOR)], CORRIDOR);

    const evidence = result.candidates[0]?.evidence[SKETCH_ADHERENCE_EVIDENCE_KEY];
    expect(evidence).toBeDefined();
    if (evidence === undefined) return;
    expect(isUsableEvidence(evidence)).toBe(true);
    expect(evidence?.status).toBe("known");
    expect(evidence?.confidence).toBe(1);
    expect(evidence?.provenance.map((source) => source.id)).toEqual(["sketch-trace"]);
    expect(result.candidates[0]?.warnings).toEqual([]);
  });

  it("warns and downgrades the status when the route is materially off the trace", () => {
    const elsewhere = line(0, 5_000, 4_000, 5_000);
    const result = run([candidate(elsewhere)], CORRIDOR);

    const evidence = result.candidates[0]?.evidence[SKETCH_ADHERENCE_EVIDENCE_KEY];
    expect(evidence?.status).toBe("estimated");
    expect(evidence?.confidence).toBe(0);
    const warning = result.candidates[0]?.warnings.find(
      (entry) => entry.code === "sketch-deviation",
    );
    expect(warning).toBeDefined();
    expect(warning?.message).toBe(SKETCH_DEVIATION_WARNING);
    expect(warning?.severity).toBe("warning");
  });

  it("distinguishes a partial match from a full one", () => {
    // The route covers the first half of the trace, then leaves it.
    const half = [...line(0, 0, 2_000, 0), ...line(2_000, 5_000, 4_000, 5_000)];
    const result = run([candidate(half)], CORRIDOR);

    const evidence = result.candidates[0]?.evidence[SKETCH_ADHERENCE_EVIDENCE_KEY];
    expect(evidence?.status).toBe("estimated");
    expect(Number(evidence?.confidence)).toBeGreaterThan(0.3);
    expect(Number(evidence?.confidence)).toBeLessThan(0.9);
  });

  it("tells the rider how much of the drawing it had to go around (OGV-D-285)", () => {
    // Follows the drawing except for a 1 km stretch it skirts 700 m to the north.
    const around = [...line(0, 0, 1_500, 0), at(1_500, 700), at(2_500, 700), ...line(2_500, 0, 4_000, 0)];
    const result = run([candidate(around)], CORRIDOR);

    const warnings = result.candidates[0]?.warnings ?? [];
    expect(warnings.some((entry) => entry.code === "sketch-deviation")).toBe(false);
    const note = warnings.find((entry) => entry.code === "sketch-unfollowed");
    expect(note?.severity).toBe("info");
    expect(note?.message).toMatch(/^About 0\.\d mi of your drawing, in one place, has no road this route can use/);
  });

  it("does not add the go-around note on top of the deviation warning", () => {
    const elsewhere = line(0, 5_000, 4_000, 5_000);
    const codes = run([candidate(elsewhere)], CORRIDOR).candidates[0]?.warnings.map((entry) => entry.code);
    expect(codes).toContain("sketch-deviation");
    expect(codes).not.toContain("sketch-unfollowed");
  });

  it("records nothing when the ride has no sketch", () => {
    const result = run([candidate(CORRIDOR)]);

    expect(result.candidates[0]?.evidence[SKETCH_ADHERENCE_EVIDENCE_KEY]).toBeUndefined();
    expect(
      result.candidates[0]?.warnings.some((entry) => entry.code === "sketch-deviation"),
    ).toBe(false);
  });
});
