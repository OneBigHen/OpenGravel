/**
 * Miss a turn and get put back on the same ride, against the real router (RM-6).
 *
 * One curvy A-to-B and one dirt loop from the scorecard tuning set. For each,
 * the rider stands 400 m off the planned line at three places, riding the
 * line's way. Each reroute must make at most 3 router calls, take under 3 s,
 * keep the planned line exactly from the rejoin point, and ask for the ride's
 * own profile.
 *
 * Run: `npm run test:real-router -- reroute --maxWorkers=2`
 * Skips loudly when no router answers at GRAPHHOPPER_URL (default 127.0.0.1:8989).
 */
import { describe, expect, it } from "vitest";

import { createMemoryGeometryStore } from "@/application/geometry/memory-geometry-store";
import { buildProviderRequest } from "@/application/planner/build-plan-request";
import type { ProviderCandidate, ProviderRouteRequest } from "@/application/planner/route-provider";
import { createGuidedReroutePlanner } from "@/application/ride-session/guided-reroute";
import { lineAhead } from "@/application/ride-session/loop-rejoin";
import { buildRerouteRequest } from "@/application/ride-session/reroute";
import { haversine } from "@/domain/geometry/analysis";
import { bearingOf, chainage, nearestAlong, pointAlong } from "@/application/ride-session/rejoin-splice";
import { createRideDocument } from "@/domain/ride/create";
import type { PointId } from "@/domain/ride/ids";
import type { Coordinate, RideDocument, RideIntent } from "@/domain/ride/types";
import type { SessionNavigationState } from "@/domain/ride-session/navigation";
import { profileFor } from "@/infrastructure/routing/graphhopper/profiles";
import { createGraphHopperProvider } from "@/infrastructure/routing/graphhopper/provider";

import { plannedTailStart } from "../ride-sim/assertions";

const BASE_URL = process.env.GRAPHHOPPER_URL ?? "http://127.0.0.1:8989";

async function reachable(): Promise<boolean> {
  try {
    return (await fetch(`${BASE_URL}/health`, { signal: AbortSignal.timeout(1_500) })).ok;
  } catch {
    return false;
  }
}

const NOW = "2026-11-12T12:00:00.000Z";

function point(id: string, kind: "start" | "finish", coordinate: Coordinate) {
  return { id: id as PointId, kind, coordinate, provenance: { type: "map" as const, selectedAt: NOW } };
}

interface LiveRide {
  readonly label: string;
  readonly intent: RideIntent;
}

const base = createRideDocument({ now: NOW });
const RIDES: readonly LiveRide[] = [
  {
    // tests/scorecard/rides.json tuning: harrisburg-lancaster (curvy, A-to-B).
    label: "Harrisburg → Lancaster (curvy A-to-B)",
    intent: {
      ...base.intent,
      shape: "destination",
      start: point("pt_live_start", "start", { lon: -76.8867, lat: 40.2732 }),
      finish: point("pt_live_finish", "finish", { lon: -76.3055, lat: 40.0379 }),
      roadCharacter: "curvy",
      tollPolicy: "allow-with-warning",
    },
  },
  {
    // tests/scorecard/rides.json tuning: pine-grove-loop-2h (gravel loop, 2 h).
    label: "Pine Grove Furnace loop, 2 h (dirt loop)",
    intent: {
      ...base.intent,
      shape: "loop",
      start: point("pt_live_loop", "start", { lon: -77.305, lat: 40.0325 }),
      finish: null,
      time: { kind: "budget", targetMinutes: 120, toleranceMinutes: 18 },
      surface: { preference: "dirt-preferred", unknownSurfacePolicy: "allow-with-warning" },
      tollPolicy: "allow-with-warning",
    },
  },
];

/** 400 m to the left of the line at `along`, riding the line's way. */
function offLine(line: readonly Coordinate[], along: number): { coordinate: Coordinate; heading: number } {
  const chain = chainage(line);
  const here = pointAlong(line, chain, along);
  const ahead = pointAlong(line, chain, along + 50).coordinate;
  const heading = bearingOf(here.coordinate, ahead);
  const left = ((heading - 90) * Math.PI) / 180;
  const meters = 400;
  return {
    coordinate: {
      lat: here.coordinate.lat + (Math.cos(left) * meters) / 111_320,
      lon: here.coordinate.lon + (Math.sin(left) * meters) / (111_320 * Math.cos((here.coordinate.lat * Math.PI) / 180)),
    },
    heading,
  };
}

function navigationAt(document: RideDocument, coordinate: Coordinate, heading: number): SessionNavigationState {
  return {
    sessionId: "sess_live_reroute" as SessionNavigationState["sessionId"], activity: "guided", resumeActivity: null,
    startedAt: NOW, endedAt: null, endReason: null,
    plan: { rideId: document.rideId, rideRevision: document.revision, route: { planningGeneration: 1, routeId: "route_live" as never } },
    recordingId: null, aheadGuidanceSuspended: false, instruction: null, offRouteState: "off-route",
    nextStopId: null, completedStopIds: [], remainingStopIds: [],
    position: { coordinate, observedAt: NOW, ageMs: 0, accuracyMeters: 5, headingDegrees: heading, speedMps: 15, quality: "fresh-good" },
  };
}

/** Kilometres of `route` more than 30 m from the planned line from `fromMeters` on: the part of the ride that changed. */
function changedKm(route: readonly Coordinate[], planned: readonly Coordinate[], fromMeters: number): number {
  const chain = chainage(planned);
  let changed = 0;
  for (let index = 1; index < route.length; index += 1) {
    const a = route[index - 1]!;
    const b = route[index]!;
    const middle = { lon: (a.lon + b.lon) / 2, lat: (a.lat + b.lat) / 2 };
    const near = pointAlong(planned, chain, nearestAlong(planned, chain, middle, fromMeters)).coordinate;
    if (haversine(middle, near) > 30) changed += haversine(a, b);
  }
  return changed / 1000;
}

const live = (await reachable()) ? describe : describe.skip;

live(`missed-turn reroute against the live router (${BASE_URL})`, () => {
  for (const ride of RIDES) {
    it(`${ride.label}: three missed turns, each back on the planned line in ≤3 calls and <3 s`, async () => {
      const router = createGraphHopperProvider({ baseUrl: BASE_URL, riderModesEnabled: true });
      const built = await buildProviderRequest(ride.intent, { resolveGeometry: () => null, includeAlternatives: false, requestId: "req_live_reroute_plan", profileFor });
      if (!built.ok) throw new Error(`the ride request could not be built: ${JSON.stringify(built.issues)}`);
      const planned = (await router.candidates(built.request, AbortSignal.timeout(180_000))).candidates[0];
      if (planned === undefined || planned.instructions === undefined) throw new Error("no planned route");
      const line = planned.geometry;
      const chain = chainage(line);
      const total = chain.at(-1) as number;
      const document: RideDocument = { ...base, intent: ride.intent };

      for (const share of [0.25, 0.5, 0.75]) {
        const along = total * share;
        const rider = offLine(line, along);
        const requests: ProviderRouteRequest[] = [];
        const answers: ProviderCandidate[] = [];
        const counted = {
          beginAttempt: () => undefined,
          async candidates(request: ProviderRouteRequest, signal: AbortSignal) {
            requests.push(request);
            const answer = await router.candidates(request, signal);
            answers.push(...answer.candidates.slice(0, 1));
            return answer;
          },
        };
        const geometry = createMemoryGeometryStore();
        const planner = createGuidedReroutePlanner({
          rides: { loadRide: async () => ({ ok: true as const, document }) } as never,
          geometry,
          provider: counted,
        });
        const started = performance.now();
        const result = await planner.plan({
          navigation: navigationAt(document, rider.coordinate, rider.heading),
          route: { line, alongMeters: along, instructions: planned.instructions, durationSeconds: planned.durationSeconds },
          signal: AbortSignal.timeout(30_000),
        });
        const seconds = (performance.now() - started) / 1000;
        expect(result.status, `${ride.label} at ${share}`).toBe("planned");
        if (result.status !== "planned") continue;
        const stored = await geometry.get(result.routeGeometryRef);
        const spliced = stored?.payload.kind === "line" ? stored.payload.coordinates : [];
        const tail = plannedTailStart(spliced, line);
        const joinAlong = tail === null ? null : nearestAlong(line, chain, spliced[tail.joinIndex]!, chain[tail.plannedFrom - 1]!, chain[tail.plannedFrom]!);
        console.log(
          `REROUTE LIVE ${ride.label} at ${Math.round(share * 100)}% (${(along / 1000).toFixed(1)} km of ${(total / 1000).toFixed(1)}): ` +
          `calls=${requests.length} time=${seconds.toFixed(2)}s rejoin=${result.rejoin === undefined ? "none (full replan)" : `${(result.rejoin.connectorMeters / 1000).toFixed(2)} km back`} ` +
          `joinsAt=${joinAlong === null ? "-" : `${((joinAlong - along) / 1000).toFixed(2)} km ahead`} ` +
          `kept=${joinAlong === null ? 0 : ((total - joinAlong) / 1000).toFixed(1)} km unchanged; profiles=${[...new Set(requests.map((request) => request.profile))].join(",")} (ride ${built.request.profile})`,
        );
        if (ride.intent.shape === "loop") {
          // Before RM-6: one replan of the whole rest of the loop through 6 km anchors.
          const before = await buildRerouteRequest(
            { currentPosition: rider.coordinate, authoredIntent: ride.intent, remainingStopIds: [], completedStopIds: [], aheadLine: lineAhead(line, along) },
            { resolveGeometry: () => null, includeAlternatives: false, requestId: "req_live_reroute_before", profileFor },
          );
          if (before.ok) {
            const old = (await router.candidates({ ...before.request, originHeadingDegrees: rider.heading }, AbortSignal.timeout(60_000))).candidates[0];
            const after = changedKm(spliced, line, along);
            console.log(
              `BEFORE/AFTER loop at ${Math.round(share * 100)}%: ${((total - along) / 1000).toFixed(1)} km of loop left; ` +
              `before RM-6 ${old === undefined ? "no route" : `${changedKm(old.geometry, line, along).toFixed(1)} km of new road`}; ` +
              `after ${after.toFixed(1)} km of new road (all of it before the rejoin point)`,
            );
          }
        }
        expect(requests.length, `${ride.label} at ${share}: router calls`).toBeLessThanOrEqual(3);
        expect(seconds, `${ride.label} at ${share}: seconds`).toBeLessThan(3);
        expect(result.rejoin, `${ride.label} at ${share}: rejoined, not replanned`).toBeDefined();
        expect(tail, `${ride.label} at ${share}: tail is the planned line`).not.toBeNull();
        expect(requests.every((request) => request.profile === built.request.profile), "connector profile").toBe(true);
        expect(answers.every((answer) => answer.profile === built.request.profile), "answer profile").toBe(true);
      }
    }, 300_000);
  }
});
