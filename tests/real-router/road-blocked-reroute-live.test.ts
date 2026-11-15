/**
 * "Road blocked" while riding, against the live router (#295).
 *
 * A rider on a real planned line marks the road blocked where they stand. The
 * production reroute planner (the same one the ride screen uses) asks the real
 * router, one request at a time, and must: start the new line at the rider,
 * ride the road just ridden out of the spot, keep the new road out of the spot,
 * rejoin the planned line beyond it, and carry the spot into a later reroute.
 *
 * Run: `GRAPHHOPPER_URL=http://localhost:8989 npm run test:real-router -- tests/real-router/road-blocked-reroute-live.test.ts --maxWorkers=1`
 * Skips loudly when no router answers at GRAPHHOPPER_URL (default 127.0.0.1:8989).
 */
import { describe, expect, it, vi } from "vitest";

import { createMemoryGeometryStore } from "@/application/geometry/memory-geometry-store";
import type { ProviderRouteRequest } from "@/application/planner/route-provider";
import { createGuidedReroutePlanner } from "@/application/ride-session/guided-reroute";
import { bearingOf, chainage, pointAlong, ringSpanAlong } from "@/application/ride-session/rejoin-splice";
import { saveRiderReport } from "@/application/persistence/rider-report-repository";
import { newRiderReport, reportsToAvoidAreas } from "@/application/roads/rider-reports";
import { haversine } from "@/domain/geometry/analysis";
import { defaultRideIntent } from "@/domain/ride/create";
import type { PointId } from "@/domain/ride/ids";
import type { Coordinate } from "@/domain/ride/types";
import { createGraphHopperProvider } from "@/infrastructure/routing/graphhopper/provider";

const BASE_URL = process.env.GRAPHHOPPER_URL ?? "http://127.0.0.1:8989";

async function reachable(): Promise<boolean> {
  try {
    return (await fetch(`${BASE_URL}/health`, { signal: AbortSignal.timeout(1_500) })).ok;
  } catch {
    return false;
  }
}

const START: Coordinate = { lon: -76.8867, lat: 40.2732 };
const FINISH: Coordinate = { lon: -76.3055, lat: 40.0379 };
const live = (await reachable()) ? describe : describe.skip;

live(`road blocked while riding against the live router (${BASE_URL})`, () => {
  it("reroutes the rider out of the spot, round it and back onto the planned line", async () => {
    const memory = new Map<string, string>();
    vi.stubGlobal("window", {
      localStorage: {
        getItem: (key: string) => memory.get(key) ?? null,
        setItem: (key: string, value: string) => void memory.set(key, value),
        removeItem: (key: string) => void memory.delete(key),
      },
    });
    const real = createGraphHopperProvider({ baseUrl: BASE_URL });
    // One request at a time, and a count of them.
    const requests: ProviderRouteRequest[] = [];
    let inFlight = 0;
    let maxInFlight = 0;
    const provider = {
      beginAttempt: (identity: { readonly rideId: string; readonly rideRevision: number; readonly planningGeneration: number }) => void identity,
      async candidates(request: ProviderRouteRequest, signal: AbortSignal) {
        requests.push(request);
        inFlight += 1;
        maxInFlight = Math.max(maxInFlight, inFlight);
        try { return await real.candidates(request, signal); } finally { inFlight -= 1; }
      },
    };

    const intent = {
      ...defaultRideIntent(),
      shape: "destination" as const,
      start: { id: "pt_live_start" as PointId, kind: "start" as const, coordinate: START, provenance: { type: "derived" as const, reason: "live check" } },
      finish: { id: "pt_live_finish" as PointId, kind: "finish" as const, coordinate: FINISH, provenance: { type: "derived" as const, reason: "live check" } },
    };
    const planned = (await real.candidates({
      requestId: "live_planned", origin: START, destination: FINISH, stops: [], shaping: [], profile: "motorcycle_twisty", avoidPolygons: [], roadSpans: [],
      options: { includeAlternatives: false, avoidHighways: false, tollPolicy: "allow-with-warning", vehicle: "motorcycle" },
    } as ProviderRouteRequest, new AbortController().signal)).candidates[0];
    if (planned === undefined || planned.instructions === undefined) throw new Error("no planned route");
    const line = planned.geometry;
    const chain = chainage(line);

    // The rider has ridden 8 km and is on the line, stopped at the blockage.
    const riderAlong = 8_000;
    const here = pointAlong(line, chain, riderAlong);
    const now = Date.now();
    const report = newRiderReport({ id: "rr_live_here", point: here.coordinate, headingDegrees: null, kind: "gate-closed", nowMs: now });
    expect(saveRiderReport(report, now)).toBe(true);
    const ring = reportsToAvoidAreas([report], now)[0]!.ring;

    const at = new Date(now).toISOString();
    const geometry = createMemoryGeometryStore();
    const planner = createGuidedReroutePlanner({
      rides: { loadRide: async () => ({ ok: true as const, document: { rideId: "ride_live", revision: 1, intent } }) } as never,
      geometry,
      provider,
      now: () => at,
    });
    const navigation = {
      activity: "guided",
      resumeActivity: null,
      plan: { rideId: "ride_live", rideRevision: 1, route: { planningGeneration: 1, routeId: "route_live" } },
      remainingStopIds: [],
      completedStopIds: [],
      position: {
        coordinate: here.coordinate, observedAt: at, ageMs: 0, accuracyMeters: 5,
        headingDegrees: bearingOf(here.coordinate, line[here.segmentIndex + 1]!), speedMps: 0.5, quality: "fresh-good",
      },
    } as never;
    const result = await planner.plan({
      navigation,
      route: { line, alongMeters: riderAlong, instructions: planned.instructions, durationSeconds: planned.durationSeconds },
      reason: "report",
      signal: new AbortController().signal,
    });
    if (result.status !== "planned") throw new Error(`no reroute: ${result.reason}`);
    const stored = await geometry.get(result.routeGeometryRef);
    const spliced = stored?.payload.kind === "line" ? stored.payload.coordinates : [];

    // Starts at the rider; rides the road just ridden out of the spot.
    const startGap = haversine(spliced[0]!, here.coordinate);
    let leftAt = 0;
    while (leftAt < spliced.length - 1 && ringSpanAlong([spliced[leftAt]!, spliced[leftAt + 1]!], [0, 1], ring, 0) !== null) leftAt += 1;
    const outside = spliced.slice(leftAt);
    const reenters = ringSpanAlong(outside, chainage(outside), ring, 0) !== null;
    const nearestToSpot = Math.min(...outside.map((point) => haversine(point, here.coordinate)));
    const planRejoin = result.rejoin;
    // Rejoins the planned line: the last stretch is the planned line exactly.
    const tailMatches = haversine(spliced.at(-1)!, line.at(-1)!) < 1;
    console.log(
      `BLOCKED-HERE LIVE startGap=${startGap.toFixed(1)} m leftSpotAfter=${leftAt} pts reenters=${reenters} ` +
      `nearestOutside=${nearestToSpot.toFixed(0)} m rejoin=${JSON.stringify(planRejoin)} routerCalls=${requests.length} maxInFlight=${maxInFlight} ` +
      `result=${result.distanceMeters.toFixed(0)} m`,
    );
    expect(startGap).toBeLessThan(1);
    expect(leftAt).toBeGreaterThan(0);
    expect(reenters).toBe(false);
    expect(nearestToSpot).toBeGreaterThan(55);
    expect(planRejoin).toBeDefined();
    expect(tailMatches).toBe(true);
    // Every router request carried the spot.
    expect(requests.every((request) => request.avoidPolygons.some((polygon) => polygon.length === ring.length && polygon.every((p, i) => p.lon === ring[i]!.lon && p.lat === ring[i]!.lat)))).toBe(true);
  }, 120_000);
});
