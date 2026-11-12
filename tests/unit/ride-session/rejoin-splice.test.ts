import { describe, expect, it } from "vitest";

import {
  chainage,
  chooseRejoin,
  connectorProblem,
  pointAlong,
  rejoinTargets,
  splice,
  type ConnectorRoute,
  type LinePoint,
  type PlannedRoute,
  type RejoinOption,
} from "@/application/ride-session/rejoin-splice";
import { haversine } from "@/domain/geometry/analysis";
import type { Coordinate } from "@/domain/ride/types";
import type { RouteInstruction } from "@/domain/route/types";

const LAT = 40.5;
const LON_PER_METER = 1 / (111_320 * Math.cos((LAT * Math.PI) / 180));
const LAT_PER_METER = 1 / 111_320;

/** 20 km heading east, a vertex every 250 m, with a 500 m jog north at 7.5 km. */
function plannedRoute(): PlannedRoute {
  const geometry: Coordinate[] = [];
  for (let index = 0; index <= 80; index += 1) {
    const north = index >= 30 ? 500 : 0;
    geometry.push({ lon: -77 + index * 250 * LON_PER_METER, lat: LAT + north * LAT_PER_METER });
    if (index === 30) {
      // The jog is its own segment: east at 30 is replaced by a step north first.
      geometry[geometry.length - 1] = { lon: -77 + 29 * 250 * LON_PER_METER, lat: LAT + 500 * LAT_PER_METER };
    }
  }
  const chain = chainage(geometry);
  const at = (index: number): number => chain[index] as number;
  const stretch = (from: number, to: number): { distanceMeters: number; durationSeconds: number } => ({
    distanceMeters: at(to) - at(from),
    durationSeconds: (at(to) - at(from)) / 15,
  });
  const last = geometry.length - 1;
  const instructions: RouteInstruction[] = [
    { text: "Head east on Ridge Road", type: "depart", roadName: "Ridge Road", geometryIndex: 0, ...stretch(0, 29) },
    { text: "Turn left onto Gap Lane", type: "turn", maneuver: "left", roadName: "Gap Lane", geometryIndex: 29, ...stretch(29, 30) },
    { text: "Turn right onto Hollow Road", type: "turn", maneuver: "right", roadName: "Hollow Road", geometryIndex: 30, ...stretch(30, last) },
    { text: "Arrive", type: "finish", geometryIndex: last, distanceMeters: 0, durationSeconds: 0 },
  ];
  const distanceMeters = instructions.reduce((sum, instruction) => sum + instruction.distanceMeters, 0);
  const durationSeconds = instructions.reduce((sum, instruction) => sum + instruction.durationSeconds, 0);
  return {
    geometry,
    instructions,
    distanceMeters,
    durationSeconds,
    speedLimits: [{ fromIndex: 0, toIndex: 29, kmh: 72 }, { fromIndex: 30, toIndex: last, kmh: 56 }],
    surfaceRuns: [{ from: 0, to: 4_000, kind: "paved" }, { from: 4_000, to: at(last), kind: "gravel" }],
  };
}

const ROUTE = plannedRoute();
const CHAIN = chainage(ROUTE.geometry);
const TURNS = ROUTE.instructions.map((instruction) => CHAIN[instruction.geometryIndex as number] as number);

/** A rider 400 m south of the line, `along` metres in. */
function riderAt(along: number): Coordinate {
  const point = pointAlong(ROUTE.geometry, CHAIN, along).coordinate;
  return { lon: point.lon, lat: point.lat - 400 * LAT_PER_METER };
}

/** Rider → a point 200 m before the target on the line → the target, joining the line's own road. */
function connectorTo(target: LinePoint, from: Coordinate, options: { seconds?: number; roadName?: string; uturn?: boolean } = {}): ConnectorRoute {
  const before = pointAlong(ROUTE.geometry, CHAIN, target.alongMeters - 200).coordinate;
  const geometry = [from, before, target.coordinate];
  const first = haversine(from, before);
  const second = haversine(before, target.coordinate);
  const seconds = options.seconds ?? (first + second) / 12;
  const cover = [...ROUTE.instructions].reverse().find((instruction) => (instruction.geometryIndex as number) <= target.segmentIndex);
  const roadName = options.roadName ?? cover?.roadName ?? "Hollow Road";
  return {
    geometry,
    distanceMeters: first + second,
    durationSeconds: seconds,
    instructions: [
      { text: options.uturn === true ? "Make a U-turn" : "Head north on Mill Lane", type: "turn", roadName: "Mill Lane", geometryIndex: 0, distanceMeters: first, durationSeconds: seconds * (first / (first + second)) },
      { text: `Turn right onto ${roadName}`, type: "turn", maneuver: "right", roadName, geometryIndex: 1, distanceMeters: second, durationSeconds: seconds * (second / (first + second)) },
      { text: "Arrive", type: "finish", geometryIndex: 2, distanceMeters: 0, durationSeconds: 0 },
    ],
    speedLimits: [{ fromIndex: 0, toIndex: 2, kmh: 40 }],
  };
}

const NO_GOOD = { plannedSeconds: (a: number, b: number) => (b - a) / 15, goodMeters: () => 0 };

describe("rejoinTargets", () => {
  it("puts three targets about 0.8, 3 and 8 km beyond the rider's nearest point ahead", () => {
    const targets = rejoinTargets(ROUTE.geometry, { fromAlongMeters: 9_000, turnAlongMeters: TURNS });
    expect(targets.map((target) => Math.round(target.alongMeters))).toEqual([9_800, 12_000, 17_000]);
  });

  it("never passes the next stop still to visit", () => {
    const targets = rejoinTargets(ROUTE.geometry, { fromAlongMeters: 9_000, nextStopAlongMeters: 11_000, turnAlongMeters: TURNS });
    expect(targets.map((target) => Math.round(target.alongMeters))).toEqual([9_800]);
  });

  it("never comes within 300 m of the finish", () => {
    const total = CHAIN.at(-1) as number;
    const targets = rejoinTargets(ROUTE.geometry, { fromAlongMeters: total - 1_000 });
    expect(targets).toEqual([]);
  });

  it("never sits in a reported spot, and rejoins beyond one on the line ahead", () => {
    const spot = pointAlong(ROUTE.geometry, CHAIN, 11_000).coordinate;
    const half = 60;
    const ring = [
      { lon: spot.lon - half * LON_PER_METER, lat: spot.lat - half * LAT_PER_METER },
      { lon: spot.lon + half * LON_PER_METER, lat: spot.lat - half * LAT_PER_METER },
      { lon: spot.lon + half * LON_PER_METER, lat: spot.lat + half * LAT_PER_METER },
      { lon: spot.lon - half * LON_PER_METER, lat: spot.lat + half * LAT_PER_METER },
    ];
    const targets = rejoinTargets(ROUTE.geometry, { fromAlongMeters: 9_000, blockedRings: [ring], turnAlongMeters: TURNS });
    expect(targets.length).toBeGreaterThan(0);
    for (const target of targets) {
      expect(target.alongMeters).toBeGreaterThanOrEqual(11_000 + half + 300 - 1);
    }
  });

  it("never sits on a planned turn", () => {
    const turnAt = TURNS[1] as number;
    const targets = rejoinTargets(ROUTE.geometry, { fromAlongMeters: turnAt - 800, turnAlongMeters: TURNS });
    for (const target of targets) {
      for (const turn of TURNS) expect(Math.abs(target.alongMeters - turn)).toBeGreaterThanOrEqual(39);
    }
  });

  it("starts at 3 km after two ignored reroutes", () => {
    const targets = rejoinTargets(ROUTE.geometry, { fromAlongMeters: 9_000, far: true });
    expect(Math.round(targets[0]!.alongMeters)).toBe(12_000);
  });
});

describe("chooseRejoin", () => {
  const rider = riderAt(9_000);
  const targets = rejoinTargets(ROUTE.geometry, { fromAlongMeters: 9_000, turnAlongMeters: TURNS });
  const options = (overrides: (target: LinePoint, index: number) => ConnectorRoute): RejoinOption[] =>
    targets.map((target, index) => ({ target, connector: overrides(target, index) }));

  it("takes the earliest rejoin when its connector needs no U-turn", () => {
    const chosen = chooseRejoin(options((target) => connectorTo(target, rider)), ROUTE.geometry, NO_GOOD);
    expect(chosen?.target.alongMeters).toBe(targets[0]!.alongMeters);
  });

  it("skips a rejoin whose connector needs a U-turn", () => {
    const chosen = chooseRejoin(
      options((target, index) => connectorTo(target, rider, { uturn: index === 0 })),
      ROUTE.geometry,
      NO_GOOD,
    );
    expect(chosen?.target.alongMeters).toBe(targets[1]!.alongMeters);
  });

  it("skips a connector that joins the line against its direction", () => {
    const target = targets[0]!;
    // East along a parallel road, north onto the line beyond the target, then west back to it.
    const after = pointAlong(ROUTE.geometry, CHAIN, target.alongMeters + 200).coordinate;
    const south = { lon: after.lon, lat: rider.lat };
    const backwards: ConnectorRoute = { ...connectorTo(target, rider), geometry: [rider, south, after, target.coordinate] };
    expect(connectorProblem(backwards, ROUTE.geometry, target)).toBe("joins-backwards");
  });

  it("lets a later rejoin win only when the time it saves outweighs the good miles it skips", () => {
    // The earliest connector is 20 minutes slower than riding the line.
    const slowFirst = options((target, index) => connectorTo(target, rider, index === 0 ? { seconds: 1_500 } : {}));
    expect(chooseRejoin(slowFirst, ROUTE.geometry, NO_GOOD)?.target.alongMeters).not.toBe(targets[0]!.alongMeters);
    // …but the stretch it would skip holds 5 km of bends: worth more than 20 minutes.
    const goodSkipped = { ...NO_GOOD, goodMeters: (a: number, b: number) => (b - a > 0 ? 5_000 : 0) };
    expect(chooseRejoin(slowFirst, ROUTE.geometry, goodSkipped)?.target.alongMeters).toBe(targets[0]!.alongMeters);
  });

  it("returns null when every connector misses the line", () => {
    const missing = options((target) => ({ ...connectorTo(target, rider), geometry: [rider, riderAt(target.alongMeters)] }));
    expect(chooseRejoin(missing, ROUTE.geometry, NO_GOOD)).toBeNull();
  });
});

describe("splice", () => {
  const rider = riderAt(9_000);
  const target = rejoinTargets(ROUTE.geometry, { fromAlongMeters: 9_000, turnAlongMeters: TURNS })[0]!;
  const connector = connectorTo(target, rider);
  const spliced = splice(connector, ROUTE, target);

  it("keeps the planned line from the rejoin point exactly, vertex for vertex", () => {
    expect(spliced).not.toBeNull();
    const result = spliced!;
    expect(result.geometry[result.joinIndex]).toEqual(target.coordinate);
    expect(result.geometry.slice(result.joinIndex + 1)).toEqual(ROUTE.geometry.slice(target.segmentIndex + 1));
    // The join point lies on the planned segment it was taken from.
    const a = ROUTE.geometry[target.segmentIndex]!;
    const b = ROUTE.geometry[target.segmentIndex + 1]!;
    expect(haversine(a, target.coordinate) + haversine(target.coordinate, b)).toBeCloseTo(haversine(a, b), 3);
  });

  it("adds up: connector plus the rest of the ride, within 1 m and 1 s", () => {
    const result = spliced!;
    const restMeters = (CHAIN.at(-1) as number) - target.alongMeters;
    expect(Math.abs(result.distanceMeters - (connector.distanceMeters + restMeters))).toBeLessThan(1);
    const sum = result.instructions.reduce((total, instruction) => total + instruction.distanceMeters, 0);
    expect(Math.abs(sum - result.distanceMeters)).toBeLessThan(1);
    const seconds = result.instructions.reduce((total, instruction) => total + instruction.durationSeconds, 0);
    expect(Math.abs(seconds - result.durationSeconds)).toBeLessThan(1);
    expect(Math.abs(result.durationSeconds - (connector.durationSeconds + restMeters / 15))).toBeLessThan(1);
  });

  it("keeps the turn list in order with no duplicate at the join", () => {
    const result = spliced!;
    const indices = result.instructions.map((instruction) => instruction.geometryIndex as number);
    expect(indices).toEqual([...indices].sort((a, b) => a - b));
    expect(new Set(indices).size).toBe(indices.length);
    expect(result.instructions.filter((instruction) => instruction.type === "finish")).toHaveLength(1);
    expect(result.instructions.at(-1)?.type).toBe("finish");
    expect(result.instructions.at(-1)?.geometryIndex).toBe(result.geometry.length - 1);
    // The planned finish and every planned instruction after the join are carried over unchanged but for the index.
    const offset = result.joinIndex + 1 - (target.segmentIndex + 1);
    const after = ROUTE.instructions.filter((instruction) => (instruction.geometryIndex as number) > target.segmentIndex);
    expect(result.instructions.slice(-after.length)).toEqual(after.map((instruction) => ({ ...instruction, geometryIndex: (instruction.geometryIndex as number) + offset })));
  });

  it("moves speed limits and surface runs onto the spliced line", () => {
    const result = spliced!;
    expect(result.speedLimits?.[0]).toEqual({ fromIndex: 0, toIndex: result.joinIndex, kmh: 40 });
    for (const span of result.speedLimits ?? []) expect(span.toIndex).toBeLessThan(result.geometry.length);
    const runs = result.surfaceRuns ?? [];
    const total = chainage(result.geometry).at(-1) as number;
    expect(Math.abs((runs.at(-1)?.to ?? 0) - total)).toBeLessThan(1);
    expect(runs.every((run) => run.kind === "gravel")).toBe(true);
  });

  it("refuses rather than guesses when the connector joins on a different road", () => {
    expect(splice(connectorTo(target, rider, { roadName: "Some Other Road" }), ROUTE, target)).toBeNull();
  });

  it("refuses when an instruction has no geometry index", () => {
    const stripped = {
      ...ROUTE,
      instructions: ROUTE.instructions.map((instruction) => ({ text: instruction.text, type: instruction.type, distanceMeters: instruction.distanceMeters, durationSeconds: instruction.durationSeconds })),
    };
    expect(splice(connector, stripped, target)).toBeNull();
  });
});
