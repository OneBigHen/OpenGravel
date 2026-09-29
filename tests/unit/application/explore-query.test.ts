import { describe, expect, it } from "vitest";

import {
  filterAndSortCatalog,
  parseExploreQuery,
  serializeExploreQuery,
} from "@/application/explore/query";
import type { CatalogEntry } from "@/application/explore/catalog";

const entries: readonly CatalogEntry[] = [
  {
    id: "short",
    source: "catalog",
    name: "Alpha",
    region: "Lehigh Valley",
    summary: "Short route",
    distanceKm: 40,
    bounds: null,
    geometry: [],
    provenance: "sample data — not curated",
    surfaceSummary: "Mostly paved · 2 mi gravel",
    curvatureSummary: "5 mi of curves",
  },
  {
    id: "long",
    source: "personal",
    name: "Beta",
    region: "Poconos",
    summary: "Long route",
    distanceKm: 180,
    bounds: null,
    geometry: [],
    provenance: "saved library ride",
    surfaceSummary: "Surface unknown",
  },
];

describe("Explore query state", () => {
  it("round-trips filter and sort state through URL parameters", () => {
    const query = {
      source: "personal" as const,
      distance: "long" as const,
      region: "Poco",
      sort: "distance-desc" as const,
    };

    expect(parseExploreQuery(serializeExploreQuery(query))).toEqual(query);
  });

  it("reads pre-miles distance links as the matching bucket", () => {
    expect(parseExploreQuery("?distance=over-150").distance).toBe("long");
    expect(parseExploreQuery("?distance=under-50").distance).toBe("short");
  });

  it("filters by source, distance bucket, and region, then sorts", () => {
    expect(
      filterAndSortCatalog(entries, {
        source: "personal",
        distance: "long",
        region: "poco",
        sort: "name",
      }),
    ).toEqual([entries[1]]);
  });

  it("searches route names and filters only routes with measured surface and curvature", () => {
    const query = parseExploreQuery("?search=alpha&surface=gravel&curvy=true");
    expect(query).toMatchObject({ search: "alpha", surface: "gravel", curvy: true });
    expect(filterAndSortCatalog(entries, { ...query, sort: "name" })).toEqual([entries[0]]);
    expect(serializeExploreQuery(query)).toContain("search=alpha");
    expect(serializeExploreQuery(query)).toContain("curvy=true");
  });

  it("does not treat missing evidence as a negative filter match", () => {
    expect(filterAndSortCatalog(entries, { surface: "gravel", sort: "name" })).toEqual([entries[0]]);
    expect(filterAndSortCatalog(entries, { curvy: true, sort: "name" })).toEqual([entries[0]]);
  });

  it("defaults to a stable quality order that favors evidence, curves, useful distance and a real name", () => {
    const qualityEntries: CatalogEntry[] = [
      { ...entries[0]!, id: "named-only", name: "Named", distanceKm: 80, surfaceSummary: undefined, curvatureSummary: undefined },
      { ...entries[0]!, id: "long-curvy", name: "Curvy long", distanceKm: 500, surfaceSummary: "Paved", curvatureSummary: "Curvy" },
      { ...entries[0]!, id: "good-z", name: "Named good Z", distanceKm: 100, surfaceSummary: "Paved", curvatureSummary: "Curvy" },
      { ...entries[0]!, id: "good-a", name: "Named good A", distanceKm: 100, surfaceSummary: "Paved", curvatureSummary: "Curvy" },
      { ...entries[0]!, id: "generated", name: "Pennsylvania loop · 50 mi", distanceKm: 80, nameIsGenerated: true, surfaceSummary: "Paved", curvatureSummary: "Few curves" },
      { ...entries[0]!, id: "unknown", name: "Unknown", distanceKm: null, surfaceSummary: undefined, curvatureSummary: undefined },
    ];
    expect(parseExploreQuery("").sort).toBe("recommended");
    expect(filterAndSortCatalog(qualityEntries, parseExploreQuery("")).map(({ id }) => id)).toEqual([
      "good-a", "good-z", "long-curvy", "generated", "named-only", "unknown",
    ]);
  });

  it("uses nearest-first as the recommended order whenever a location is known", () => {
    const near = { ...entries[0]!, id: "near", name: "Z near", geometry: [{ lon: -75, lat: 40 }] };
    const far = { ...entries[0]!, id: "far", name: "A far", geometry: [{ lon: -74, lat: 40 }] };
    expect(filterAndSortCatalog([far, near], parseExploreQuery(""), [-75, 40]).map(({ id }) => id)).toEqual(["near", "far"]);
  });

  it("does not persist a nearest sort without its browser-only location", () => {
    expect(serializeExploreQuery({ sort: "near" })).toBe("");
    expect(parseExploreQuery("?sort=near").sort).toBe("recommended");
  });

  it("matches filters against every grouped export and shows the matching route", () => {
    const grouped: CatalogEntry = {
      ...entries[0]!,
      id: "representative",
      name: "Pennsylvania loop · 60 mi",
      region: "Pennsylvania",
      distanceKm: 160,
      catalogGroupId: "same-ride",
      variantCount: 2,
      exportCount: 3,
      catalogMembers: [
        {
          id: "representative",
          name: "Pennsylvania loop · 60 mi",
          region: "Pennsylvania",
          summary: "60 mi route",
          distanceKm: 160,
          previewGeometry: [{ lon: -75, lat: 40 }],
          nameIsGenerated: true,
        },
        {
          id: "maryland-copy",
          name: "Hidden Maryland Tour",
          region: "Maryland",
          summary: "50 mi route",
          distanceKm: 80,
          previewGeometry: [{ lon: -76, lat: 39 }],
          surfaceSummary: "Mostly paved",
          curvatureSummary: "12 mi of curves",
        },
      ],
    };

    const match = filterAndSortCatalog([grouped], {
      region: "maryland",
      search: "hidden",
      distance: "medium",
      surface: "paved",
      curvy: true,
      sort: "recommended",
    });
    expect(match).toHaveLength(1);
    expect(match[0]).toMatchObject({
      id: "maryland-copy",
      name: "Hidden Maryland Tour",
      region: "Maryland",
      distanceKm: 80,
      variantCount: 2,
      exportCount: 3,
      geometry: [{ lon: -76, lat: 39 }],
    });
  });

  it("uses the closest grouped export as the visible card when a location is known", () => {
    const grouped: CatalogEntry = {
      ...entries[0]!,
      id: "far-copy",
      geometry: [{ lon: -74, lat: 40 }],
      catalogGroupId: "same-ride",
      catalogMembers: [
        { id: "far-copy", name: "Tour", region: "PA", summary: "60 mi", distanceKm: 100, previewGeometry: [{ lon: -74, lat: 40 }] },
        { id: "near-copy", name: "Tour", region: "PA", summary: "61 mi", distanceKm: 101, previewGeometry: [{ lon: -75, lat: 40 }] },
      ],
    };
    expect(filterAndSortCatalog([grouped], parseExploreQuery(""), [-75, 40])[0]?.id).toBe("near-copy");
  });
});
