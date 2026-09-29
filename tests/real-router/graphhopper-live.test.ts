/**
 * Live GraphHopper verification (17-IMPLEMENTATION-PLAN Task 2.2).
 *
 * This suite talks to a real engine — the one the deployment runs, not a
 * fixture. It exists because a stubbed response proves the adapter's parsing and
 * nothing about the contract between OpenGravel's request body and GraphHopper's
 * graph: profiles, custom models, requested details and decoded geometry are all
 * only proven against the running router.
 *
 * Run with `npm run test:real-router` on a host where the router is up
 * (`docker-dev` serves `http://127.0.0.1:8989`; override with `GRAPHHOPPER_URL`).
 * A 1.5 s health probe decides whether the suite is skipped: fixtures are never
 * labeled as live, so an absent router skips loudly instead of passing quietly.
 */

import { describe, expect, it } from "vitest";

import type { ProviderRouteRequest } from "@/application/planner/route-provider";
import { createGraphHopperProvider } from "@/infrastructure/routing/graphhopper/provider";
import { haversine } from "@/domain/geometry/analysis";

const BASE_URL = process.env.GRAPHHOPPER_URL ?? "http://127.0.0.1:8989";
const PROBE_TIMEOUT_MS = 1_500;

/** Harrisburg → Lancaster: both inside the installed Pennsylvania graph. */
const REQUEST: ProviderRouteRequest = {
  requestId: "req_live_pa",
  origin: { lon: -76.8867, lat: 40.2732 },
  destination: { lon: -76.3055, lat: 40.0379 },
  stops: [],
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

async function routerIsReachable(): Promise<boolean> {
  try {
    const response = await fetch(`${BASE_URL}/health`, {
      signal: AbortSignal.timeout(PROBE_TIMEOUT_MS),
    });
    return response.ok;
  } catch {
    return false;
  }
}

const reachable = await routerIsReachable();

const live = reachable ? describe : describe.skip;
const suiteName = reachable
  ? `live GraphHopper (${BASE_URL})`
  : `live GraphHopper SKIPPED — ${`unreachable at ${BASE_URL} (probe timeout ${PROBE_TIMEOUT_MS} ms); start the router or set GRAPHHOPPER_URL`}`;

live(suiteName, () => {
  it("routes two Pennsylvania points and returns decoded, rideable geometry", async () => {
    const provider = createGraphHopperProvider({ baseUrl: BASE_URL });

    const result = await provider.candidates(REQUEST, new AbortController().signal);
    const candidate = result.candidates[0];

    expect(result.candidates.length).toBeGreaterThanOrEqual(1);
    if (candidate === undefined) throw new Error("the live router returned no candidate");
    expect(candidate.providerId).toBe("graphhopper");
    expect(candidate.profile).toBe("motorcycle_twisty");
    expect(candidate.geometry.length).toBeGreaterThanOrEqual(2);
    expect(candidate.distanceMeters).toBeGreaterThan(0);
    expect(candidate.durationSeconds).toBeGreaterThan(0);

    // Decoded, in-travel-order coordinates inside the Pennsylvania graph bbox.
    for (const { lon, lat } of candidate.geometry) {
      expect(lon).toBeGreaterThan(-81);
      expect(lon).toBeLessThan(-74);
      expect(lat).toBeGreaterThan(39);
      expect(lat).toBeLessThan(43);
    }

    console.log(
      [
        "LIVE GRAPHHOPPER ROUTE",
        `url=${BASE_URL}`,
        `profile=${candidate.profile}`,
        `engineVersion=${String(candidate.providerMetadata?.engineVersion)}`,
        `candidates=${result.candidates.length}`,
        `points=${candidate.geometry.length}`,
        `distanceMeters=${candidate.distanceMeters}`,
        `durationSeconds=${candidate.durationSeconds}`,
        `instructions=${candidate.instructions?.length ?? 0}`,
        `fingerprint=${String(candidate.providerMetadata?.fingerprint)}`,
      ].join(" "),
    );
  });

  it("returns the same fingerprint for the same question asked twice", async () => {
    const provider = createGraphHopperProvider({ baseUrl: BASE_URL });

    const first = await provider.candidates(REQUEST, new AbortController().signal);
    const second = await provider.candidates(REQUEST, new AbortController().signal);

    expect(first.candidates[0]?.providerMetadata?.fingerprint).toBeDefined();
    expect(second.candidates[0]?.providerMetadata?.fingerprint).toBe(
      first.candidates[0]?.providerMetadata?.fingerprint,
    );
    expect(second.candidates[0]?.distanceMeters).toBe(first.candidates[0]?.distanceMeters);
  });

  it("generates real timeboxed loops that return to the rider-selected origin", async () => {
    const provider = createGraphHopperProvider({ baseUrl: BASE_URL });
    const origin = REQUEST.origin;
    const result = await provider.candidates({
      ...REQUEST,
      requestId: "req_live_loop_90m",
      destination: origin,
      discovery: { targetMinutes: 90, toleranceMinutes: 20 },
    }, new AbortController().signal);

    expect(result.candidates.length).toBeGreaterThanOrEqual(1);
    expect(result.candidates.length).toBeLessThanOrEqual(3);
    for (const candidate of result.candidates) {
      const first = candidate.geometry[0];
      const last = candidate.geometry[candidate.geometry.length - 1];
      expect(first).toBeDefined();
      expect(last).toBeDefined();
      if (first !== undefined && last !== undefined) {
        expect(haversine(first, origin)).toBeLessThan(25);
        expect(haversine(last, origin)).toBeLessThan(25);
      }
      expect(candidate.distanceMeters).toBeGreaterThan(0);
      expect(candidate.durationSeconds).toBeGreaterThan(0);
    }
    expect(new Set(result.candidates.map((candidate) => candidate.providerMetadata?.fingerprint)).size)
      .toBe(result.candidates.length);
  });
});
