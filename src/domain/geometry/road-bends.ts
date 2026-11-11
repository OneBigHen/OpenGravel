import { haversine } from "./analysis";
import type { Coordinate } from "@/domain/ride/types";

/**
 * road-bends-v1: how many metres of a route are a bend a rider would lean into.
 *
 * A bend is sustained curvature **along one road**, not a change of road:
 *  - radius-based, Kurviger style: an arc under 175 m radius is a bend, and the
 *    tighter it is the more it counts (< 30 m x2, < 60 m x1.6, < 100 m x1.3);
 *  - sustained: at least 30 m of arc that keeps turning the same way, so the
 *    single vertex where two roads meet (a town-grid corner, a ramp, a
 *    roundabout exit) and a jinking zig-zag are not bends;
 *  - on a road that earns: town streets, service roads, links and roundabouts
 *    earn nothing, and a motorway/trunk/primary earns only when the arc is
 *    genuinely tight (< 100 m radius), so a highway sweeper is worth zero.
 *
 * Junction vertices and road-class changes are suppressed, so the corner where
 * the rider turns onto the next road never becomes "good miles".
 */
export const ROAD_BENDS_VERSION = "road-bends-v1";
/** Resampling step: fine enough to see a 25 m hairpin, coarse enough to ignore digitising noise. */
export const BEND_SAMPLE_METERS = 10;
/** An arc under this radius is a bend. */
export const BEND_RADIUS_METERS = 175;
/** A busy road must be tighter than this before it earns anything. */
export const BEND_BUSY_RADIUS_METERS = 100;
/** A bend must last this long, which is what separates a road's bend from a junction corner. */
export const BEND_MIN_ARC_METERS = 30;
/** A bend turns one way. This much opposite turning ends it; less is road noise. */
export const BEND_FLIP_ARC_METERS = 20;
/** How far around a junction or a road-class change no bend is credited. */
export const BEND_JUNCTION_METERS = 20;

/** The road facts this measure needs. Structurally identical to heading-fun's FunRoadRun. */
export interface BendRoadRun {
  readonly meters: number;
  readonly roadClass: string;
  readonly urbanDensity: string;
  readonly roadClassLink?: boolean | null;
  readonly roundabout?: boolean | null;
}

export interface RoadBendAnalysis {
  readonly version: typeof ROAD_BENDS_VERSION;
  /** Weighted bend metres: the good miles this measure credits. */
  readonly bendMeters: number;
  /** The same bends without the tightness weight. */
  readonly tightMeters: number;
  readonly bendShare: number;
}

const EXCLUDED = new Set(["residential", "service", "living_street", "missing", "other"]);
const BUSY = new Set(["motorway", "trunk", "primary"]);
/** A town street or a city edge is not where a rider goes for fun. */
export const isResidentialRoad = (run: BendRoadRun): boolean =>
  ["residential", "service", "living_street"].includes(run.roadClass.toLowerCase()) ||
  ["residential", "city"].includes(run.urbanDensity.toLowerCase());
/** Road classes that only earn good miles when the arc is genuinely tight. */
export const isBusyRoad = (run: BendRoadRun): boolean => BUSY.has(run.roadClass.toLowerCase());
/** Does this road piece earn bend credit at all? Links, roundabouts, town streets and unknown do not. */
export const earnsRoadCredit = (run: BendRoadRun): boolean =>
  !EXCLUDED.has(run.roadClass.toLowerCase()) &&
  !run.roadClass.toLowerCase().endsWith("_link") &&
  !isResidentialRoad(run) &&
  !run.roadClassLink &&
  !run.roundabout;

/** Tightness weight: a real hairpin counts more than a 150 m sweeper. */
function radiusWeight(radius: number): number {
  if (radius < 30) return 2;
  if (radius < 60) return 1.6;
  if (radius < 100) return 1.3;
  if (radius < BEND_RADIUS_METERS) return 1;
  return 0;
}

/** Resample by travelled distance, keeping both ends. */
function resample(line: readonly Coordinate[], step: number): { points: Coordinate[]; chainage: number[]; total: number } {
  const points: Coordinate[] = [line[0]!];
  const chainage: number[] = [0];
  let covered = 0;
  for (let i = 1; i < line.length; i++) {
    const a = line[i - 1]!; const b = line[i]!;
    const length = haversine(a, b);
    for (let at = Math.ceil((covered + 1e-9) / step) * step; at < covered + length; at += step) {
      const t = (at - covered) / length;
      points.push({ lat: a.lat + (b.lat - a.lat) * t, lon: a.lon + (b.lon - a.lon) * t });
      chainage.push(at);
    }
    covered += length;
  }
  const last = line.at(-1)!;
  const tail = points.at(-1)!;
  const lastStep = haversine(tail, last);
  if (lastStep > 0.01) { points.push(last); chainage.push(covered); }
  else { points[points.length - 1] = last; chainage[chainage.length - 1] = covered; }
  return { points, chainage, total: chainage.at(-1)! };
}

const bearing = (a: Coordinate, b: Coordinate): number => {
  const rad = Math.PI / 180;
  const y = Math.sin((b.lon - a.lon) * rad) * Math.cos(b.lat * rad);
  const x = Math.cos(a.lat * rad) * Math.sin(b.lat * rad) - Math.sin(a.lat * rad) * Math.cos(b.lat * rad) * Math.cos((b.lon - a.lon) * rad);
  return Math.atan2(y, x);
};
const signedTurn = (from: number, to: number): number => ((to - from + Math.PI * 3) % (Math.PI * 2)) - Math.PI;

/** First index whose chainage is >= value. */
function lowerBound(chainage: readonly number[], value: number): number {
  let lo = 0; let hi = chainage.length;
  while (lo < hi) { const mid = (lo + hi) >> 1; if (chainage[mid]! < value) lo = mid + 1; else hi = mid; }
  return lo;
}

/** Measure sustained, coherent, tight bends on the roads that can earn good miles. */
export function measureRoadBends(
  line: readonly Coordinate[],
  runs: readonly BendRoadRun[],
  junctionIndices: readonly number[] = [],
): RoadBendAnalysis | null {
  if (line.length < 3 || runs.length === 0 || line.some(p => !Number.isFinite(p.lat) || !Number.isFinite(p.lon))) return null;
  if (runs.some(run => !Number.isFinite(run.meters) || run.meters < 0)) return null;
  const { points, chainage, total } = resample(line, BEND_SAMPLE_METERS);
  const roadTotal = runs.reduce((sum, run) => sum + run.meters, 0);
  if (!(total > 0) || !(roadTotal > 0) || Math.abs(total - roadTotal) > Math.max(2, total * 0.01)) return null;
  // Road runs are travelled chainage; spread provider simplification drift proportionally.
  const ends: number[] = [];
  let end = 0;
  for (const run of runs) { end += run.meters * total / roadTotal; ends.push(end); }

  // Original vertex indices are chainage positions; suppress the corner at each junction.
  const original: number[] = [0];
  for (let i = 1; i < line.length; i++) original.push(original[i - 1]! + haversine(line[i - 1]!, line[i]!));
  const junctions: number[] = junctionIndices.flatMap(i => original[i] === undefined ? [] : [original[i]!]);
  // A road-class or urban-density change is a place the line joins a different road.
  for (let i = 1; i < runs.length; i++) {
    const before = runs[i - 1]!; const after = runs[i]!;
    if (before.roadClass.toLowerCase() !== after.roadClass.toLowerCase() || before.urbanDensity.toLowerCase() !== after.urbanDensity.toLowerCase()) junctions.push(ends[i - 1]!);
  }
  const suppressed = new Array<boolean>(points.length).fill(false);
  for (const position of junctions) {
    const from = lowerBound(chainage, position - BEND_JUNCTION_METERS);
    const to = lowerBound(chainage, position + BEND_JUNCTION_METERS + 1e-9);
    for (let i = from; i < to; i++) suppressed[i] = true;
  }

  const n = points.length;
  const turns = new Array<number>(n).fill(0);
  for (let i = 2; i < n; i++) turns[i] = signedTurn(bearing(points[i - 2]!, points[i - 1]!), bearing(points[i - 1]!, points[i]!));
  // The direction of the bend, smoothed over BEND_FLIP_ARC_METERS so a jinking
  // sawtooth has no direction while a tight switchback keeps one.
  const reach = Math.max(1, Math.round(BEND_FLIP_ARC_METERS / BEND_SAMPLE_METERS));
  const direction = new Array<number>(n).fill(0);
  for (let i = 2; i < n; i++) {
    let sum = 0;
    for (let j = Math.max(2, i - reach); j <= Math.min(n - 1, i + reach); j++) sum += turns[j]!;
    direction[i] = Math.abs(sum) > 1e-12 ? Math.sign(sum) : 0;
  }
  const weight = new Array<number>(n).fill(0);
  let road = 0;
  for (let i = 2; i < n; i++) {
    if (suppressed[i] || direction[i] === 0) continue;
    const degrees = Math.abs(turns[i]!) * 180 / Math.PI;
    if (!(degrees > 0)) continue;
    const radius = BEND_SAMPLE_METERS / (degrees * Math.PI / 180);
    while (road < ends.length - 1 && ends[road]! < chainage[i]!) road++;
    const run = runs[road]!;
    if (!earnsRoadCredit(run)) continue;
    if (isBusyRoad(run) && !(radius < BEND_BUSY_RADIUS_METERS)) continue;
    weight[i] = radiusWeight(radius);
  }

  // Credit only stretches that keep turning the same way for BEND_MIN_ARC_METERS.
  let bendMeters = 0, tightMeters = 0, arc = 0, arcWeighted = 0, lobeDirection = 0;
  const flush = (): void => {
    if (arc >= BEND_MIN_ARC_METERS) { bendMeters += arcWeighted; tightMeters += arc; }
    arc = 0; arcWeighted = 0; lobeDirection = 0;
  };
  for (let i = 1; i < n; i++) {
    const meters = chainage[i]! - chainage[i - 1]!;
    if (!(weight[i]! > 0)) { flush(); continue; }
    if (lobeDirection !== 0 && direction[i] !== lobeDirection) flush();
    if (arc === 0) lobeDirection = direction[i]!;
    arc += meters;
    arcWeighted += meters * weight[i]!;
  }
  flush();
  return {
    version: ROAD_BENDS_VERSION,
    bendMeters: Math.min(total, bendMeters),
    tightMeters: Math.min(total, tightMeters),
    bendShare: Math.min(1, bendMeters / total),
  };
}
