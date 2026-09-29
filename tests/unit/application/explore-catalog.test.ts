import { describe, expect, it } from "vitest";

import {
  createExploreDerivative,
  entryFromLibraryRide,
  mergeCatalogEntries,
  parseCatalogEntries,
  type CatalogEntry,
  type LibraryExploreRide,
} from "@/application/explore/catalog";
import { createRideDocument } from "@/domain/ride/create";
import fixtureCatalog from "../../../data/catalog/e2e-fixture-routes.json";

const catalogEntry = (overrides: Partial<CatalogEntry> = {}): CatalogEntry => ({
  id: "catalog-1",
  source: "catalog",
  name: "Catalog route",
  region: "Lehigh Valley",
  summary: "A sample route.",
  distanceKm: 25,
  bounds: { west: -75.5, south: 40.5, east: -75.2, north: 40.7 },
  geometry: [
    { lon: -75.5, lat: 40.5 },
    { lon: -75.2, lat: 40.7 },
  ],
  provenance: "sample data — not curated",
  ...overrides,
});

const libraryRide: LibraryExploreRide = {
  summary: {
    rideId: "ride-1" as LibraryExploreRide["summary"]["rideId"],
    title: "My saved ride",
    type: "planned",
    provenanceType: "new",
    savedAt: "2026-09-17T12:00:00.000Z",
    updatedAt: "2026-09-17T12:00:00.000Z",
    area: "Lehigh Valley",
    distanceMeters: 12000,
    durationSeconds: 1_800,
    sourceId: null,
  },
  document: createRideDocument({ now: "2026-09-17T12:00:00.000Z" }),
  geometry: [],
};

describe("Explore catalog application", () => {
  it("merges catalog and library sources in stable source/name order and deduplicates ids", () => {
    const entries = mergeCatalogEntries(
      [
        catalogEntry({ id: "same", name: "Catalog wins" }),
        catalogEntry({ id: "z", name: "Z route" }),
      ],
      [
        catalogEntry({ id: "same", source: "personal", name: "Personal duplicate" }),
        catalogEntry({ id: "a", source: "import", name: "Imported route" }),
      ],
    );

    expect(entries.map((entry) => `${entry.source}:${entry.id}`)).toEqual([
      "catalog:same",
      "catalog:z",
      "import:a",
    ]);
  });

  it("maps a saved library ride into an honest personal entry", () => {
    const entry = entryFromLibraryRide(libraryRide);

    expect(entry).toMatchObject({
      id: "ride-1",
      source: "personal",
      name: "My saved ride",
      distanceKm: 12,
      estimatedTimeMinutes: 30,
      geometry: [],
    });
    expect(entry.provenance).toContain("saved library ride");
  });

  it("creates a derivative with copy title, endpoints, and preserved source provenance", () => {
    const entry = catalogEntry({ id: "catalog-lehigh" });
    const derivative = createExploreDerivative(entry, "2026-09-17T13:00:00.000Z");

    expect(derivative.title).toBe("Catalog route copy");
    expect(derivative.provenance).toEqual({ type: "catalog", sourceId: "catalog-lehigh" });
    expect(derivative.intent.start?.coordinate).toEqual(entry.geometry[0]);
    expect(derivative.intent.finish?.coordinate).toEqual(entry.geometry.at(-1));
  });

  it("seeds an Explore derivative with the active bike snapshot when supplied", () => {
    const bike = {
      bikeId: "bike-trail",
      category: "adventure" as const,
      fuelRangeMiles: 60,
      reserveMiles: 30,
      maintainedGravel: "allow" as const,
      roughTracks: "allow" as const,
      unknownSurface: "allow-with-warning" as const,
    };
    const derivative = createExploreDerivative(catalogEntry(), "2026-09-17T13:00:00.000Z", bike);

    expect(derivative.intent.bike).toEqual(bike);
  });

  it("does not invent road evidence for the synthetic demo catalog", async () => {
    const { loadCatalog } = await import("@/application/explore/catalog");
    const loaded = loadCatalog([], parseCatalogEntries(fixtureCatalog));
    const route = loaded.find((item) => item.id === "sample-ridge-loop");

    expect(route).toBeDefined();
    expect(route?.roadDetails).toBeUndefined();
    expect(route?.roadSummary).toBeUndefined();
  });
});
