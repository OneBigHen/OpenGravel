import { describe, expect, it } from "vitest";

import { handleRiderOpportunitiesNear, handleRiderOpportunitiesRoute } from "@/server/rider-opportunities/handler";

const NOW = Date.parse("2026-09-24T16:00:00.000Z");

describe("rider opportunities handler", () => {
  it("uses the existing Places fixture through the broad rider-radius endpoint", async () => {
    const request = new Request(
      "http://localhost/api/rider-opportunities?lat=40.136&lon=-75.435&radiusMiles=100",
    );
    const response = await handleRiderOpportunitiesNear(request, {
      env: { OGV_PLACES_FIXTURE: "1" },
      now: () => NOW,
    });
    expect(response.status).toBe(200);
    const body = await response.json() as {
      mode: string;
      searchedRadiusMiles: number | null;
      opportunities: Array<{ name: string; kind: string }>;
    };
    expect(body.mode).toBe("near");
    expect(body.searchedRadiusMiles).toBe(100);
    expect(body.opportunities.map((item) => item.name)).toEqual(
      expect.arrayContaining(["Sample Cafe", "Sample Ride Event"]),
    );
  });

  it("switches to route mode without requiring rider location", async () => {
    const request = new Request("http://localhost/api/rider-opportunities", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        line: [
          { lon: -75.45, lat: 40.12 },
          { lon: -75.42, lat: 40.15 },
        ],
      }),
    });
    const response = await handleRiderOpportunitiesRoute(request, {
      env: { OGV_PLACES_FIXTURE: "1" },
      now: () => NOW,
    });
    expect(response.status).toBe(200);
    const body = await response.json() as {
      mode: string;
      searchedRadiusMiles: number | null;
      opportunities: Array<{ name: string; kind: string }>;
    };
    expect(body.mode).toBe("route");
    expect(body.searchedRadiusMiles).toBeNull();
    expect(body.opportunities.some((item) => item.kind === "event")).toBe(true);
  });
});
