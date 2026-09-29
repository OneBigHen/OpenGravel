import { describe, expect, it } from "vitest";

import { libraryTypeForRecord, libraryTypeLabel } from "@/application/library/provenance";
import type { RideRecord } from "@/application/persistence/ride-repository";
import { createRideDocument } from "@/domain/ride/create";

function record(document: ReturnType<typeof createRideDocument>): RideRecord {
  return {
    rideId: document.rideId,
    revision: document.revision,
    updatedAt: document.updatedAt,
    writerToken: "test",
    document,
    savedAt: "2026-09-17T12:00:00.000Z",
  };
}

describe("ride library provenance", () => {
  it.each([
    ["new", "planned"],
    ["import", "imported"],
    ["recorded", "recorded"],
  ] as const)("renders %s as %s", (provenance, expected) => {
    const document = createRideDocument({ provenance: { type: provenance, sourceId: "source" } });
    expect(libraryTypeForRecord(record(document))).toBe(expected);
  });

  it("renders catalog and shared derivatives separately", () => {
    const document = createRideDocument({ provenance: { type: "catalog", sourceId: "source" } });
    const base = record(document);

    expect(
      libraryTypeForRecord({ ...base, derivedFrom: { kind: "catalog", sourceId: "catalog-1" } }),
    ).toBe("catalog-derivative");
    expect(
      libraryTypeLabel(
        libraryTypeForRecord({ ...base, derivedFrom: { kind: "shared", sourceId: "shared-1" } }),
      ),
    ).toBe("Shared derivative");
  });
});
