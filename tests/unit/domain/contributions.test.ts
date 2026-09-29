import { describe, expect, it } from "vitest";

import {
  CONTRIBUTION_MAX_FUTURE_SKEW_MS,
  CONTRIBUTION_SURFACE_VALUES,
  contributionConfidenceFor,
  parseContribution,
  validateContribution,
  type ContributionEnvelope,
} from "@/domain/contributions";

const NOW = "2026-09-17T12:00:00.000Z";
const CONTRIBUTOR = "123e4567-e89b-42d3-a456-426614174000";

function validContribution(
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    kind: "surface",
    roadRef: { roadId: "road_main", spanId: "span_main" },
    observedAt: NOW,
    gps_precision_m: 12,
    value: "maintained-gravel",
    provenance: {
      contributorPseudoId: CONTRIBUTOR,
      clientVersion: "0.1.0",
      evidenceLevel: "high",
    },
    ...overrides,
  };
}

function issuesFor(
  input: unknown,
  now = NOW,
): readonly { readonly code: string; readonly field: string }[] {
  return validateContribution(input, { now });
}

describe("contribution envelope validation", () => {
  it("accepts every supported contribution kind at its valid boundary values", () => {
    const cases = [
      validContribution({
        gps_precision_m: 0,
        value: CONTRIBUTION_SURFACE_VALUES.at(-1),
      }),
      validContribution({ kind: "gate", value: "open", gps_precision_m: 1_000 }),
      validContribution({
        kind: "condition",
        value: { tag: "x".repeat(80), severity: "severe" },
      }),
    ];

    for (const input of cases) {
      expect(issuesFor(input)).toEqual([]);
    }
  });

  it.each([
    ["null body", null, "body"],
    ["missing kind", validContribution({ kind: undefined }), "kind"],
    ["unknown kind", validContribution({ kind: "photo" }), "kind"],
    ["missing road reference", validContribution({ roadRef: undefined }), "roadRef"],
    ["bad road id", validContribution({ roadRef: { roadId: "main", spanId: "span_main" } }), "roadRef.roadId"],
    ["missing span id", validContribution({ roadRef: { roadId: "road_main" } }), "roadRef.spanId"],
    ["bad timestamp", validContribution({ observedAt: "not-a-date" }), "observedAt"],
    ["date without an instant", validContribution({ observedAt: "2026-09-17" }), "observedAt"],
    ["future timestamp", validContribution({ observedAt: "2026-09-17T12:05:00.001Z" }), "observedAt"],
    ["negative GPS precision", validContribution({ gps_precision_m: -0.01 }), "gps_precision_m"],
    ["GPS precision too broad", validContribution({ gps_precision_m: 1_000.01 }), "gps_precision_m"],
    ["non-finite GPS precision", validContribution({ gps_precision_m: Number.NaN }), "gps_precision_m"],
    ["bad surface value", validContribution({ value: "concrete" }), "value"],
    ["bad gate value", validContribution({ kind: "gate", value: "ajar" }), "value"],
    ["condition value is not an object", validContribution({ kind: "condition", value: "washout" }), "value"],
    ["condition tag is empty", validContribution({ kind: "condition", value: { tag: "   ", severity: "minor" } }), "value.tag"],
    ["condition tag is too long", validContribution({ kind: "condition", value: { tag: "x".repeat(81), severity: "minor" } }), "value.tag"],
    ["condition severity is invalid", validContribution({ kind: "condition", value: { tag: "washout", severity: "critical" } }), "value.severity"],
    ["condition note is too long", validContribution({ kind: "condition", value: { tag: "rough", severity: "moderate", note: "x".repeat(501) } }), "value.note"],
    ["condition note contains control characters", validContribution({ kind: "condition", value: { tag: "rough", severity: "moderate", note: "bad\u0000note" } }), "value.note"],
    ["missing provenance", validContribution({ provenance: undefined }), "provenance"],
    ["pseudo-id is not a UUID", validContribution({ provenance: { contributorPseudoId: "rider@example.com", clientVersion: "0.1.0", evidenceLevel: "high" } }), "provenance.contributorPseudoId"],
    ["client version is empty", validContribution({ provenance: { contributorPseudoId: CONTRIBUTOR, clientVersion: "", evidenceLevel: "high" } }), "provenance.clientVersion"],
    ["evidence level is invalid", validContribution({ provenance: { contributorPseudoId: CONTRIBUTOR, clientVersion: "0.1.0", evidenceLevel: "certain" } }), "provenance.evidenceLevel"],
  ] as const)("rejects %s", (_name, input, field) => {
    expect(issuesFor(input)).toEqual(expect.arrayContaining([
      expect.objectContaining({ field }),
    ]));
  });

  it("rejects an observation beyond the configured future-skew boundary", () => {
    const future = new Date(Date.parse(NOW) + CONTRIBUTION_MAX_FUTURE_SKEW_MS + 1).toISOString();
    expect(issuesFor(validContribution({ observedAt: future }))).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: "future-observation", field: "observedAt" }),
    ]));
  });

  it("returns a narrowed copy and does not carry unknown wire fields forward", () => {
    const input = validContribution({ internalNote: "must not persist" });
    const parsed = parseContribution(input, { now: NOW });

    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.value).toEqual(validContribution());
    expect("internalNote" in parsed.value).toBe(false);
  });

  it("preserves an optional condition note after validating its bounded text", () => {
    const parsed = parseContribution(validContribution({
      kind: "condition",
      value: { tag: "rough", severity: "moderate", note: "Deep pothole after the bridge." },
    }), { now: NOW });
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.value).toMatchObject({ kind: "condition", value: { tag: "rough", severity: "moderate", note: "Deep pothole after the bridge." } });
  });

  it("allows line breaks in a bounded condition note", () => {
    const parsed = parseContribution(validContribution({
      kind: "condition",
      value: { tag: "rough", severity: "moderate", note: "Deep pothole\nright after the bridge." },
    }), { now: NOW });
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.value).toMatchObject({ kind: "condition", value: { note: "Deep pothole\nright after the bridge." } });
  });
});

describe("single-contribution confidence mapping", () => {
  it.each([
    ["low", "possible", 0.35],
    ["medium", "likely", 0.65],
    ["high", "likely", 0.85],
  ] as const)("maps %s evidence to the 6.3 %s band", (level, band, confidence) => {
    expect(contributionConfidenceFor(level)).toEqual({
      confidence,
      band,
      stalenessWindowDays: 30,
    });
  });

  it("uses shorter freshness windows for gate and condition evidence", () => {
    expect(contributionConfidenceFor("high", "gate").stalenessWindowDays).toBe(7);
    expect(contributionConfidenceFor("high", "condition").stalenessWindowDays).toBe(14);
  });

  it("keeps one high-level rider report below confirmed", () => {
    const mapped = contributionConfidenceFor("high");
    expect(mapped.confidence).toBeLessThan(0.9);
    expect(mapped.band).not.toBe("confirmed");
  });

  it("keeps the discriminated envelope assignable after validation", () => {
    const parsed = parseContribution(validContribution(), { now: NOW });
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    const envelope: ContributionEnvelope = parsed.value;
    expect(envelope.kind).toBe("surface");
  });
});
