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
      "cache-control": "public, max-age=0, s-maxage=15, must-revalidate",
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

  it("sends a card-sized, metre-precision preview line instead of the build preview", () => {
    const points = Array.from({ length: 200 }, (_, index) => ({
      lat: 40 + index / 10_000 + index / 1_000_000,
      lon: -75 - index / 10_000 - index / 1_000_000,
    }));
    const longEntry = { ...entry, geometry: points, previewGeometry: points };
    const list = handleCatalogList(new URL("http://localhost/api/catalog"), [longEntry]);
    const preview = (list.body.routes as readonly Record<string, unknown>[])[0]!["preview"] as readonly { lat: number; lon: number }[];

    expect(preview).toHaveLength(80);
    expect(preview[0]).toEqual({ lat: 40, lon: -75 });
    expect(preview.at(-1)).toEqual({
      lat: Math.round(points.at(-1)!.lat * 1e5) / 1e5,
      lon: Math.round(points.at(-1)!.lon * 1e5) / 1e5,
    });
    for (const point of preview) {
      expect(point.lat).toBe(Math.round(point.lat * 1e5) / 1e5);
      expect(point.lon).toBe(Math.round(point.lon * 1e5) / 1e5);
    }
    // The route page still gets the untouched line from the detail endpoint.
    expect(handleCatalogDetail("route-1", [longEntry]).body).toEqual({ route: longEntry });
  });

  it("keeps a large catalog list within a measured payload budget", () => {
    const points = (offset: number) => Array.from({ length: 200 }, (_, index) => ({
      lat: 40 + index / 10_000 + offset,
      lon: -75 - index / 10_000 - offset,
    }));
    const routes = Array.from({ length: 112 }, (_, index) => ({
      ...entry,
      id: `route-${index}`,
      name: `River loop ${index}`,
      geometry: points(index / 1000),
      previewGeometry: points(index / 1000),
    }));

    const list = handleCatalogList(new URL("http://localhost/api/catalog"), routes);
    const bytes = new TextEncoder().encode(JSON.stringify(list.body)).length;

    // Before the preview was bounded this fixture was ~700 KB; the budget fails
    // loudly if a future change puts the whole build preview back on the list.
    expect(bytes).toBeLessThan(480_000);
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
