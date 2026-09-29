import { describe, expect, it } from "vitest";

import {
  asRouteSpanRef,
  isUsableEvidence,
  knownEvidence,
  unavailableEvidence,
  unknownEvidence,
  type EvidenceSource,
  type EvidenceStatus,
  type EvidenceValue,
} from "@/domain/evidence/types";
import { validateEvidenceValue } from "@/domain/evidence/validate";

const RIDER_SOURCE: EvidenceSource = {
  id: "rider-report",
  label: "Rider report",
  category: "rider",
};

const OSM_SOURCE: EvidenceSource = {
  id: "osm-way-12345",
  label: "OpenStreetMap way 12345",
  category: "osm",
  observedAt: "2026-04-01T00:00:00.000Z",
  authoritativeFor: ["surface"],
};

function manualEvidence<T>(
  status: EvidenceStatus,
  value: T | null,
): EvidenceValue<T> {
  return { value, status, confidence: null, provenance: [] };
}

describe("unknown-first evidence helpers (03-DOMAIN-MODEL §18)", () => {
  it("unknownEvidence is unknown with a null value and no confidence", () => {
    const evidence = unknownEvidence<number>();

    expect(evidence.status).toBe("unknown");
    expect(evidence.value).toBeNull();
    expect(evidence.confidence).toBeNull();
    expect(evidence.provenance).toEqual([]);
    expect(evidence.reason).toBeUndefined();
  });

  it("unknownEvidence keeps the caller's reason without promoting the value", () => {
    const evidence = unknownEvidence<number>("no coverage for this span");

    expect(evidence.status).toBe("unknown");
    expect(evidence.value).toBeNull();
    expect(evidence.confidence).toBeNull();
    expect(evidence.reason).toBe("no coverage for this span");
  });

  it("unavailableEvidence is unavailable, never unknown-as-false", () => {
    const evidence = unavailableEvidence<boolean>();

    expect(evidence.status).toBe("unavailable");
    expect(evidence.value).toBeNull();
    expect(evidence.confidence).toBeNull();
    expect(evidence.provenance).toEqual([]);
  });

  it("knownEvidence carries the value, its source and an optional confidence", () => {
    const withConfidence = knownEvidence("maintained-gravel", OSM_SOURCE, 0.8);

    expect(withConfidence).toEqual({
      value: "maintained-gravel",
      status: "known",
      confidence: 0.8,
      provenance: [OSM_SOURCE],
    });

    const withoutConfidence = knownEvidence(12, RIDER_SOURCE);

    expect(withoutConfidence.status).toBe("known");
    expect(withoutConfidence.value).toBe(12);
    expect(withoutConfidence.confidence).toBeNull();
    expect(withoutConfidence.provenance).toEqual([RIDER_SOURCE]);
  });

  it("rejects non-finite or out-of-range confidence", () => {
    for (const confidence of [
      Number.POSITIVE_INFINITY,
      Number.NaN,
      -0.1,
      1.1,
    ]) {
      expect(() => knownEvidence("paved", OSM_SOURCE, confidence)).toThrow(
        TypeError,
      );
    }
  });

  it("accepts the closed confidence bounds", () => {
    expect(knownEvidence("paved", OSM_SOURCE, 0).confidence).toBe(0);
    expect(knownEvidence("paved", OSM_SOURCE, 1).confidence).toBe(1);
  });

  it("scopes every constructor to an evidence target", () => {
    const span = asRouteSpanRef("span_7");

    expect(knownEvidence("paved", OSM_SOURCE, 0.5, span).appliesTo).toBe(span);
    expect(unknownEvidence("no coverage", span).appliesTo).toBe(span);
    expect(unavailableEvidence(span).appliesTo).toBe(span);
    expect(unknownEvidence("no coverage").appliesTo).toBeUndefined();
    expect(unavailableEvidence().appliesTo).toBeUndefined();
    expect(knownEvidence("paved", OSM_SOURCE).appliesTo).toBeUndefined();
  });
});

describe("validateEvidenceValue bounds (03-DOMAIN-MODEL §18)", () => {
  it("accepts absent or in-range confidence and coverage", () => {
    expect(validateEvidenceValue({ confidence: null })).toEqual([]);
    expect(validateEvidenceValue({ confidence: 0.5, coverage: 1 })).toEqual([]);
    expect(validateEvidenceValue({ confidence: 0, coverage: 0 })).toEqual([]);
  });

  it("rejects non-finite or out-of-range confidence", () => {
    expect(validateEvidenceValue({ confidence: Number.POSITIVE_INFINITY })).toEqual([
      expect.stringMatching(/confidence/),
    ]);
    expect(validateEvidenceValue({ confidence: Number.NaN })).toEqual([
      expect.stringMatching(/confidence/),
    ]);
    expect(validateEvidenceValue({ confidence: 1.2 })).toEqual([
      expect.stringMatching(/confidence/),
    ]);
  });

  it("rejects non-finite or out-of-range coverage", () => {
    expect(validateEvidenceValue({ confidence: 0.5, coverage: -0.01 })).toEqual([
      expect.stringMatching(/coverage/),
    ]);
    expect(validateEvidenceValue({ confidence: null, coverage: 2 })).toEqual([
      expect.stringMatching(/coverage/),
    ]);
  });

  it("applies the same bounds a validated knownEvidence passes", () => {
    expect(validateEvidenceValue(knownEvidence("paved", OSM_SOURCE, 1))).toEqual(
      [],
    );
  });
});
describe("isUsableEvidence (absence is never negative evidence, 07 §2)", () => {
  it("accepts only known or estimated evidence that carries a value", () => {
    expect(isUsableEvidence(knownEvidence("paved", OSM_SOURCE))).toBe(true);
    expect(isUsableEvidence(manualEvidence("estimated", 0.42))).toBe(true);
  });

  it.each([
    ["unknown", manualEvidence<string>("unknown", null)],
    ["unavailable", manualEvidence<string>("unavailable", null)],
    ["stale", manualEvidence<string>("stale", "paved")],
    ["known without a value", manualEvidence<string>("known", null)],
    ["estimated without a value", manualEvidence<string>("estimated", null)],
  ])("rejects %s", (_label, evidence) => {
    expect(isUsableEvidence(evidence)).toBe(false);
  });

  it("never coerces an unknown value into a usable state", () => {
    const unknown = unknownEvidence<boolean>("provider returned no data");

    expect(isUsableEvidence(unknown)).toBe(false);
    expect(isUsableEvidence(unknown)).toBe(false);
    expect(unknown.status).toBe("unknown");
    expect(unknown.value).toBeNull();

    const unavailable = unavailableEvidence<boolean>();
    expect(isUsableEvidence(unavailable)).toBe(false);
    expect(unavailable.status).toBe("unavailable");
    expect(unavailable.value).toBeNull();

    // A missing value is never a `false`, a zero, or an empty string.
    expect(unknownEvidence<boolean>().value).not.toBe(false);
    expect(unknownEvidence<number>().value).not.toBe(0);
    expect(unknownEvidence<string>().value).not.toBe("");
  });
});
