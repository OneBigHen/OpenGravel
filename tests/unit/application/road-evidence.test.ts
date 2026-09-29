import { describe, expect, it } from "vitest";

import {
  aggregateRoadEvidence,
  type RoadEvidenceRecord,
} from "@/application/roads/road-evidence";
import { asRoadEntityId } from "@/domain/ride/ids";

const ENTITY = asRoadEntityId("road_main");
const NOW = "2026-09-17T12:00:00.000Z";

function evidence(
  id: string,
  value: string | null,
  overrides: Partial<RoadEvidenceRecord> = {},
): RoadEvidenceRecord {
  return {
    id,
    entityId: ENTITY,
    source: "recorded-ride",
    observedAt: NOW,
    value,
    confidence: value === null ? null : 0.9,
    ...overrides,
  };
}

describe("road evidence aggregation", () => {
  it("keeps absent evidence unverified instead of inventing a surface", () => {
    const [summary] = aggregateRoadEvidence([]);

    expect(summary).toBeUndefined();
  });

  it("keeps an explicit unknown report unknown", () => {
    const [summary] = aggregateRoadEvidence([evidence("unknown", null)]);

    expect(summary).toMatchObject({
      entityId: ENTITY,
      surfaceValue: null,
      confidence: null,
      confidenceBand: "Unverified",
      conflict: false,
      evidenceCount: 1,
    });
  });

  it("does not let a generated route become evidence", () => {
    const [summary] = aggregateRoadEvidence([
      evidence("generated", "paved", { source: "generated-route" }),
    ]);

    expect(summary).toMatchObject({
      surfaceValue: null,
      confidence: null,
      confidenceBand: "Unverified",
      evidenceCount: 0,
    });
    expect(summary?.records).toHaveLength(1);
  });

  it("preserves one known value and assigns a confidence band", () => {
    const [summary] = aggregateRoadEvidence([
      evidence("official", "maintained-gravel", {
        source: "official-authority",
        confidence: 0.95,
      }),
    ]);

    expect(summary).toMatchObject({
      surfaceValue: "maintained-gravel",
      conflict: false,
      confidenceBand: "High",
      evidenceCount: 1,
      sourceDiversity: 1,
    });
    expect(summary?.confidence).toBeGreaterThan(0.8);
  });

  it("does not average conflicting categorical reports into a fake value", () => {
    const [summary] = aggregateRoadEvidence([
      evidence("paved", "paved-smooth", { source: "osm", confidence: 0.9 }),
      evidence("gravel", "loose-gravel", { source: "recorded-ride", confidence: 0.9 }),
    ]);

    expect(summary).toMatchObject({
      surfaceValue: null,
      conflict: true,
      confidenceBand: "Low",
      evidenceCount: 2,
      sourceDiversity: 2,
    });
    expect(summary?.confidence).toBeLessThan(0.5);
    expect(summary?.records.map((record) => record.value)).toEqual([
      "loose-gravel",
      "paved-smooth",
    ]);
  });

  it("groups entities deterministically and retains unknown records", () => {
    const other = asRoadEntityId("road_other");
    const rows = aggregateRoadEvidence([
      evidence("b", null, { entityId: other }),
      evidence("a", "paved-smooth"),
    ]);

    expect(rows.map((row) => row.entityId)).toEqual(["road_main", "road_other"]);
    expect(rows[0]?.records[0]?.id).toBe("a");
    expect(rows[1]?.confidenceBand).toBe("Unverified");
  });

  it("uses source authority rather than a plain average for a disagreement", () => {
    const [summary] = aggregateRoadEvidence([
      evidence("authority", "paved-smooth", { source: "official-authority", confidence: 0.8 }),
      evidence("rider", "loose-gravel", { source: "import", confidence: 0.95 }),
    ]);

    expect(summary?.surfaceValue).toBe("paved-smooth");
    expect(summary?.conflict).toBe(true);
    expect(summary?.confidence).toBeLessThan(0.8);
  });
});
