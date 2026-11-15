/**
 * Rider gates that need the real router (GATE-OUT-OF-AREA #321, the place-sheet half of GATE-SUMMARY-TRUTH #322).
 *
 * Run: `npm run test:real-router -- tests/real-router/rider-gates-live.test.ts --maxWorkers=1`
 * Needs the router at GRAPHHOPPER_URL (default http://127.0.0.1:8989; on docker-dev that is the tunnel to
 * production's router, so keep to one light request at a time). Skips loudly when no router answers.
 *
 * What a rider sees when they plan somewhere OpenGravel's own map does not cover:
 *  - within 10 seconds, a labelled "Basic route" they can ride, or a plain sentence saying why not;
 *  - never 40 seconds of silence, and never the false "no legal route" (a statement about the world,
 *    when the truth is "our map ends here").
 */
import { describe, expect, it } from "vitest";

import { placeDistance } from "@/ui/place/PlaceSheet";
import { haversine } from "@/domain/geometry/analysis";
import type { Coordinate } from "@/domain/ride/types";
import { createGraphHopperProvider } from "@/infrastructure/routing/graphhopper/provider";
import { handleRoutePlanRequest } from "@/server/planning/route-handler";
import { planRide } from "@/server/planning/plan-service";

const BASE_URL = process.env["GRAPHHOPPER_URL"] ?? "http://127.0.0.1:8989";
/** What the rider is allowed to wait before they see either a route or a sentence. */
const RIDER_PATIENCE_MS = 10_000;

async function reachable(): Promise<boolean> {
  try {
    return (await fetch(`${BASE_URL}/health`, { signal: AbortSignal.timeout(1_500) })).ok;
  } catch {
    return false;
  }
}

const live = (await reachable()) ? describe : describe.skip;

interface Trip {
  readonly name: string;
  readonly from: Coordinate;
  readonly to: Coordinate;
}

/** Two short, ordinary city rides far outside PA / NJ / NY, where the tuned map ends. */
const OUT_OF_AREA: readonly Trip[] = [
  { name: "Denver", from: { lat: 39.7392, lon: -104.9903 }, to: { lat: 39.7527, lon: -104.9668 } },
  { name: "Asheville", from: { lat: 35.5951, lon: -82.5515 }, to: { lat: 35.6129, lon: -82.5601 } },
];

/** Words that state a fact about the world instead of about our map. */
const FALSE_NO_ROUTE = /no legal route|no legal way|no road|no route exists|impossible/i;

async function plan(trip: Trip): Promise<{ readonly ms: number; readonly status: number; readonly body: Record<string, unknown> }> {
  const startedAt = Date.now();
  const result = await handleRoutePlanRequest(
    {
      identity: { rideId: "ride_gate_area", rideRevision: 1, planningGeneration: 1 },
      request: {
        requestId: `gate-${trip.name}`,
        origin: trip.from,
        destination: trip.to,
        destinationLabel: trip.name,
        stops: [],
        shaping: [],
        profile: "motorcycle_fastest",
        avoidPolygons: [],
        options: { vehicle: "motorcycle", includeAlternatives: false, avoidHighways: false, tollPolicy: "avoid" },
      },
    },
    {
      plan: (input, { signal }) =>
        planRide(input, { env: { GRAPHHOPPER_URL: BASE_URL, ...(process.env["STADIA_API_KEY"] ? { STADIA_API_KEY: process.env["STADIA_API_KEY"] } : {}) }, signal }),
    },
  );
  return { ms: Date.now() - startedAt, status: result.status, body: result.body as unknown as Record<string, unknown> };
}

live(`out-of-area planning against the live router (${BASE_URL})`, () => {
  for (const trip of OUT_OF_AREA) {
    it(`${trip.name}: a labelled basic route or a clear sentence within ${RIDER_PATIENCE_MS / 1000} s, never a false "no legal route"`, async () => {
      const { ms, status, body } = await plan(trip);
      console.log(`GATE-OUT-OF-AREA ${trip.name}: ${ms} ms, status ${status}`, JSON.stringify(body).slice(0, 400));
      expect(ms, `${trip.name} took ${ms} ms`).toBeLessThanOrEqual(RIDER_PATIENCE_MS);

      const candidates = (body["bundle"] as { candidates?: readonly { warnings: readonly { code: string; message: string }[]; distanceMeters: number }[] } | undefined)?.candidates;
      if (status === 200 && candidates !== undefined) {
        // A route here must say what it is: a basic line, with the plain-English label.
        expect(candidates.length).toBeGreaterThan(0);
        const label = candidates[0]!.warnings.find((warning) => warning.code === "basic-routing");
        expect(label, "an out-of-area route carries the Basic route label").toBeDefined();
        expect(label!.message).toMatch(/^Basic route/);
        // Short city rides stay short: a sane road distance, not a detour across the continent.
        const straight = haversine(trip.from, trip.to);
        expect(candidates[0]!.distanceMeters).toBeGreaterThan(straight * 0.9);
        expect(candidates[0]!.distanceMeters).toBeLessThan(straight * 4 + 2_000);
      } else {
        // No route is allowed only as a plain sentence about OUR coverage or service.
        const error = body["error"] as { code?: string; message?: string } | undefined;
        expect(error?.message, "an error carries a sentence for the rider").toBeTruthy();
        expect(error!.message!, "the sentence does not claim the world has no road").not.toMatch(FALSE_NO_ROUTE);
        expect(error!.code, "an out-of-area failure is never filed as a no-route verdict").not.toBe("no-route");
      }
    }, RIDER_PATIENCE_MS + 20_000);
  }
});

live(`place sheet and route agree (${BASE_URL})`, () => {
  it("the place sheet's 'mi away' is the straight line, and the road distance to it is never shorter and never absurd", async () => {
    const rider: Coordinate = { lat: 40.6023, lon: -75.4714 }; // Allentown
    const place: Coordinate = { lat: 40.8757, lon: -75.7324 }; // Jim Thorpe
    const provider = createGraphHopperProvider({ baseUrl: BASE_URL });
    const answer = await provider.candidates(
      {
        requestId: "gate-place-distance",
        origin: rider,
        destination: place,
        stops: [],
        shaping: [],
        profile: "motorcycle_fastest",
        avoidPolygons: [],
        options: { includeAlternatives: false, avoidHighways: false, tollPolicy: "avoid", vehicle: "motorcycle" },
      },
      new AbortController().signal,
    );
    const route = answer.candidates[0];
    if (route === undefined) throw new Error("no route Allentown to Jim Thorpe");
    const sheet = placeDistance(place, rider);
    expect(sheet).toMatch(/^\d+(\.\d)? mi away$/);
    const sheetMiles = Number.parseFloat(sheet!);
    const routeMiles = route.distanceMeters / 1609.344;
    console.log(`GATE-SUMMARY-TRUTH place sheet ${sheet}, route ${routeMiles.toFixed(1)} mi`);
    expect(routeMiles, "a road is never shorter than the straight line").toBeGreaterThanOrEqual(sheetMiles - 0.6);
    expect(routeMiles, "the road is not wildly longer than the straight line").toBeLessThanOrEqual(sheetMiles * 2.2 + 2);
  }, 40_000);
});
