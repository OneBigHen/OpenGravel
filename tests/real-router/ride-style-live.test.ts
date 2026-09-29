/**
 * Ride style changes the live answer (MVP parity M2, OGV-D-262).
 *
 * The plan's rule is "no decorative controls": every Ride style option the
 * composer offers must make GraphHopper answer differently for at least one
 * real Pennsylvania ride. Each pair below was chosen from a probe of the
 * installed graph (2026-09-23) because the option visibly matters there.
 */

import { describe, expect, it } from "vitest";

import type { ProviderRouteRequest } from "@/application/planner/route-provider";
import type { Coordinate } from "@/domain/ride/types";
import { createGraphHopperProvider } from "@/infrastructure/routing/graphhopper/provider";

const BASE_URL = process.env.GRAPHHOPPER_URL ?? "http://127.0.0.1:8989";

async function routerIsReachable(): Promise<boolean> {
  try {
    return (await fetch(`${BASE_URL}/health`, { signal: AbortSignal.timeout(1_500) })).ok;
  } catch {
    return false;
  }
}

const reachable = await routerIsReachable();
const live = reachable ? describe : describe.skip;

const JIM_THORPE: Coordinate = { lon: -75.7387, lat: 40.8636 };
const HAWK_MOUNTAIN: Coordinate = { lon: -75.9832, lat: 40.6364 };
const ALLENTOWN: Coordinate = { lon: -75.4714, lat: 40.6023 };
const STROUDSBURG: Coordinate = { lon: -75.1946, lat: 40.9868 };
const BETHLEHEM: Coordinate = { lon: -75.3705, lat: 40.6259 };
const PHILADELPHIA: Coordinate = { lon: -75.1652, lat: 39.9526 };
const KING_OF_PRUSSIA: Coordinate = { lon: -75.396, lat: 40.089 };
const HARRISBURG: Coordinate = { lon: -76.8867, lat: 40.2732 };

function request(
  origin: Coordinate,
  destination: Coordinate,
  overrides: Partial<Omit<ProviderRouteRequest, "options">> & {
    readonly options?: Partial<ProviderRouteRequest["options"]>;
  } = {},
): ProviderRouteRequest {
  const { options, ...rest } = overrides;
  return {
    requestId: "req_style_live",
    origin,
    destination,
    stops: [],
    shaping: [],
    profile: "motorcycle_fastest",
    avoidPolygons: [],
    ...rest,
    options: {
      includeAlternatives: false,
      avoidHighways: false,
      tollPolicy: "allow-with-warning",
      surfacePreference: "mixed",
      vehicle: "motorcycle",
      ...options,
    },
  };
}

async function best(value: ProviderRouteRequest) {
  const provider = createGraphHopperProvider({ baseUrl: BASE_URL });
  const result = await provider.candidates(value, new AbortController().signal);
  const candidate = result.candidates[0];
  if (candidate === undefined) throw new Error("the live router returned no candidate");
  return candidate;
}

function fingerprint(candidate: Awaited<ReturnType<typeof best>>): unknown {
  return candidate.providerMetadata?.fingerprint;
}

live(`ride style changes the live answer (${BASE_URL})`, () => {
  it("each road character draws a different ride (Allentown → Stroudsburg)", async () => {
    const [fast, curvy, backroads] = await Promise.all([
      best(request(ALLENTOWN, STROUDSBURG, { profile: "motorcycle_fastest" })),
      best(request(ALLENTOWN, STROUDSBURG, { profile: "motorcycle_twisty" })),
      best(request(ALLENTOWN, STROUDSBURG, { profile: "motorcycle_scenic" })),
    ]);
    expect(new Set([fingerprint(fast), fingerprint(curvy), fingerprint(backroads)]).size).toBe(3);
    // Fast is the quickest of the three; the others trade time for character.
    expect(fast.durationSeconds).toBeLessThan(curvy.durationSeconds);
    expect(fast.durationSeconds).toBeLessThan(backroads.durationSeconds);
  });

  it("avoid highways leaves the interstate (Bethlehem → Philadelphia)", async () => {
    const [allowed, avoided] = await Promise.all([
      best(request(BETHLEHEM, PHILADELPHIA)),
      best(request(BETHLEHEM, PHILADELPHIA, { options: { avoidHighways: true } })),
    ]);
    expect(fingerprint(avoided)).not.toBe(fingerprint(allowed));
    expect(avoided.durationSeconds).toBeGreaterThan(allowed.durationSeconds + 10 * 60);
  });

  it("avoid tolls leaves the Turnpike (King of Prussia → Harrisburg)", async () => {
    const [allowed, avoided] = await Promise.all([
      best(request(KING_OF_PRUSSIA, HARRISBURG)),
      best(request(KING_OF_PRUSSIA, HARRISBURG, { options: { tollPolicy: "avoid" } })),
    ]);
    expect(fingerprint(avoided)).not.toBe(fingerprint(allowed));
  });

  it("a paved preference drops the gravel a mixed ride takes (Jim Thorpe → Hawk Mountain)", async () => {
    // Off the highways the fastest line here uses ~0.6 mi of unpaved road.
    const [mixed, paved] = await Promise.all([
      best(request(JIM_THORPE, HAWK_MOUNTAIN, { options: { avoidHighways: true } })),
      best(request(JIM_THORPE, HAWK_MOUNTAIN, { options: { avoidHighways: true, surfacePreference: "pavement" } })),
    ]);
    expect(fingerprint(paved)).not.toBe(fingerprint(mixed));
  });

  it("a loop's ride time sets its length (Jim Thorpe, 1 h vs 3 h)", async () => {
    const loop = (targetMinutes: number) =>
      best(
        request(JIM_THORPE, JIM_THORPE, {
          requestId: `req_style_loop_${targetMinutes}`,
          discovery: { targetMinutes, toleranceMinutes: 20 },
        }),
      );
    const [short, long] = await Promise.all([loop(60), loop(180)]);
    expect(long.distanceMeters).toBeGreaterThan(short.distanceMeters * 1.8);
  });

  it("a curvy 3 h loop lands near 3 h, not the engine's raw overshoot", async () => {
    const provider = createGraphHopperProvider({ baseUrl: BASE_URL });
    const answer = await provider.candidates(
      request(JIM_THORPE, JIM_THORPE, {
        requestId: "req_style_loop_calibrated",
        profile: "motorcycle_twisty",
        discovery: { targetMinutes: 180, toleranceMinutes: 27 },
      }),
      new AbortController().signal,
    );
    const misses = answer.candidates.map((candidate) => Math.abs(candidate.durationSeconds / 60 - 180));
    // Before calibration the same ask came back at 5 h 25 min (OGV-D-262).
    expect(Math.min(...misses)).toBeLessThanOrEqual(27);
  });
});
