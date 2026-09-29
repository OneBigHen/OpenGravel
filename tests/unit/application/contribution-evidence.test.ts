import { describe, expect, it } from "vitest";

import { aggregateRoadSurface } from "@/application/roads/surface-evidence";
import { contributionToRoadEvidence } from "@/application/roads/contribution-evidence";
import type { ContributionEnvelope } from "@/domain/contributions";

const CONTRIBUTOR = "123e4567-e89b-42d3-a456-426614174000";

function contribution(overrides: Partial<ContributionEnvelope> = {}): ContributionEnvelope {
  return {
    kind: "surface",
    roadRef: { roadId: "road_main", spanId: "span_main" },
    observedAt: "2026-09-17T12:00:00.000Z",
    gps_precision_m: 12,
    value: "maintained-gravel",
    provenance: {
      contributorPseudoId: CONTRIBUTOR,
      clientVersion: "0.1.0",
      evidenceLevel: "high",
    },
    ...overrides,
  } as ContributionEnvelope;
}

function roadEvidence(id: string, envelope: ContributionEnvelope) {
  const record = contributionToRoadEvidence(id, envelope);
  if (record === null) throw new Error("Expected road-condition evidence");
  return record;
}

describe("contribution evidence adapter", () => {
  it("projects a surface report into the existing 6.3 aggregator contract", () => {
    const record = roadEvidence("contribution_1", contribution());

    expect(record).toMatchObject({
      id: "contribution_1",
      entityId: "road_main",
      spanId: "span_main",
      source: "recorded-ride",
      aspect: "surface",
      value: "maintained-gravel",
      confidence: 0.85,
      stalenessWindowDays: 30,
      contributorId: CONTRIBUTOR,
      gpsPrecisionM: 12,
    });
    expect(aggregateRoadSurface([record])).toMatchObject({
      value: "gravel",
      band: "likely",
      evidenceCount: 1,
    });
  });

  it("maps gate and condition reports to their separate evidence aspects", () => {
    const gate = roadEvidence("gate_1", contribution({ kind: "gate", value: "locked" }));
    const condition = roadEvidence(
      "condition_1",
      contribution({ kind: "condition", value: { tag: "washout", severity: "severe" } }),
    );

    expect(gate).toMatchObject({ aspect: "access", value: "locked", spanId: "span_main" });
    expect(condition).toMatchObject({ aspect: "condition", value: "washout:severe", spanId: "span_main" });
    expect(aggregateRoadSurface([gate, condition])).toMatchObject({ value: "unknown", band: "unknown" });
  });

  it("makes a surface report stale after the mapped window without deleting it", () => {
    const record = roadEvidence("contribution_1", contribution());
    const assessment = aggregateRoadSurface([record], { asOf: "2026-10-18T12:00:00.000Z" });

    expect(assessment).toMatchObject({ value: "gravel", band: "possible", stale: true });
    expect(assessment.provenance).toHaveLength(1);
  });

  it("makes a gate report stale on its shorter freshness window", () => {
    const gate = roadEvidence("gate_1", contribution({ kind: "gate", value: "open" }));
    expect(gate.stalenessWindowDays).toBe(7);
  });

  it("does not let repeated reports from one contributor become confirmed", () => {
    const first = roadEvidence("contribution_1", contribution());
    const second = roadEvidence("contribution_2", contribution({ observedAt: "2026-09-18T12:00:00.000Z" }));
    const assessment = aggregateRoadSurface([first, second]);

    expect(assessment.band).toBe("likely");
    expect(assessment.sourceDiversity).toBe(1);
  });

  it("does not treat catalog comments as road condition evidence", () => {
    expect(contributionToRoadEvidence("comment_1", contribution({
      kind: "condition",
      value: { tag: "comment", severity: "minor", note: "Potholes by the bridge." },
    }))).toBeNull();
  });
});
