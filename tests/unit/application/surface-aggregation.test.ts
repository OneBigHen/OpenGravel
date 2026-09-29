import { describe, expect, it } from "vitest";

import {
  aggregateRoadSurface,
  aggregateRouteSurface,
  surfaceEvidenceFromRoadEvidence,
  surfaceBandLabel,
  type RoadSurfaceEvidenceInput,
} from "@/application/roads/surface-evidence";
import { asRoadEntityId } from "@/domain/ride/ids";

const ENTITY = asRoadEntityId("road_surface");

function record(overrides: Partial<RoadSurfaceEvidenceInput> = {}): RoadSurfaceEvidenceInput {
  return {
    id: "ride-report",
    entityId: ENTITY,
    source: "recorded-ride",
    observedAt: "2026-09-17T12:00:00.000Z",
    value: "paved-rough",
    confidence: 0.86,
    ...overrides,
  };
}

describe("road surface application adapter", () => {
  it("maps a legacy road report into canonical surface evidence with provenance", () => {
    expect(surfaceEvidenceFromRoadEvidence(record())).toMatchObject({
      id: "ride-report",
      value: "paved-rough",
      source: "recorded-ride",
      sourceLabel: "Recorded ride",
      weight: 0.8,
      confidence: 0.86,
    });
  });

  it("aggregates road reports into the new assessment while retaining source records", () => {
    const assessment = aggregateRoadSurface([
      record({ id: "osm", source: "osm", value: "asphalt", confidence: 0.9 }),
      record({ id: "ride", value: "paved-rough", confidence: 0.86 }),
    ], { asOf: "2026-09-18T12:00:00.000Z" });

    expect(assessment).toMatchObject({
      value: "paved",
      band: "confirmed",
      conflicts: [],
      evidenceCount: 2,
    });
    expect(assessment.provenance.map((entry) => entry.source)).toEqual([
      "osm",
      "recorded-ride",
    ]);
  });

  it("keeps generated-route reports at zero weight even if a caller supplies a value", () => {
    const generated = record({ source: "generated-route", value: "paved", confidence: 1 });

    expect(surfaceEvidenceFromRoadEvidence(generated)).toMatchObject({ weight: 0 });
    expect(aggregateRoadSurface([generated]).band).toBe("unknown");
  });

  it("does not treat non-surface road evidence as a surface report", () => {
    expect(aggregateRoadSurface([
      record({ aspect: "access", value: "closed", confidence: 1 }),
    ])).toMatchObject({ value: "unknown", band: "unknown", provenance: [] });
  });

  it("labels every band explicitly, including the unknown state", () => {
    expect(surfaceBandLabel("confirmed")).toBe("Surface confirmed");
    expect(surfaceBandLabel("likely")).toBe("Surface likely");
    expect(surfaceBandLabel("possible")).toBe("Surface possible");
    expect(surfaceBandLabel("unknown")).toBe("Surface unknown");
  });

  it("projects a route evidence value into the same canonical assessment", () => {
    const assessment = aggregateRouteSurface({
      value: "gravel",
      status: "known",
      confidence: 0.85,
      provenance: [{ id: "osm", label: "OpenStreetMap", category: "osm" }],
    });

    expect(assessment).toMatchObject({ value: "gravel", band: "likely" });
  });
});
