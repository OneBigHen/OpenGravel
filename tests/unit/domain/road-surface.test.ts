import { describe, expect, it } from "vitest";

import {
  adaptLegacySurface,
  aggregateSurface,
  type SurfaceEvidence,
} from "@/domain/roads/surface";

const AS_OF = "2026-10-17T12:00:00.000Z";
const STALE_AS_OF = "2026-10-18T12:00:00.000Z";

function evidence(
  id: string,
  value: SurfaceEvidence["value"],
  overrides: Partial<SurfaceEvidence> = {},
): SurfaceEvidence {
  return {
    id,
    value,
    source: "recorded-ride",
    sourceLabel: "Recorded ride",
    observedAt: "2026-09-17T12:00:00.000Z",
    weight: 0.9,
    confidence: 0.9,
    stalenessWindowDays: 30,
    ...overrides,
  };
}

describe("surface taxonomy", () => {
  it.each([
    ["asphalt", "paved"],
    ["paved-rough", "paved"],
    ["chip-seal", "paved"],
    ["fine_gravel", "gravel"],
    ["maintained-gravel", "gravel"],
    ["compacted", "gravel"],
    ["earth", "dirt"],
    ["rough-track", "dirt"],
    ["mud-prone", "dirt"],
    ["not-a-surface", "unknown"],
    [null, "unknown"],
  ] as const)("adapts %s to %s without defaulting to pavement", (raw, expected) => {
    expect(adaptLegacySurface(raw)).toBe(expected);
  });
});

describe("aggregateSurface", () => {
  it.each([
    {
      name: "no evidence",
      records: [],
      expected: { value: "unknown", band: "unknown" },
    },
    {
      name: "explicit unknown report",
      records: [evidence("unknown", "unknown")],
      expected: { value: "unknown", band: "unknown" },
    },
    {
      name: "one weak source",
      records: [evidence("weak", "gravel", { weight: 0.35 })],
      expected: { value: "gravel", band: "possible" },
    },
    {
      name: "one medium source",
      records: [evidence("medium", "gravel", { weight: 0.65 })],
      expected: { value: "gravel", band: "likely" },
    },
    {
      name: "one strong source",
      records: [evidence("strong", "paved", { weight: 0.95, confidence: 0.95 })],
      expected: { value: "paved", band: "confirmed" },
    },
    {
      name: "two independent moderate sources",
      records: [
        evidence("osm", "gravel", { source: "osm", weight: 0.6, confidence: 0.85 }),
        evidence("rider", "gravel", { source: "rider", weight: 0.6, confidence: 0.85 }),
      ],
      expected: { value: "gravel", band: "confirmed" },
    },
    {
      name: "stale confirmed evidence loses one band",
      records: [evidence("stale-confirmed", "paved", { weight: 0.95, confidence: 0.95 })],
      expected: { value: "paved", band: "likely" },
    },
    {
      name: "stale likely evidence loses one band",
      records: [evidence("stale-likely", "gravel", { weight: 0.65 })],
      expected: { value: "gravel", band: "possible" },
    },
    {
      name: "stale possible evidence loses one band",
      records: [evidence("stale-possible", "dirt", { weight: 0.35 })],
      expected: { value: "unknown", band: "unknown" },
    },
    {
      name: "fresh evidence at the window is not stale",
      records: [evidence("boundary", "paved", { weight: 0.95, confidence: 0.95 })],
      expected: { value: "paved", band: "confirmed" },
    },
  ] as const)("keeps the %s boundary honest", ({ records, expected, name }) => {
    const asOf = name.startsWith("stale") ? STALE_AS_OF : AS_OF;
    expect(aggregateSurface(records, { asOf })).toMatchObject(expected);
  });

  it("caps a paved-versus-dirt disagreement at possible and preserves both reports", () => {
    const assessment = aggregateSurface([
      evidence("paved", "paved", { source: "osm", weight: 0.9 }),
      evidence("dirt", "dirt", { source: "rider", weight: 0.9 }),
    ], { asOf: STALE_AS_OF });

    expect(assessment.value).toBe("unknown");
    expect(assessment.band).toBe("possible");
    expect(assessment.conflicts).toHaveLength(1);
    expect(assessment.conflicts[0]).toMatchObject({
      values: ["dirt", "paved"],
      evidenceIds: ["dirt", "paved"],
    });
  });

  it("never silently picks the stronger side of a conflict", () => {
    const assessment = aggregateSurface([
      evidence("authority", "paved", { source: "official", weight: 1, confidence: 1 }),
      evidence("weak-dirt", "dirt", { source: "rider", weight: 0.2 }),
    ], { asOf: STALE_AS_OF });

    expect(assessment.value).toBe("unknown");
    expect(assessment.band).toBe("possible");
    expect(assessment.conflicts[0]?.values).toEqual(["dirt", "paved"]);
  });

  it("maps legacy detailed tags before deciding whether reports conflict", () => {
    const assessment = aggregateSurface([
      evidence("paved-raw", "paved-rough"),
      evidence("asphalt-raw", "asphalt", { source: "osm" }),
    ], { asOf: AS_OF });

    expect(assessment).toMatchObject({ value: "paved", band: "confirmed", conflicts: [] });
  });

  it("treats generated-route records as zero evidence", () => {
    const assessment = aggregateSurface([
      evidence("generated", "paved", { source: "generated-route", weight: 0 }),
    ], { asOf: AS_OF });

    expect(assessment).toMatchObject({ value: "unknown", band: "unknown", conflicts: [] });
    expect(assessment.provenance).toHaveLength(1);
  });

  it("records source, age, canonical value, and stale status in provenance", () => {
    const assessment = aggregateSurface([
      evidence("old-report", "gravel", {
        source: "gravel-atlas",
        sourceLabel: "Gravel Atlas",
        weight: 0.9,
      }),
    ], { asOf: STALE_AS_OF });

    expect(assessment.provenance).toEqual([
      expect.objectContaining({
        evidenceId: "old-report",
        source: "gravel-atlas",
        sourceLabel: "Gravel Atlas",
        value: "gravel",
        ageDays: 31,
        stale: true,
      }),
    ]);
  });

  it("does not treat missing confidence as a fabricated confirmed value", () => {
    const assessment = aggregateSurface([
      evidence("unstated", "paved", { confidence: null, weight: 1 }),
    ], { asOf: AS_OF });

    expect(assessment.band).toBe("possible");
  });

  it("honors an explicit expiry even when observation age is unavailable", () => {
    const assessment = aggregateSurface([{
      id: "expiring-report",
      value: "gravel",
      source: "official",
      expiresAt: "2026-10-16T12:00:00.000Z",
      weight: 1,
      confidence: 1,
    }], { asOf: AS_OF });

    expect(assessment).toMatchObject({ value: "gravel", band: "likely", stale: true });
    expect(assessment.provenance[0]).toMatchObject({ ageDays: null, stale: true });
  });
});
