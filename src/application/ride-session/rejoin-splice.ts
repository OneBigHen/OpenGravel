/**
 * Miss a turn and get put back on the same ride (RM-6, ROUTING-MASTER §7).
 *
 * A reroute used to plan the whole rest of the ride again, so the line the
 * rider chose (a loop, a detour through a good road) could change after one
 * wrong turn. Here only the way back is new:
 *
 * 1. `rejoinTargets` picks up to three points on the planned line ahead.
 * 2. The caller asks the router for one short "connector" to each.
 * 3. `chooseRejoin` takes the earliest connector that needs no U-turn, unless a
 *    later one saves more time than the good miles it skips are worth.
 * 4. `splice` joins that connector to the planned line, which is kept exactly,
 *    with its turn list, speed limits and surface runs moved to the new indices.
 *
 * Everything here is pure geometry and arithmetic. When a splice cannot be made
 * exact (a connector arriving at a turn, a missing instruction index, a road
 * name that does not match), `splice` returns null and the caller falls back to
 * a full replan. It never approximates.
 */

import { haversine } from "@/domain/geometry/analysis";
import { measureRoadBends } from "@/domain/geometry/road-bends";
import type { Coordinate } from "@/domain/ride/types";
import type { RouteInstruction, SpeedLimitSpan } from "@/domain/route/types";

import type { SurfaceRunSpan } from "./surface-ahead";

/** How far beyond the rider's nearest point ahead the three targets sit. */
export const REJOIN_OFFSETS_METERS: readonly number[] = [800, 3_000, 8_000];
/** After two ignored reroutes in a row the targets start further on. */
export const REJOIN_FAR_OFFSETS_METERS: readonly number[] = [3_000, 5_000, 8_000];
/** No target this close to the finish: the finish is right there. */
export const REJOIN_FINISH_CLEARANCE_METERS = 300;
/** A target clears a reported or avoided spot by at least this much. */
export const REJOIN_RING_CLEARANCE_METERS = 300;
/** A target this close to a planned turn moves on past it: the join is never a maneuver. */
export const REJOIN_TURN_CLEARANCE_METERS = 40;
/** A connector must end this close to its target to count as back on the line. */
export const REJOIN_JOIN_TOLERANCE_METERS = 30;
/** Arriving this far off the line's own direction means joining against it. */
export const REJOIN_MAX_ARRIVAL_DEGREES = 35;
/** A turn sharper than this inside a connector is a U-turn, whatever its text says. */
const REVERSAL_DEGREES = 160;
/**
 * The trade the Curvy pick already makes (`geometryFunUtility` in
 * `geometry-fun.ts`): one good kilometre is worth about 17 minutes (0.06 km per
 * minute). For dirt rides the same rate is spent on dirt metres.
 */
export const GOOD_KM_PER_MINUTE = 0.06;

// ---------------------------------------------------------------------------
// Line helpers

/** Cumulative metres at each vertex of `line`. */
export function chainage(line: readonly Coordinate[]): readonly number[] {
  const out = [0];
  for (let index = 1; index < line.length; index += 1) {
    out.push((out[index - 1] as number) + haversine(line[index - 1] as Coordinate, line[index] as Coordinate));
  }
  return out;
}

function lerp(from: Coordinate, to: Coordinate, fraction: number): Coordinate {
  return { lon: from.lon + (to.lon - from.lon) * fraction, lat: from.lat + (to.lat - from.lat) * fraction };
}

/** Degrees clockwise of north, on a local flat projection (fine at segment scale). */
export function bearingOf(from: Coordinate, to: Coordinate): number {
  const cos = Math.cos(((from.lat + to.lat) / 2) * (Math.PI / 180));
  const degrees = (Math.atan2((to.lon - from.lon) * cos, to.lat - from.lat) * 180) / Math.PI;
  return (degrees + 360) % 360;
}

export function angleBetween(first: number, second: number): number {
  const difference = Math.abs((((first - second) % 360) + 360) % 360);
  return difference > 180 ? 360 - difference : difference;
}

/** A point on the line: on segment `segmentIndex` → `segmentIndex + 1`, `fraction` of the way. */
export interface LinePoint {
  readonly coordinate: Coordinate;
  readonly alongMeters: number;
  readonly segmentIndex: number;
  /** In (0, 1]. 1 means the point is vertex `segmentIndex + 1` itself. */
  readonly fraction: number;
}

/** The point `alongMeters` along the line (clamped to it). */
export function pointAlong(line: readonly Coordinate[], chain: readonly number[], alongMeters: number): LinePoint {
  const total = chain.at(-1) ?? 0;
  const target = Math.min(total, Math.max(0, alongMeters));
  for (let index = 1; index < line.length; index += 1) {
    const end = chain[index] as number;
    if (end + 1e-9 >= target) {
      const start = chain[index - 1] as number;
      const length = end - start;
      const fraction = length <= 0 ? 1 : Math.min(1, Math.max(0, (target - start) / length));
      if (fraction === 0 && index > 1) {
        // Exactly on vertex index - 1: it is the end of the previous segment.
        return { coordinate: line[index - 1] as Coordinate, alongMeters: start, segmentIndex: index - 2, fraction: 1 };
      }
      const exact = fraction >= 1 - 1e-12;
      return {
        coordinate: exact ? (line[index] as Coordinate) : lerp(line[index - 1] as Coordinate, line[index] as Coordinate, fraction),
        alongMeters: exact ? end : target,
        segmentIndex: index - 1,
        fraction: exact ? 1 : fraction,
      };
    }
  }
  const last = Math.max(0, line.length - 2);
  return { coordinate: line[line.length - 1] as Coordinate, alongMeters: total, segmentIndex: last, fraction: 1 };
}

/**
 * Where `point` projects onto the line, searching only `fromMeters` to
 * `toMeters` along it. Returns metres along the line.
 */
export function nearestAlong(
  line: readonly Coordinate[],
  chain: readonly number[],
  point: Coordinate,
  fromMeters = 0,
  toMeters = Number.POSITIVE_INFINITY,
): number {
  let best = Math.max(0, fromMeters);
  let bestDistance = Number.POSITIVE_INFINITY;
  const cos = Math.cos(point.lat * (Math.PI / 180));
  for (let index = 1; index < line.length; index += 1) {
    const start = chain[index - 1] as number;
    const end = chain[index] as number;
    if (end < fromMeters || start > toMeters) continue;
    const a = line[index - 1] as Coordinate;
    const b = line[index] as Coordinate;
    const dx = (b.lon - a.lon) * cos;
    const dy = b.lat - a.lat;
    const lengthSquared = dx * dx + dy * dy;
    const raw = lengthSquared === 0 ? 0 : (((point.lon - a.lon) * cos) * dx + (point.lat - a.lat) * dy) / lengthSquared;
    let fraction = Math.min(1, Math.max(0, raw));
    let along = start + (end - start) * fraction;
    if (along < fromMeters || along > toMeters) {
      along = Math.min(toMeters, Math.max(fromMeters, along));
      fraction = end === start ? 0 : (along - start) / (end - start);
    }
    const distance = haversine(point, lerp(a, b, fraction));
    if (distance < bestDistance) {
      bestDistance = distance;
      best = along;
    }
  }
  return best;
}

// ---------------------------------------------------------------------------
// Rings

function insideRing(point: Coordinate, ring: readonly Coordinate[]): boolean {
  let inside = false;
  for (let index = 0, previous = ring.length - 1; index < ring.length; previous = index, index += 1) {
    const a = ring[index] as Coordinate;
    const b = ring[previous] as Coordinate;
    if ((a.lat > point.lat) !== (b.lat > point.lat) &&
      point.lon < ((b.lon - a.lon) * (point.lat - a.lat)) / (b.lat - a.lat) + a.lon) {
      inside = !inside;
    }
  }
  return inside;
}

/** Parameter t in [0, 1] along p→q where it crosses a→b, or null. */
function crossing(p: Coordinate, q: Coordinate, a: Coordinate, b: Coordinate): number | null {
  const rx = q.lon - p.lon, ry = q.lat - p.lat, sx = b.lon - a.lon, sy = b.lat - a.lat;
  const denominator = rx * sy - ry * sx;
  if (denominator === 0) return null;
  const t = ((a.lon - p.lon) * sy - (a.lat - p.lat) * sx) / denominator;
  const u = ((a.lon - p.lon) * ry - (a.lat - p.lat) * rx) / denominator;
  return t >= 0 && t <= 1 && u >= 0 && u <= 1 ? t : null;
}

/**
 * The stretch of the line, after `fromMeters`, that lies in or touches the
 * ring: its first and last metres along the line, or null when the line ahead
 * stays clear of it.
 */
export function ringSpanAlong(
  line: readonly Coordinate[],
  chain: readonly number[],
  ring: readonly Coordinate[],
  fromMeters = 0,
): { readonly firstMeters: number; readonly lastMeters: number } | null {
  if (ring.length < 3) return null;
  let first = Number.POSITIVE_INFINITY;
  let last = Number.NEGATIVE_INFINITY;
  const mark = (along: number): void => {
    if (along < fromMeters) return;
    first = Math.min(first, along);
    last = Math.max(last, along);
  };
  const start = pointAlong(line, chain, fromMeters);
  if (insideRing(start.coordinate, ring)) mark(fromMeters);
  for (let index = 1; index < line.length; index += 1) {
    const a = line[index - 1] as Coordinate;
    const b = line[index] as Coordinate;
    const from = chain[index - 1] as number;
    const to = chain[index] as number;
    if (to < fromMeters) continue;
    if (insideRing(b, ring)) mark(to);
    for (let edge = 0; edge < ring.length; edge += 1) {
      const t = crossing(a, b, ring[edge] as Coordinate, ring[(edge + 1) % ring.length] as Coordinate);
      if (t !== null) mark(from + (to - from) * t);
    }
  }
  return Number.isFinite(first) ? { firstMeters: first, lastMeters: last } : null;
}

// ---------------------------------------------------------------------------
// 1. Targets

export interface RejoinTargetOptions {
  /** The rider's nearest point on the line ahead, in metres along it. */
  readonly fromAlongMeters: number;
  /** The next stop still to visit, in metres along the line: no target beyond it. */
  readonly nextStopAlongMeters?: number | null;
  /** Reported spots and avoid areas: no target inside one, and none before one on the line ahead. */
  readonly blockedRings?: readonly (readonly Coordinate[])[];
  /** Metres along the line of every planned turn: a target never sits on one. */
  readonly turnAlongMeters?: readonly number[];
  /** Start the targets further on (the rider ignored two reroutes in a row). */
  readonly far?: boolean;
}

/**
 * Up to three rejoin points on the line ahead, in riding order.
 *
 * Never beyond the next stop still to visit, never within 300 m of the finish,
 * and never at or before a blocked spot on the line ahead: the kept part of the
 * ride must not run through one.
 */
export function rejoinTargets(line: readonly Coordinate[], options: RejoinTargetOptions): readonly LinePoint[] {
  if (line.length < 2) return [];
  const chain = chainage(line);
  const total = chain.at(-1) as number;
  const from = Math.max(0, options.fromAlongMeters);
  const ceiling = Math.min(
    total - REJOIN_FINISH_CLEARANCE_METERS,
    options.nextStopAlongMeters === null || options.nextStopAlongMeters === undefined ? Number.POSITIVE_INFINITY : options.nextStopAlongMeters,
  );
  let floor = from;
  for (const ring of options.blockedRings ?? []) {
    const span = ringSpanAlong(line, chain, ring, from);
    if (span !== null) floor = Math.max(floor, span.lastMeters + REJOIN_RING_CLEARANCE_METERS);
  }
  const offsets = options.far === true ? REJOIN_FAR_OFFSETS_METERS : REJOIN_OFFSETS_METERS;
  const turns = [...(options.turnAlongMeters ?? [])].sort((a, b) => a - b);
  const wanted: number[] = [];
  for (const offset of offsets) {
    let along = Math.max(from + offset, floor === from ? 0 : floor + (offset - (offsets[0] as number)));
    // Step past any planned turn: the join is never a maneuver.
    for (const turn of turns) {
      if (Math.abs(along - turn) < REJOIN_TURN_CLEARANCE_METERS) along = turn + REJOIN_TURN_CLEARANCE_METERS;
    }
    if (along > ceiling || along <= from) continue;
    if (wanted.some((existing) => Math.abs(existing - along) < 200)) continue;
    wanted.push(along);
  }
  return wanted
    .map((along) => pointAlong(line, chain, along))
    .filter((point) => !(options.blockedRings ?? []).some((ring) => insideRing(point.coordinate, ring)));
}

// ---------------------------------------------------------------------------
// 2. Choice

export interface ConnectorRoute {
  /** From the rider to the target, in travel order. */
  readonly geometry: readonly Coordinate[];
  readonly distanceMeters: number;
  readonly durationSeconds: number;
  readonly instructions?: readonly RouteInstruction[];
  readonly speedLimits?: readonly SpeedLimitSpan[];
  readonly surfaceRuns?: readonly SurfaceRunSpan[];
}

export interface RejoinOption {
  readonly target: LinePoint;
  readonly connector: ConnectorRoute;
}

/** Why a connector cannot be used, or null when it can. */
export function connectorProblem(
  connector: ConnectorRoute,
  line: readonly Coordinate[],
  target: LinePoint,
): "too-short" | "misses-line" | "u-turn" | "joins-backwards" | null {
  const geometry = connector.geometry;
  if (geometry.length < 2) return "too-short";
  if (haversine(geometry[geometry.length - 1] as Coordinate, target.coordinate) > REJOIN_JOIN_TOLERANCE_METERS) return "misses-line";
  if ((connector.instructions ?? []).some((instruction) =>
    instruction.maneuver === "uturn" || /u-?turn/i.test(instruction.text) || instruction.type === "uturn")) {
    return "u-turn";
  }
  for (let index = 2; index < geometry.length; index += 1) {
    const a = geometry[index - 2] as Coordinate;
    const b = geometry[index - 1] as Coordinate;
    const c = geometry[index] as Coordinate;
    if (haversine(a, b) < 1 || haversine(b, c) < 1) continue;
    if (angleBetween(bearingOf(a, b), bearingOf(b, c)) > REVERSAL_DEGREES) return "u-turn";
  }
  // The last real step of the connector must run the way the line runs there.
  const arrival = arrivalBearing(geometry, target.coordinate);
  const lineBearing = bearingOf(line[target.segmentIndex] as Coordinate, line[target.segmentIndex + 1] as Coordinate);
  if (arrival !== null && angleBetween(arrival, lineBearing) > REJOIN_MAX_ARRIVAL_DEGREES) return "joins-backwards";
  return null;
}

function arrivalBearing(geometry: readonly Coordinate[], end: Coordinate): number | null {
  for (let index = geometry.length - 2; index >= 0; index -= 1) {
    const point = geometry[index] as Coordinate;
    if (haversine(point, end) >= 5) return bearingOf(point, end);
  }
  return null;
}

export interface RejoinChoiceContext {
  /** Seconds the planned line takes between two points along it. */
  readonly plannedSeconds: (fromMeters: number, toMeters: number) => number;
  /** Good metres (bends or dirt) on the planned line between two points along it. */
  readonly goodMeters: (fromMeters: number, toMeters: number) => number;
}

/**
 * The earliest usable rejoin, unless a later one saves more time than the good
 * miles it skips are worth. Unusable connectors (U-turn, joining against the
 * line, missing the line) are never chosen. Null when none is usable.
 */
export function chooseRejoin(
  options: readonly RejoinOption[],
  line: readonly Coordinate[],
  context: RejoinChoiceContext,
): RejoinOption | null {
  const usable = options
    .filter((option) => connectorProblem(option.connector, line, option.target) === null)
    .sort((a, b) => a.target.alongMeters - b.target.alongMeters);
  const earliest = usable[0];
  if (earliest === undefined) return null;
  const furthest = (usable.at(-1) as RejoinOption).target.alongMeters;
  const value = (option: RejoinOption): number => {
    const seconds = option.connector.durationSeconds + context.plannedSeconds(option.target.alongMeters, furthest);
    const skippedKm = context.goodMeters(earliest.target.alongMeters, option.target.alongMeters) / 1000;
    return -(seconds / 60) * GOOD_KM_PER_MINUTE - skippedKm;
  };
  let best = earliest;
  let bestValue = value(earliest);
  for (const option of usable.slice(1)) {
    const next = value(option);
    if (next > bestValue + 1e-9) {
      best = option;
      bestValue = next;
    }
  }
  return best;
}

// ---------------------------------------------------------------------------
// 3. Splice

export interface PlannedRoute {
  readonly geometry: readonly Coordinate[];
  readonly instructions: readonly RouteInstruction[];
  readonly distanceMeters: number;
  readonly durationSeconds: number;
  readonly speedLimits?: readonly SpeedLimitSpan[];
  readonly surfaceRuns?: readonly SurfaceRunSpan[];
}

export interface SplicedRoute {
  readonly geometry: readonly Coordinate[];
  readonly instructions: readonly RouteInstruction[];
  readonly distanceMeters: number;
  readonly durationSeconds: number;
  readonly speedLimits?: readonly SpeedLimitSpan[];
  readonly surfaceRuns?: readonly SurfaceRunSpan[];
  /** Index in `geometry` of the rejoin point; from here on it is the planned line. */
  readonly joinIndex: number;
  /** Metres of new road before the rejoin point (the connector). */
  readonly connectorMeters: number;
}

function isFinishInstruction(instruction: RouteInstruction): boolean {
  return instruction.type === "finish" || instruction.type === "arrive";
}

/**
 * The connector, then the planned line from the rejoin point, exactly.
 *
 * The connector's last instruction (the road it joins the line on) runs on to
 * the planned line's next instruction; every later planned instruction is kept
 * as it was, re-indexed. Null when that cannot be done exactly: an instruction
 * without a geometry index, a join on a planned turn, or a connector that
 * arrives on a differently named road.
 */
export function splice(connector: ConnectorRoute, planned: PlannedRoute, target: LinePoint): SplicedRoute | null {
  const line = planned.geometry;
  const k = target.segmentIndex;
  if (line.length < 2 || k < 0 || k >= line.length - 1) return null;
  if (connector.geometry.length < 2) return null;
  const connectorInstructions = connector.instructions ?? [];
  if (connectorInstructions.length === 0 || planned.instructions.length === 0) return null;
  if ([...connectorInstructions, ...planned.instructions].some((instruction) => instruction.geometryIndex === undefined)) return null;

  // Geometry: the connector up to (not including) its own end point, then the
  // exact rejoin point, then the planned vertices after it.
  const atVertex = target.fraction >= 1 - 1e-12;
  const head = connector.geometry.slice(0, -1);
  const joinIndex = head.length;
  const tailFrom = k + 1; // first planned vertex index kept after the join point
  const geometry: Coordinate[] = [...head];
  if (atVertex) {
    geometry.push(...line.slice(tailFrom));
  } else {
    geometry.push(target.coordinate, ...line.slice(tailFrom));
  }
  /** Spliced index of planned vertex `tailFrom`. */
  const tailOffset = (atVertex ? joinIndex : joinIndex + 1) - tailFrom;

  // Instructions.
  const plannedSorted = planned.instructions;
  const coverIndex = plannedSorted.reduce(
    (found, instruction, index) => ((instruction.geometryIndex as number) <= k ? index : found),
    -1,
  );
  if (coverIndex < 0) return null;
  const cover = plannedSorted[coverIndex] as RouteInstruction;
  if (isFinishInstruction(cover)) return null;
  // A planned instruction exactly at the join point is a maneuver there: not exact.
  if (atVertex && plannedSorted.some((instruction) => instruction.geometryIndex === tailFrom && !isFinishInstruction(instruction))) {
    return null;
  }
  const next = plannedSorted[coverIndex + 1];
  const coverEndIndex = next === undefined ? line.length - 1 : (next.geometryIndex as number);
  const chain = chainage(line);
  const coverLength = (chain[coverEndIndex] as number) - (chain[cover.geometryIndex as number] as number);
  const remainingLength = (chain[coverEndIndex] as number) - target.alongMeters;
  if (!(coverLength > 0) || remainingLength < 0) return null;
  const share = Math.min(1, remainingLength / coverLength);
  const remainingDistance = cover.distanceMeters * share;
  const remainingDuration = cover.durationSeconds * share;

  const kept = connectorInstructions.filter((instruction) => !isFinishInstruction(instruction));
  const joining = kept.at(-1);
  if (joining === undefined) return null;
  if (joining.roadName !== undefined && cover.roadName !== undefined &&
    joining.roadName.trim().toLowerCase() !== cover.roadName.trim().toLowerCase()) {
    return null;
  }
  const instructions: RouteInstruction[] = [
    ...kept.slice(0, -1),
    {
      ...joining,
      distanceMeters: joining.distanceMeters + remainingDistance,
      durationSeconds: joining.durationSeconds + remainingDuration,
    },
    ...plannedSorted.slice(coverIndex + 1).map((instruction) => ({
      ...instruction,
      geometryIndex: (instruction.geometryIndex as number) + tailOffset,
    })),
  ];
  for (let index = 1; index < instructions.length; index += 1) {
    if ((instructions[index]!.geometryIndex as number) < (instructions[index - 1]!.geometryIndex as number)) return null;
  }

  const tailDistance = remainingDistance + plannedSorted.slice(coverIndex + 1).reduce((sum, instruction) => sum + instruction.distanceMeters, 0);
  const tailDuration = remainingDuration + plannedSorted.slice(coverIndex + 1).reduce((sum, instruction) => sum + instruction.durationSeconds, 0);
  const connectorDistance = kept.reduce((sum, instruction) => sum + instruction.distanceMeters, 0);
  const connectorDuration = kept.reduce((sum, instruction) => sum + instruction.durationSeconds, 0);

  // Speed limits: the connector's up to the join, the planned ones from it.
  let speedLimits: SpeedLimitSpan[] | undefined;
  if (connector.speedLimits !== undefined || planned.speedLimits !== undefined) {
    speedLimits = [];
    for (const span of connector.speedLimits ?? []) {
      const to = Math.min(span.toIndex, joinIndex);
      if (to > span.fromIndex) speedLimits.push({ ...span, toIndex: to });
    }
    for (const span of planned.speedLimits ?? []) {
      if (atVertex) {
        if (span.toIndex <= tailFrom) continue;
        speedLimits.push({ ...span, fromIndex: Math.max(span.fromIndex, tailFrom) + tailOffset, toIndex: span.toIndex + tailOffset });
      } else {
        if (span.toIndex <= k) continue;
        speedLimits.push({ ...span, fromIndex: span.fromIndex <= k ? joinIndex : span.fromIndex + tailOffset, toIndex: span.toIndex + tailOffset });
      }
    }
  }

  // Surface runs, in metres along the spliced line.
  const splicedChain = chainage(geometry);
  const joinMeters = splicedChain[joinIndex] as number;
  let surfaceRuns: SurfaceRunSpan[] | undefined;
  if (planned.surfaceRuns !== undefined) {
    surfaceRuns = [];
    for (const run of connector.surfaceRuns ?? []) {
      const to = Math.min(run.to, joinMeters);
      if (to > run.from) surfaceRuns.push({ ...run, to });
    }
    const shift = joinMeters - target.alongMeters;
    for (const run of planned.surfaceRuns) {
      if (run.to <= target.alongMeters) continue;
      surfaceRuns.push({ ...run, from: Math.max(run.from, target.alongMeters) + shift, to: run.to + shift });
    }
  }

  return {
    geometry,
    instructions,
    distanceMeters: connectorDistance + tailDistance,
    durationSeconds: connectorDuration + tailDuration,
    ...(speedLimits === undefined ? {} : { speedLimits }),
    ...(surfaceRuns === undefined ? {} : { surfaceRuns }),
    joinIndex,
    connectorMeters: connectorDistance,
  };
}

// ---------------------------------------------------------------------------
// Measures the caller hands to `chooseRejoin`

/** Seconds along the planned line between two points, from its own instructions. */
export function plannedSecondsBetween(planned: PlannedRoute): (fromMeters: number, toMeters: number) => number {
  const chain = chainage(planned.geometry);
  const total = chain.at(-1) ?? 0;
  const indexed = planned.instructions.filter((instruction) => instruction.geometryIndex !== undefined);
  // Seconds at each instruction start; linear by distance inside an instruction.
  const marks: { at: number; seconds: number; rate: number }[] = [];
  let seconds = 0;
  indexed.forEach((instruction, index) => {
    const at = chain[instruction.geometryIndex as number] ?? total;
    const end = chain[(indexed[index + 1]?.geometryIndex as number | undefined) ?? planned.geometry.length - 1] ?? total;
    const length = end - at;
    marks.push({ at, seconds, rate: length > 0 ? instruction.durationSeconds / length : 0 });
    seconds += instruction.durationSeconds;
  });
  const fallbackRate = total > 0 ? planned.durationSeconds / total : 0;
  const at = (meters: number): number => {
    if (marks.length === 0) return meters * fallbackRate;
    let mark = marks[0] as { at: number; seconds: number; rate: number };
    for (const candidate of marks) if (candidate.at <= meters) mark = candidate;
    return mark.seconds + Math.max(0, meters - mark.at) * mark.rate;
  };
  return (fromMeters, toMeters) => Math.max(0, at(toMeters) - at(fromMeters));
}

/** Dirt and gravel metres on the planned line between two points, from its surface runs. */
export function dirtMetersBetween(runs: readonly SurfaceRunSpan[]): (fromMeters: number, toMeters: number) => number {
  return (fromMeters, toMeters) => runs.reduce((sum, run) => {
    if (run.kind !== "dirt" && run.kind !== "gravel") return sum;
    return sum + Math.max(0, Math.min(run.to, toMeters) - Math.max(run.from, fromMeters));
  }, 0);
}

/**
 * Bend metres (road-bends-v1) on the planned line between two points, measured
 * from the line's shape alone. A ride in progress no longer holds the engine's
 * road classes, so every stretch is read as a road that can earn; planned
 * turns are suppressed so a junction corner is never counted as a bend.
 */
export function bendMetersBetween(planned: PlannedRoute): (fromMeters: number, toMeters: number) => number {
  const chain = chainage(planned.geometry);
  return (fromMeters, toMeters) => {
    if (!(toMeters - fromMeters > 30)) return 0;
    const start = pointAlong(planned.geometry, chain, fromMeters);
    const end = pointAlong(planned.geometry, chain, toMeters);
    // The stretch as its own line: the start point, the whole vertices inside, the end point.
    const slice: Coordinate[] = [];
    const sliceIndexOf = new Map<number, number>();
    const add = (point: Coordinate, vertex?: number): void => {
      const last = slice.at(-1);
      if (last === undefined || haversine(last, point) > 0.01) slice.push(point);
      if (vertex !== undefined) sliceIndexOf.set(vertex, slice.length - 1);
    };
    add(start.coordinate);
    for (let index = start.segmentIndex + 1; index <= end.segmentIndex; index += 1) add(planned.geometry[index] as Coordinate, index);
    add(end.coordinate);
    if (slice.length < 3) return 0;
    const meters = chainage(slice).at(-1) ?? 0;
    const junctions = planned.instructions.flatMap((instruction) => {
      const index = instruction.geometryIndex === undefined ? undefined : sliceIndexOf.get(instruction.geometryIndex);
      if (index === undefined) return [];
      return instruction.maneuver !== undefined && instruction.maneuver !== "straight" ? [index] : [];
    });
    const measured = measureRoadBends(slice, [{ meters, roadClass: "tertiary", urbanDensity: "rural" }], junctions);
    return measured?.bendMeters ?? 0;
  };
}
