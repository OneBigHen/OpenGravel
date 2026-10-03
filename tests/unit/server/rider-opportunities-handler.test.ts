import { describe, expect, it, vi } from "vitest";

import { createDiscoverCoordinator } from "@/application/discover";
import {
  handleRiderOpportunitiesNear,
  handleRiderOpportunitiesRoute,
} from "@/server/rider-opportunities/handler";

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
    const body = (await response.json()) as {
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
      discoverCoordinator: createDiscoverCoordinator({ sources: [] }),
      now: () => NOW,
    });
    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      mode: string;
      searchedRadiusMiles: number | null;
      opportunities: Array<{ name: string; kind: string }>;
    };
    expect(body.mode).toBe("route");
    expect(body.searchedRadiusMiles).toBeNull();
    expect(body.opportunities.some((item) => item.kind === "event")).toBe(true);
  });
  it("includes bounded Wikimedia discoveries alongside Places and preserves incomplete coverage", async () => {
    const search = vi.fn(async (area: unknown, signal: AbortSignal) => {
      expect(area).toBeDefined();
      expect(signal).toBeInstanceOf(AbortSignal);
      return {
        status: "ok" as const,
        reason: null,
        places: [
          {
            id: "wiki:overlook",
            name: "Mountain overlook",
            category: "viewpoint" as const,
            categories: ["viewpoint" as const],
            coordinate: { lon: -75.435, lat: 40.136 },
            description: "A documented scenic overlook.",
            image: null,
            wikidataId: "Q1",
            facts: {},
            tags: [],
            confidence: 0.9,
            provenance: [
              {
                sourceId: "wikimedia",
                sourceLabel: "Wikimedia",
                recordId: "Q1",
                url: "https://en.wikipedia.org/wiki/Example",
                retrievedAt: new Date(NOW).toISOString(),
              },
            ],
          },
        ],
      };
    });
    const response = await handleRiderOpportunitiesNear(
      new Request(
        "http://localhost/api/rider-opportunities?lat=40.136&lon=-75.435&radiusMiles=100",
      ),
      {
        env: { OGV_PLACES_FIXTURE: "1" },
        now: () => NOW,
        wikimediaSource: { id: "wikimedia", label: "Wikimedia", search },
      },
    );
    const body = (await response.json()) as {
      opportunities: readonly { name: string }[];
      sources: readonly { id: string; status: string }[];
    };
    expect(body.opportunities.map((item) => item.name)).toContain(
      "Mountain overlook",
    );
    expect(search).toHaveBeenCalledTimes(1);
    const area = search.mock.calls[0]?.[0] as {
      samples: readonly { radiusMeters: number }[];
    };
    expect(area.samples.length).toBeLessThanOrEqual(12);
    expect(area.samples.every((sample) => sample.radiusMeters <= 10000)).toBe(
      true,
    );
    expect(body.sources).toContainEqual(
      expect.objectContaining({ id: "wikimedia", status: "partial" }),
    );
  });
});
