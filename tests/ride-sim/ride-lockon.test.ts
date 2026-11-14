/**
 * GATE-RIDE-LOCKON (#327) and QA-18 (#279): a ride that started far from its
 * line stays locked on.
 *
 * The route is what "Head to the start" binds: a ~50 mi way to the start
 * followed by the planned line. Two rides are replayed through the real
 * navigation engine:
 *
 * - walking the whole thing in 15 m steps, no off-route may show and the
 *   average speed must stay a believable number;
 * - sitting at the old spot, then jumping to the start of the planned line (the
 *   QA sweep's "teleport to the start") and riding the line: the engine must
 *   not call the rider off the route while they are on it.
 */

import { describe, expect, it } from "vitest";

import { haversine } from "@/domain/geometry/analysis";
import type { Coordinate } from "@/domain/ride/types";
import { newRideId } from "@/domain/ride/ids";
import { asRouteCandidateId } from "@/domain/route/ids";
import { buildGuidedNavigationRoute } from "@/application/ride-session/navigation-route";
import { createRideNavigationEngine } from "@/application/ride-session/navigation-engine";
import { createRideSessionController } from "@/application/ride-session/ride-session-controller";
import type { ProgressFrame } from "@/domain/ride-session/progress";

import { createMemoryGeometryStore } from "@/application/geometry/memory-geometry-store";
import type { ProviderRouteRequest } from "@/application/planner/route-provider";
import { createGuidedReroutePlanner } from "@/application/ride-session/guided-reroute";
import { createRideDocument } from "@/domain/ride/create";
import type { PointId } from "@/domain/ride/ids";
import type { SessionNavigationState } from "@/domain/ride-session/navigation";
import type { RouteInstruction } from "@/domain/route/types";

import { createReplayPositionSource, type ReplayFix } from "./replay-position-source";

const METERS_PER_DEGREE = 111_320;
const START_MS = Date.UTC(2026, 10, 14, 9, 0, 0);
const STEP_METERS = 15;
const SPEED_MPS = 15;
const APPROACH_METERS = 82_000; // about 51 mi
const LINE_METERS = 24_000;

function step(from: Coordinate, bearingDegrees: number, meters: number): Coordinate {
  const radians = (bearingDegrees * Math.PI) / 180;
  const latitude = (from.lat * Math.PI) / 180;
  return {
    lat: from.lat + (Math.cos(radians) * meters) / METERS_PER_DEGREE,
    lon: from.lon + (Math.sin(radians) * meters) / (METERS_PER_DEGREE * Math.cos(latitude)),
  };
}

/** A winding road: 100 m pieces, bearing swinging like a back road. */
function windingRoad(from: Coordinate, meters: number, baseBearing: number): Coordinate[] {
  const points: Coordinate[] = [from];
  let at = from;
  for (let travelled = 0; travelled < meters; travelled += 100) {
    const bearing = baseBearing + 55 * Math.sin(travelled / 900) + 20 * Math.sin(travelled / 230);
    at = step(at, bearing, 100);
    points.push(at);
  }
  return points;
}

const RIDER_HOME: Coordinate = { lon: -75.4, lat: 40.2 };
const APPROACH = windingRoad(RIDER_HOME, APPROACH_METERS, 20);
const LINE_START = APPROACH.at(-1) as Coordinate;
const LINE = windingRoad(LINE_START, LINE_METERS, 100);
const LINE_INSTRUCTIONS: RouteInstruction[] = [
  { text: "Head out on Ridge Road", type: "depart", roadName: "Ridge Road", geometryIndex: 0, distanceMeters: LINE_METERS, durationSeconds: LINE_METERS / 15 },
  { text: "Arrive", type: "finish", geometryIndex: LINE.length - 1, distanceMeters: 0, durationSeconds: 0 },
];

/**
 * What "Head to the start" binds, made by the app's own planner. The fake
 * router is as free as the real one: it rides the way to the start, and when
 * asked to pass through points it takes roads of its own between them (here 150
 * m to the side), so a route that merely passes near the line leaves it.
 */
async function headToStartRoute(): Promise<{ route: Coordinate[]; approach: Coordinate[] }> {
  const geometry = createMemoryGeometryStore();
  const base = createRideDocument({ now: "2026-11-14T09:00:00.000Z" });
  const document = {
    ...base,
    intent: {
      ...base.intent,
      shape: "destination" as const,
      start: { id: "pt_s" as PointId, kind: "start" as const, coordinate: LINE[0] as Coordinate, provenance: { type: "map" as const, selectedAt: "2026-11-14T09:00:00.000Z" } },
      finish: { id: "pt_f" as PointId, kind: "finish" as const, coordinate: LINE.at(-1) as Coordinate, provenance: { type: "map" as const, selectedAt: "2026-11-14T09:00:00.000Z" } },
    },
  };
  const router = {
    beginAttempt: (): void => undefined,
    candidates: async (request: ProviderRouteRequest) => {
      const aside = (point: Coordinate): Coordinate => step(point, 0, 150);
      const through = request.shaping.length === 0
        ? windingRoad(request.origin, 0, 0).concat([request.destination])
        : [request.origin, ...request.shaping.map(aside), request.destination];
      // The connector the real router finds: the approach road we recorded.
      const geometryOut = request.shaping.length === 0 ? [...APPROACH.slice(0, -1), request.destination] : through;
      const meters = geometryOut.slice(1).reduce((sum, point, index) => sum + haversine(geometryOut[index] as Coordinate, point), 0);
      return { candidates: [{
        providerId: "fake", profile: request.profile, geometry: geometryOut, distanceMeters: meters, durationSeconds: meters / 15,
        instructions: [
          { text: "Head out", type: "depart" as const, roadName: "Approach Road", geometryIndex: 0, distanceMeters: meters, durationSeconds: meters / 15 },
          { text: "Arrive", type: "finish" as const, geometryIndex: geometryOut.length - 1, distanceMeters: 0, durationSeconds: 0 },
        ],
        providerMetadata: { candidateId: "route_to_start", bestRide: true },
      }] };
    },
  };
  const planner = createGuidedReroutePlanner({ rides: { loadRide: async () => ({ ok: true as const, document }) } as never, geometry, provider: router });
  const navigation = {
    sessionId: "sess_lockon", activity: "guided", resumeActivity: null, startedAt: "2026-11-14T09:00:00.000Z", endedAt: null, endReason: null,
    plan: { rideId: document.rideId, rideRevision: document.revision, route: { planningGeneration: 1, routeId: "route_old" } },
    recordingId: null, aheadGuidanceSuspended: false, instruction: null, offRouteState: "off-route",
    nextStopId: null, completedStopIds: [], remainingStopIds: [],
    position: { coordinate: RIDER_HOME, observedAt: "2026-11-14T09:00:00.000Z", ageMs: 0, accuracyMeters: 6, headingDegrees: 20, speedMps: 0, quality: "fresh-good" },
  } as unknown as SessionNavigationState;
  const result = await planner.plan({
    navigation, aheadLine: LINE, followLine: true,
    route: { line: LINE, alongMeters: 0, instructions: LINE_INSTRUCTIONS },
    signal: new AbortController().signal,
  });
  if (result.status !== "planned") throw new Error(`head to start did not plan: ${result.reason}`);
  const stored = await geometry.get(result.routeGeometryRef);
  const route = stored?.payload.kind === "line" ? [...stored.payload.coordinates] : [];
  return { route, approach: APPROACH };
}

function pathOf(line: readonly Coordinate[]): { points: Coordinate[]; headings: number[] } {
  const points: Coordinate[] = [];
  const headings: number[] = [];
  let carry = 0;
  for (let index = 1; index < line.length; index += 1) {
    const a = line[index - 1] as Coordinate;
    const b = line[index] as Coordinate;
    const length = haversine(a, b);
    const heading = (Math.atan2((b.lon - a.lon) * Math.cos((a.lat * Math.PI) / 180), b.lat - a.lat) * 180) / Math.PI;
    for (let at = carry; at < length; at += STEP_METERS) {
      const fraction = at / length;
      points.push({ lon: a.lon + (b.lon - a.lon) * fraction, lat: a.lat + (b.lat - a.lat) * fraction });
      headings.push((heading + 360) % 360);
    }
    carry = ((carry - length) % STEP_METERS + STEP_METERS) % STEP_METERS;
  }
  return { points, headings };
}

interface Result {
  readonly offRouteFrames: number;
  readonly firstOffRouteAt: number | null;
  readonly frames: readonly (ProgressFrame | null)[];
  readonly events: readonly string[];
  readonly averageMph: number;
}

async function ride(fixes: readonly ReplayFix[], routeLine: readonly Coordinate[]): Promise<Result> {
  const clockRef = { ms: START_MS };
  const clock = (): string => new Date(clockRef.ms).toISOString();
  const replay = createReplayPositionSource({ fixes });
  const nowIso = (): string => new Date(replay.nowMs()).toISOString();
  void clock;
  const controller = createRideSessionController({ now: nowIso });
  const binding = { planningGeneration: 1, routeId: asRouteCandidateId("route_lockon") };
  const started = await controller.start({
    activity: "guided",
    rideId: newRideId(),
    rideRevision: 1,
    route: binding,
    at: new Date(START_MS - 1_000).toISOString(),
  });
  if (started.outcome !== "applied") throw new Error("could not start the session");
  const resolved = buildGuidedNavigationRoute(binding, routeLine, []);
  const engine = createRideNavigationEngine({
    session: controller,
    route: resolved,
    positionSource: replay,
    speech: { async speak(): Promise<void> {} },
    wakeLock: null,
    now: nowIso,
  });
  await engine.start();
  const frames: (ProgressFrame | null)[] = [];
  await replay.playEach(async () => {
    await engine.flush();
    frames.push(engine.snapshot().frame);
  });
  await engine.flush();
  const offFrames = frames.filter((frame) => frame !== null && frame.offRouteState === "off-route");
  const firstOff = frames.findIndex((frame) => frame !== null && frame.offRouteState === "off-route");
  const first = fixes[0];
  const last = fixes.at(-1);
  const hours = first === undefined || last === undefined ? 1 : (last.atMs - first.atMs) / 3_600_000;
  const moved = fixes.reduce((sum, fix, index) => (index === 0 ? 0 : sum + haversine((fixes[index - 1] as ReplayFix).coordinate, fix.coordinate)), 0);
  return {
    offRouteFrames: offFrames.length,
    firstOffRouteAt: firstOff < 0 ? null : firstOff,
    frames,
    events: [],
    averageMph: moved / 1609.344 / hours,
  };
}

function fixesFor(points: readonly Coordinate[], headings: readonly number[], startMs: number, from = 0): ReplayFix[] {
  return points.map((coordinate, index) => ({
    coordinate,
    observedAt: new Date(startMs + (from + index) * 1_000).toISOString(),
    atMs: startMs + (from + index) * 1_000,
    intendedDistanceMeters: (from + index) * STEP_METERS,
    accuracyMeters: 8,
    headingDegrees: headings[index] ?? 0,
    speedMps: SPEED_MPS,
  }));
}

describe("a ride that started far from its line stays locked on (#327, QA-18)", () => {
  it("walking the whole 50 mi way to the start, then the planned line, in 15 m steps never shows off-route", async () => {
    const { route } = await headToStartRoute();
    // The rider follows the bound route up to the start of the line, then the planned line itself.
    const startIndex = route.findIndex((point) => haversine(point, LINE[0] as Coordinate) < 1);
    const way = pathOf(route.slice(0, startIndex + 1));
    const planned = pathOf(LINE);
    const points = [...way.points, ...planned.points];
    const headings = [...way.headings, ...planned.headings];
    const result = await ride(fixesFor(points, headings, START_MS), route);
    expect(result.firstOffRouteAt, `first off-route at fix ${result.firstOffRouteAt} of ${points.length}`).toBeNull();
    expect(result.averageMph).toBeLessThan(60);
  }, 120_000);

  it("after jumping to the start of the planned line, riding it never shows off-route", async () => {
    const { route } = await headToStartRoute();
    const waiting = Array.from({ length: 12 }, (_, index): ReplayFix => ({
      coordinate: RIDER_HOME,
      observedAt: new Date(START_MS + index * 1_000).toISOString(),
      atMs: START_MS + index * 1_000,
      intendedDistanceMeters: 0,
      accuracyMeters: 8,
      headingDegrees: 20,
      speedMps: 0,
    }));
    const { points, headings } = pathOf(LINE);
    const onLine = fixesFor(points, headings, START_MS + 12_000);
    const result = await ride([...waiting, ...onLine], route);
    const afterJump = result.frames.slice(waiting.length);
    const off = afterJump.findIndex((frame) => frame !== null && frame.offRouteState === "off-route");
    expect(off, `off-route ${off} fixes after the jump, of ${afterJump.length}`).toBe(-1);
  }, 120_000);
});
