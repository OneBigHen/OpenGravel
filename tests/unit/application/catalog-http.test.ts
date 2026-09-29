import { describe, expect, it } from "vitest";

import { parseCatalogEntry, type CatalogEntry } from "@/application/explore/catalog";
import { handleCatalogList, handleCatalogDetail } from "@/server/explore/catalog-http";

const entry: CatalogEntry = {
  id: "route-1", source: "catalog", name: "River loop", region: "Pennsylvania", summary: "Measured route",
  distanceKm: 64.37376, bounds: null, geometry: [{ lon: -75, lat: 40 }, { lon: -74.9, lat: 40.1 }],
  provenance: "archive / river.gpx", surfaceSummary: "Paved", curvatureSummary: "Few curves",
};

describe("catalog HTTP queries", () => {
  it("filters by search, mile range and nearby route start, returning preview geometry", () => {
    const result = handleCatalogList(new URL("http://localhost/api/catalog?search=river&minMiles=30&maxMiles=50&near=40,-75"), [entry]);
    expect(result.status).toBe(200);
    expect(result.body).toMatchObject({ count: 1, routes: [{ id: "route-1", preview: entry.geometry }] });
    expect(result.headers).toEqual({ "cache-control": "private, no-store" });
  });

  it("allows public caching for non-personal catalog filters", () => {
    expect(handleCatalogList(new URL("http://localhost/api/catalog?surface=paved&curvy=false"), [entry]).headers).toEqual({
      "cache-control": "public, s-maxage=3600, stale-while-revalidate=86400",
    });
  });

  it("rejects malformed and out-of-range filters", () => {
    expect(handleCatalogList(new URL("http://localhost/api/catalog?near=99,0"), [entry]).status).toBe(400);
    expect(handleCatalogList(new URL("http://localhost/api/catalog?minMiles=80&maxMiles=20"), [entry]).status).toBe(400);
  });

  it("serves the full route record and distinguishes missing catalog ids", () => {
    expect(handleCatalogDetail("route-1", [entry]).body).toEqual({ route: entry });
    expect(handleCatalogDetail("missing", [entry]).status).toBe(404);
  });

  it("serves one representative per catalog group and lists distinct tracks on detail", () => {
    const original = { ...entry, id: "ride-export-1--t1", name: "Pine Ridge Loop", catalogGroupId: "group-pine", trackGroupId: "track-one", sourceFile: "pine.gpx" };
    const repeatedExport = { ...original, id: "ride-export-2--t1", trackGroupId: "track-one", name: "Pine Ridge Loop 06-2025" };
    const secondTrack = { ...original, id: "ride-export-1--t2", trackGroupId: "track-two", name: "Pine Ridge Loop" };
    const other = { ...entry, id: "other", name: "Other route" };

    const list = handleCatalogList(new URL("http://localhost/api/catalog"), [original, repeatedExport, secondTrack, other]);
    expect(list.body).toMatchObject({ count: 2, routes: [{ catalogGroupId: "group-pine" }, { id: "other" }] });
    const routes = list.body.routes as readonly Record<string, unknown>[];
    const groupedRoute = routes[0]!;
    expect(groupedRoute.catalogMembers).toMatchObject([
      { id: "ride-export-1--t1", name: "Pine Ridge Loop" },
      { id: "ride-export-2--t1", name: "Pine Ridge Loop 06-2025" },
      { id: "ride-export-1--t2", name: "Pine Ridge Loop" },
    ]);
    expect(parseCatalogEntry({ ...groupedRoute, geometry: groupedRoute.preview, previewGeometry: groupedRoute.preview })?.catalogMembers).toHaveLength(3);
    const detail = handleCatalogDetail("ride-export-1--t1", [original, repeatedExport, secondTrack, other]);
    expect(detail.body).toMatchObject({
      route: { id: "ride-export-1--t1" },
      variants: [
        { id: "ride-export-1--t1", label: "Track 1", copyCount: 2 },
        { id: "ride-export-1--t2", label: "Track 2", copyCount: 1 },
      ],
    });
  });
});
