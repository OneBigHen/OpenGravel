/**
 * A rider's reported spot is avoided by the real router (R3-6).
 * Run: `npm run test:real-router -- tests/real-router/rider-report-live.test.ts --maxWorkers=2`
 * Skips loudly when no router answers at GRAPHHOPPER_URL (default 127.0.0.1:8989).
 */
import { describe, expect, it } from "vitest";

import type { ProviderRouteRequest } from "@/application/planner/route-provider";
import { newRiderReport, reportsToAvoidAreas } from "@/application/roads/rider-reports";
import { haversine } from "@/domain/geometry/analysis";
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

const base = (avoidPolygons: readonly (readonly Coordinate[])[]): ProviderRouteRequest => ({
  requestId: "req_rider_report_live",
  origin: { lon: -76.8867, lat: 40.2732 },
  destination: { lon: -76.3055, lat: 40.0379 },
  stops: [],
  shaping: [],
  profile: "motorcycle_twisty",
  avoidPolygons,
  options: { includeAlternatives: false, avoidHighways: false, tollPolicy: "allow-with-warning", vehicle: "motorcycle" },
});

const live = (await reachable()) ? describe : describe.skip;

live(`rider report against the live router (${BASE_URL})`, () => {
  it("keeps the planned line more than 60 m from a reported spot on the fastest route", async () => {
    const provider = createGraphHopperProvider({ baseUrl: BASE_URL });
    const first = (await provider.candidates(base([]), new AbortController().signal)).candidates[0];
    if (first === undefined) throw new Error("no route without the report");
    const spot = first.geometry[Math.floor(first.geometry.length / 2)]!;
    const now = Date.now();
    const areas = reportsToAvoidAreas(
      [newRiderReport({ id: "rr_live", point: spot, headingDegrees: null, kind: "gate-closed", nowMs: now })],
      now,
    );
    const second = (await provider.candidates(base(areas.map((area) => area.ring)), new AbortController().signal)).candidates[0];
    if (second === undefined) throw new Error("no route with the report avoided");
    const nearest = Math.min(...second.geometry.map((point) => haversine(point, spot)));
    console.log(`REPORT AVOIDED nearest=${Math.round(nearest)} m before=${first.distanceMeters} after=${second.distanceMeters}`);
    expect(nearest).toBeGreaterThan(60);
  }, 60_000);
});
