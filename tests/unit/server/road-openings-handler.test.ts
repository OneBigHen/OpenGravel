import { describe, expect, it } from "vitest";

import { createRoadAuthorityCoordinator } from "@/application/route-intelligence/coordinator";
import type { RoadAuthoritySource } from "@/application/route-intelligence/road-authority-source";
import type { RoadAuthorityRecord } from "@/application/route-intelligence/types";
import { handleRoadOpeningsRouteRequest } from "@/server/road-openings/openings-handler";

const AT = "2026-10-02T16:00:00.000Z";

function sourceWith(record: RoadAuthorityRecord): RoadAuthoritySource {
  return {
    info: {
      id: "test-seasonal",
      label: "Test seasonal roads",
      authority: "authoritative-operational",
      family: "road-authority",
      facet: "access",
      coverage: [{ west: -77, south: 39, east: -75, north: 41 }],
      precedence: 0,
    },
    budget: {
      maxRemoteCallsPerPlan: 1,
      maxRecords: 100,
      timeoutMs: 1_000,
      concurrency: 1,
      cacheTtlMs: 60_000,
      serveStaleMs: 60_000,
      retry: "none",
      cancellable: false,
    },
    probe: () => ({ available: true, reason: null }),
    snapshot: async (corridor) => ({
      status: "fresh",
      fetchedAt: AT,
      reason: null,
      records: [record],
      covered: [corridor],
    }),
  };
}

describe("road openings route query", () => {
  it("finds a sparse authority road that crosses the planned route between distant endpoints", async () => {
    const record: RoadAuthorityRecord = {
      sourceId: "test-seasonal",
      sourceRecordId: "crossing",
      kind: "motor-vehicle-designation",
      geometry: {
        type: "line",
        // Endpoints are ~26 miles from the north/south route. The road itself
        // crosses the route at -76,40.
        coordinates: [
          { lon: -76.5, lat: 40 },
          { lon: -75.5, lat: 40 },
        ],
      },
      roadName: "Sparse Crossing Road",
      description: "Normally closed, seasonally open.",
      validFrom: null,
      validUntil: null,
      motorcycleAccess: {
        status: "open",
        seasons: null,
        windows: [{
          validFrom: "2026-10-01T00:00:00.000Z",
          validUntil: "2026-11-01T00:00:00.000Z",
        }],
        outsideWindowStatus: "closed",
      },
    };
    const coordinator = createRoadAuthorityCoordinator({
      sources: [sourceWith(record)],
      now: () => AT,
    });
    const request = new Request("http://localhost/api/road-openings", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        bufferMiles: 15,
        days: 30,
        line: [
          { lon: -76, lat: 39.5 },
          { lon: -76, lat: 40 },
          { lon: -76, lat: 40.5 },
        ],
      }),
    });

    const response = await handleRoadOpeningsRouteRequest(request, {
      coordinator,
      now: () => Date.parse(AT),
    });
    expect(response.status).toBe(200);
    const body = await response.json() as { events: Array<{ roadName: string | null }> };
    expect(body.events.map((event) => event.roadName)).toContain("Sparse Crossing Road");
  });
});
