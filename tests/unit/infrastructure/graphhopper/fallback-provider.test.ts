/**
 * Hosted GraphHopper fallback (WORK-ORDER §1.2): our graph answers inside its
 * coverage, the hosted API answers outside it or when ours is down, and the
 * hosted free plan's daily budget is never overrun.
 */

import { describe, expect, it } from "vitest";

import type {
  ProviderCandidateSet,
  ProviderRouteRequest,
  RouteCandidateProvider,
} from "@/application/planner/route-provider";
import type { Coordinate } from "@/domain/ride/types";
import {
  createFallbackRouteProvider,
  engineCoverage,
  type CoverageBox,
} from "@/infrastructure/routing/graphhopper/fallback-provider";
import { createGraphHopperProvider } from "@/infrastructure/routing/graphhopper/provider";
import { GraphHopperProviderError } from "@/infrastructure/routing/graphhopper/response-parser";

const PA_BOX: CoverageBox = [-80.6, 38.8, -73.9, 42.3];
const HARRISBURG: Coordinate = { lon: -76.8867, lat: 40.2732 };
const LANCASTER: Coordinate = { lon: -76.3055, lat: 40.0379 };
const DENVER: Coordinate = { lon: -104.9903, lat: 39.7392 };
const BOULDER: Coordinate = { lon: -105.2705, lat: 40.015 };

function request(origin: Coordinate, destination: Coordinate, stops: readonly Coordinate[] = []): ProviderRouteRequest {
  return {
    requestId: "req_fallback",
    origin,
    destination,
    stops,
    shaping: [],
    profile: "motorcycle_twisty",
    avoidPolygons: [],
    options: {
      includeAlternatives: false,
      avoidHighways: false,
      tollPolicy: "allow-with-warning",
      vehicle: "motorcycle",
    },
  };
}

function stubProvider(id: string, answer: () => Promise<ProviderCandidateSet>): RouteCandidateProvider & { calls: number } {
  const provider = {
    id,
    calls: 0,
    capabilities: () => ({ profiles: [], supportsAlternatives: true, supportsAvoidPolygons: true }),
    candidates: async (): Promise<ProviderCandidateSet> => {
      provider.calls += 1;
      return answer();
    },
  };
  return provider;
}

const EMPTY: ProviderCandidateSet = { candidates: [] };
const signal = new AbortController().signal;

describe("createFallbackRouteProvider", () => {
  it("routes inside coverage on our own graph", async () => {
    const primary = stubProvider("graphhopper", async () => EMPTY);
    const hosted = stubProvider("hosted", async () => EMPTY);
    const provider = createFallbackRouteProvider({ primary, hosted, coverage: async () => PA_BOX, dailyBudget: 5 });
    await provider.candidates(request(HARRISBURG, LANCASTER), signal);
    expect([primary.calls, hosted.calls]).toEqual([1, 0]);
  });

  it("sends a ride with any point outside coverage to the hosted API", async () => {
    const primary = stubProvider("graphhopper", async () => EMPTY);
    const hosted = stubProvider("hosted", async () => EMPTY);
    const provider = createFallbackRouteProvider({ primary, hosted, coverage: async () => PA_BOX, dailyBudget: 5 });
    await provider.candidates(request(DENVER, BOULDER), signal);
    await provider.candidates(request(HARRISBURG, LANCASTER, [DENVER]), signal);
    expect([primary.calls, hosted.calls]).toEqual([0, 2]);
  });

  it("retries on the hosted API when our router is down, but not on a real no-route answer", async () => {
    const down = stubProvider("graphhopper", async () => {
      throw new GraphHopperProviderError("down", "provider-unavailable");
    });
    const hosted = stubProvider("hosted", async () => EMPTY);
    const provider = createFallbackRouteProvider({ primary: down, hosted, coverage: async () => PA_BOX, dailyBudget: 5 });
    await provider.candidates(request(HARRISBURG, LANCASTER), signal);
    expect(hosted.calls).toBe(1);

    const noRoute = stubProvider("graphhopper", async () => {
      throw new GraphHopperProviderError("no route", "no-route");
    });
    const hosted2 = stubProvider("hosted", async () => EMPTY);
    const strict = createFallbackRouteProvider({ primary: noRoute, hosted: hosted2, coverage: async () => PA_BOX, dailyBudget: 5 });
    await expect(strict.candidates(request(HARRISBURG, LANCASTER), signal)).rejects.toMatchObject({ code: "no-route" });
    expect(hosted2.calls).toBe(0);
  });

  it("stops at the daily budget and starts again the next day", async () => {
    let time = Date.parse("2026-09-26T12:00:00Z");
    const primary = stubProvider("graphhopper", async () => EMPTY);
    const hosted = stubProvider("hosted", async () => EMPTY);
    const provider = createFallbackRouteProvider({
      primary, hosted, coverage: async () => PA_BOX, dailyBudget: 2, now: () => time,
    });
    const ride = (n: number): ProviderRouteRequest => request(DENVER, { lon: BOULDER.lon, lat: BOULDER.lat + n / 100 });
    await provider.candidates(ride(1), signal);
    await provider.candidates(ride(2), signal);
    await expect(provider.candidates(ride(3), signal)).rejects.toMatchObject({ code: "provider-unavailable" });
    expect(provider.hostedBudget()).toMatchObject({ used: 2, budget: 2 });
    time += 24 * 3_600_000;
    await provider.candidates(ride(4), signal);
    expect(hosted.calls).toBe(3);
  });

  it("tries our graph when its coverage is unknown", async () => {
    const primary = stubProvider("graphhopper", async () => EMPTY);
    const hosted = stubProvider("hosted", async () => EMPTY);
    const provider = createFallbackRouteProvider({ primary, hosted, coverage: async () => null, dailyBudget: 5 });
    await provider.candidates(request(DENVER, BOULDER), signal);
    expect([primary.calls, hosted.calls]).toEqual([1, 0]);
  });
});

describe("engineCoverage", () => {
  it("reads the bbox from /info once and caches it", async () => {
    let calls = 0;
    const fetcher = (async () => {
      calls += 1;
      return new Response(JSON.stringify({ bbox: PA_BOX }), { status: 200 });
    }) as unknown as typeof fetch;
    const coverage = engineCoverage({ baseUrl: "http://gh", fetcher });
    expect(await coverage()).toEqual(PA_BOX);
    expect(await coverage()).toEqual(PA_BOX);
    expect(calls).toBe(1);
  });

  it("answers null when the engine cannot be read", async () => {
    const fetcher = (async () => { throw new Error("refused"); }) as unknown as typeof fetch;
    expect(await engineCoverage({ baseUrl: "http://gh", fetcher })()).toBeNull();
  });
});

describe("hosted GraphHopper mode", () => {
  it("asks for the stock car profile with the key, no custom model, and marks the line basic", async () => {
    let url = "";
    let body: Record<string, unknown> = {};
    const fetcher = (async (input: string, init: RequestInit) => {
      url = input;
      body = JSON.parse(String(init.body)) as Record<string, unknown>;
      return new Response(JSON.stringify({
        paths: [{
          distance: 45_000,
          time: 2_000_000,
          points: { type: "LineString", coordinates: [[DENVER.lon, DENVER.lat], [BOULDER.lon, BOULDER.lat]] },
        }],
      }), { status: 200 });
    }) as unknown as typeof fetch;
    const provider = createGraphHopperProvider({
      baseUrl: "https://graphhopper.com/api/1",
      hosted: { apiKey: "k 1" },
      fetcher,
    });
    const answer = await provider.candidates(request(DENVER, BOULDER), signal);
    expect(url).toBe("https://graphhopper.com/api/1/route?key=k%201");
    expect(body["profile"]).toBe("car");
    expect(body).not.toHaveProperty("custom_model");
    expect(body["details"]).not.toContain("urban_density");
    expect(answer.candidates[0]?.providerMetadata?.["basicRouting"]).toBe(true);
  });
});

describe("hosted answers shared across lanes", () => {
  it("spends one credit for every lane of one ride", async () => {
    const primary = stubProvider("graphhopper", async () => EMPTY);
    const hosted = stubProvider("hosted", async () => EMPTY);
    const provider = createFallbackRouteProvider({ primary, hosted, coverage: async () => PA_BOX, dailyBudget: 5 });
    await Promise.all(["motorcycle_fastest", "motorcycle_twisty", "motorcycle_scenic"].map((profile) =>
      provider.candidates({ ...request(DENVER, BOULDER), profile, requestId: profile }, signal)));
    expect(hosted.calls).toBe(1);
    expect(provider.hostedBudget().used).toBe(1);
  });
});
