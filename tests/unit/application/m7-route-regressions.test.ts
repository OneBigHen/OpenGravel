import { describe, expect, it } from "vitest";

import { createExploreDerivative, parseCatalogEntries, parseCatalogEntry, type CatalogEntry } from "@/application/explore/catalog";
import { filterAndSortCatalog } from "@/application/explore/query";
import { handleCatalogDetail, handleCatalogList } from "@/server/explore/catalog-http";
import {
  handleContributionModerationDecideRequest,
  handleContributionModerationGetRequest,
} from "@/server/contributions/http";
import { SQLiteContributionStore } from "@/server/contributions/store";
import { buildCatalogRecords } from "@/application/explore/catalog-build";

const route = (id: string, surfaceSummary: string): CatalogEntry => ({
  id,
  source: "catalog",
  name: id,
  region: "Demo area",
  summary: "A synthetic route used by this test.",
  distanceKm: 20,
  bounds: null,
  geometry: [
    { lon: 12.1, lat: 45.1 },
    { lon: 12.2, lat: 45.15 },
    { lon: 12.3, lat: 45.2 },
    { lon: 12.4, lat: 45.25 },
    { lon: 12.5, lat: 45.3 },
  ],
  provenance: "Synthetic test data.",
  surfaceSummary,
  curvatureSummary: "Some curves",
});

describe("M7 route planning regressions", () => {
  it("turns the catalog line into bounded route-along checkpoints for the planner", () => {
    const entry = route("curvy-catalog-route", "Mostly paved");
    const derivative = createExploreDerivative(entry, "2026-09-24T10:00:00.000Z");

    expect(derivative.intent.shaping.map((point) => point.coordinate)).toEqual(entry.geometry.slice(1, -1));
    const longRoute = route("long-catalog-route", "Mostly paved");
    const longGeometry = Array.from({ length: 100 }, (_, index) => ({ lon: -75.5 + index * 0.001, lat: 40.5 + index * 0.001 }));
    expect(createExploreDerivative({ ...longRoute, geometry: longGeometry }).intent.shaping).toHaveLength(32);
  });

  it("does not match unpaved routes in the paved Explore filter", () => {
    const entries = [route("unpaved", "Mostly unpaved"), route("paved", "Mostly paved")];

    expect(filterAndSortCatalog(entries, { surface: "paved", sort: "name" }).map((entry) => entry.id)).toEqual(["paved"]);
  });

  it("does not return unpaved routes from the paved catalog API filter", () => {
    const entries = [route("unpaved", "Mostly unpaved"), route("paved", "Mostly paved")];
    const response = handleCatalogList(new URL("http://localhost/api/catalog?surface=paved"), entries);

    expect(response.body).toMatchObject({ count: 1, routes: [{ id: "paved" }] });
  });

  it("requires a configured bearer token for the moderation queue and decisions", async () => {
    const previousToken = process.env.OGV_MODERATION_TOKEN;
    delete process.env.OGV_MODERATION_TOKEN;
    const store = new SQLiteContributionStore(":memory:");
    try {
      const queue = await handleContributionModerationGetRequest(
        new Request("http://localhost/api/contributions/moderation"),
        store,
      );
      expect(queue.status).toBe(503);

      process.env.OGV_MODERATION_TOKEN = "m7-test-moderation-token";
      const unauthorizedQueue = await handleContributionModerationGetRequest(
        new Request("http://localhost/api/contributions/moderation"),
        store,
      );
      const unauthorizedDecision = await handleContributionModerationDecideRequest(
        new Request("http://localhost/api/contributions/moderation", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ id: "contrib_moderation-test", decision: "accept" }),
        }),
        store,
      );
      const authorizedQueue = await handleContributionModerationGetRequest(
        new Request("http://localhost/api/contributions/moderation", {
          headers: { authorization: "Bearer m7-test-moderation-token" },
        }),
        store,
      );

      expect(unauthorizedQueue.status).toBe(401);
      expect(unauthorizedDecision.status).toBe(401);
      expect(authorizedQueue.status).toBe(200);
    } finally {
      store.close();
      if (previousToken === undefined) delete process.env.OGV_MODERATION_TOKEN;
      else process.env.OGV_MODERATION_TOKEN = previousToken;
    }
  });

  it("builds the catalog test fixture from three small attributed GPX routes", () => {
    const gpx = (lon: number) => `<gpx><trkpt lon="${lon}" lat="40.5"/><trkpt lon="${lon + 0.01}" lat="40.6"/></gpx>`;
    const records = buildCatalogRecords([1, 2, 3].map((index) => ({
      id: `fixture-${index}`,
      name: `Fixture ${index}`,
      sourceProject: "Catalog test fixture",
      sourceFile: `fixture-${index}.gpx`,
      gpx: gpx(-75.5 + index * 0.1),
    })));

    expect(records.map((record) => record.id)).toEqual(["fixture-1", "fixture-2", "fixture-3"]);
    expect(records.every((record) => record.geometry.length === 2)).toBe(true);
  });

  it("keeps road evidence when catalog list and detail responses are parsed in the browser", () => {
    const sample = route("synthetic-road-route", "Mostly paved");
    const entries = parseCatalogEntries([{
      ...sample,
      roads: [{
        name: "Sample Road",
        class: "secondary",
        endpoints: sample.geometry.slice(0, 2),
        aliases: [],
        firstSeen: "2026-01-01T00:00:00.000Z",
        lastSeen: "2026-01-01T00:00:00.000Z",
        startDistanceMeters: 0,
        endDistanceMeters: 20_000,
        ridesThroughCount: 0,
        evidence: [],
      }],
    }]);
    const list = handleCatalogList(new URL("http://localhost/api/catalog"), entries);
    const listRoute = (list.body.routes as readonly Record<string, unknown>[])[0]!;
    const parsedListRoute = parseCatalogEntry({
      ...listRoute,
      geometry: listRoute.preview,
      previewGeometry: listRoute.preview,
    });
    const detail = handleCatalogDetail(entries[0]!.id, entries);
    const parsedDetailRoute = parseCatalogEntry(detail.body.route);

    expect(parsedListRoute?.roadDetails).toHaveLength(1);
    expect(parsedDetailRoute?.roadDetails).toHaveLength(1);
  });
});
