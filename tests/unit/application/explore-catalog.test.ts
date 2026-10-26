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
    // The route page's header line: where the ride came from, in the rider's
    // words. The library's record ids are not provenance a rider reads.
    expect(entry.provenance).toBe("Your saved ride");
    expect(entry.provenance).not.toMatch(/geometry|source|record|library/i);
  });

  it("names an imported library ride in plain words too", () => {
    const entry = entryFromLibraryRide({
      ...libraryRide,
      summary: { ...libraryRide.summary, provenanceType: "import", type: "imported", sourceId: "source-9f2" },
    });
    expect(entry.provenance).toBe("Imported from a file");
    expect(entry.provenance).not.toContain("source-9f2");
  });

  it("creates a derivative with the route's own name, endpoints, and preserved source provenance", () => {
    const entry = catalogEntry({
      id: "catalog-lehigh",
      geometry: [{ lon: -75.5, lat: 40.5 }, { lon: -75.35, lat: 40.6 }, { lon: -75.2, lat: 40.7 }],
    });
    const derivative = createExploreDerivative(entry, "2026-09-17T13:00:00.000Z");

    // The ride the rider opens is the route they read: no "copy" in its name.
    expect(derivative.title).toBe("Catalog route");
    expect(derivative.provenance).toEqual({ type: "catalog", sourceId: "catalog-lehigh" });
    expect(derivative.intent.start?.coordinate).toEqual(entry.geometry[0]);
    expect(derivative.intent.finish?.coordinate).toEqual(entry.geometry.at(-1));
    // The line's own anchors shape the ride, so planning it follows the route.
    expect(derivative.intent.shaping.length).toBeGreaterThan(0);
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
