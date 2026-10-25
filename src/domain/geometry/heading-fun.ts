import { haversine } from "./analysis";
import { analyzeFrancoCurvature } from "./franco-curvature";
import type { Coordinate } from "@/domain/ride/types";

export const GEOMETRY_FUN_VERSION = "heading-fun-v1";

export interface FunRoadRun {
  readonly meters: number;
  readonly roadClass: string;
  readonly urbanDensity: string;
  readonly roadClassLink?: boolean | null;
  readonly roundabout?: boolean | null;
}
export interface GeometryFun {
  readonly funScore: number;
  readonly headingDegreesPerKm: number;
  readonly bendMeters: number;
  readonly francoPerKm: number;
  readonly busyShare: number;
  readonly residentialShare: number;
  readonly dullMeters: number;
}
const EXCLUDED = new Set(["residential", "service", "living_street", "missing", "other"]);
const BUSY = new Set(["motorway", "trunk", "primary"]);
const residential = (run: FunRoadRun): boolean => ["residential", "service", "living_street"].includes(run.roadClass.toLowerCase()) || ["residential", "city"].includes(run.urbanDensity.toLowerCase());
const earns = (run: FunRoadRun): boolean => !EXCLUDED.has(run.roadClass.toLowerCase()) && !run.roadClass.toLowerCase().endsWith("_link") && !residential(run) && !run.roadClassLink && !run.roundabout;

/**
 * heading-fun-v1: private 20 m resampling, centred 1 km heading windows,
 * 200 m signed/absolute coherence guard, 30 m junction suppression. Road runs
 * are travelled chainage, not provider distance/ETA (which remain untouched).
 * Scores are equivalent bend kilometres, never evidence of access or safety.
 */
export function analyzeGeometryFun(line: readonly Coordinate[], runs: readonly FunRoadRun[], junctionIndices: readonly number[] = []): GeometryFun | null {
  if (line.length < 2 || runs.length === 0 || line.some(p => !Number.isFinite(p.lat) || !Number.isFinite(p.lon))) return null;
  const positions = [0];
  for (let i = 1; i < line.length; i++) positions.push(positions[i - 1]! + haversine(line[i - 1]!, line[i]!));
  const total = positions.at(-1)!;
  const roadTotal = runs.reduce((sum, run) => sum + run.meters, 0);
  if (!(total > 0) || runs.some(run => !Number.isFinite(run.meters) || run.meters < 0) || Math.abs(total - roadTotal) > Math.max(2, total * 0.01)) return null;
  // Small provider simplification drift is spread proportionally; incomplete
  // road summaries fail closed rather than assigning classes to the wrong km.
  const ends: number[] = [];
  let end = 0;
  for (const run of runs) { end += run.meters * total / roadTotal; ends.push(end); }
  const count = Math.max(1, Math.ceil(total / 20));
  const step = total / count;
  const points: Coordinate[] = [];
  const classes: number[] = [];
  let vertex = 0, road = 0;
  for (let i = 0; i <= count; i++) {
    const pos = i * step;
    while (vertex < line.length - 2 && positions[vertex + 1]! < pos) vertex++;
    while (road < runs.length - 1 && ends[road]! < pos) road++;
    const span = positions[vertex + 1]! - positions[vertex]!;
    const f = span > 0 ? (pos - positions[vertex]!) / span : 0;
    points.push({ lat: line[vertex]!.lat + (line[vertex + 1]!.lat - line[vertex]!.lat) * f, lon: line[vertex]!.lon + (line[vertex + 1]!.lon - line[vertex]!.lon) * f });
    classes.push(road);
  }
  const cos = Math.cos(line.reduce((sum, p) => sum + p.lat, 0) / line.length * Math.PI / 180);
  const headings = points.slice(1).map((p, i) => Math.atan2((p.lon - points[i]!.lon) * cos, p.lat - points[i]!.lat));
  const controls = junctionIndices.flatMap(i => positions[i] === undefined ? [] : [{ pos: positions[i]!, point: line[i]! }]);
  const buckets = new Map<string, Coordinate[]>();
  const cell = (p: Coordinate): [number, number] => [Math.floor(p.lon * cos * 111195 / 60), Math.floor(p.lat * 111195 / 60)];
  for (const control of controls) { const key = cell(control.point).join(":"); buckets.set(key, [...(buckets.get(key) ?? []), control.point]); }
  controls.sort((a, b) => a.pos - b.pos);
  let controlIndex = 0;
  const suppressed = points.map((p, i) => {
    const pos = i * step;
    while (controlIndex < controls.length - 1 && controls[controlIndex + 1]!.pos < pos) controlIndex++;
    if ([controls[controlIndex], controls[controlIndex + 1]].some(c => c !== undefined && Math.abs(c.pos - pos) <= 30)) return true;
    const [x, y] = cell(p);
    for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) {
      if (buckets.get(`${x + dx}:${y + dy}`)?.some(c => haversine(c, p) <= 30)) return true;
    }
    return false;
  });
  const eligibleTurn = (i: number): boolean => {
    const at = classes[i]!;
    const pos = i * step;
    return earns(runs[at]!) &&
      !(at < runs.length - 1 && Math.abs(ends[at]! - pos) < 1e-6 && !earns(runs[at + 1]!)) &&
      !(at > 0 && Math.abs(ends[at - 1]! - pos) < 1e-6 && !earns(runs[at - 1]!));
  };
  const signed = points.map((_, i) => i === 0 || i === count || suppressed[i] || !eligibleTurn(i) ? 0 :
    Math.sign(((headings[i]! - headings[i - 1]! + Math.PI * 3) % (Math.PI * 2)) - Math.PI) * Math.min(30, Math.abs(((headings[i]! - headings[i - 1]! + Math.PI * 3) % (Math.PI * 2)) - Math.PI) * 180 / Math.PI));
  const absPrefix = [0], signedPrefix = [0];
  for (const turn of signed) { absPrefix.push(absPrefix.at(-1)! + Math.abs(turn)); signedPrefix.push(signedPrefix.at(-1)! + turn); }
  const reach = Math.floor(100 / step + 1e-9);
  const coherent = signed.map((_, i) => {
    const lo = Math.max(0, i - reach), hi = Math.min(signed.length, i + reach + 1);
    const absolute = absPrefix[hi]! - absPrefix[lo]!;
    return absolute > 0 && Math.abs(signedPrefix[hi]! - signedPrefix[lo]!) / absolute >= 0.5;
  });
  // Piecewise-constant turn density on centred sample cells; exact clipping
  // prevents residential or junction turns from spilling into nearby roads.
  const cells = [0, ...points.slice(1).map((_, i) => (i + 0.5) * step), total];
  const area = [0];
  for (let i = 0; i <= count; i++) area.push(area.at(-1)! + (coherent[i] ? Math.abs(signed[i]!) : 0));
  const areaAt = (pos: number): number => {
    const i = Math.min(count, Math.max(0, Math.floor(pos / step + 0.5)));
    const width = cells[i + 1]! - cells[i]!;
    return area[i]! + (width > 0 ? (pos - cells[i]!) / width * (area[i + 1]! - area[i]!) : 0);
  };
  const rates = points.map((_, i) => {
    const lo = Math.max(0, i * step - 500), hi = Math.min(total, i * step + 500);
    return 1000 * (areaAt(hi) - areaAt(lo)) / (hi - lo);
  });
  let headingArea = 0, headingCredit = 0, bends = 0, dull = 0, busy = 0, streets = 0, francoCredit = 0, eligibleMeters = 0;
  // Franco still uses original geometry and its existing radius/noise filters;
  // only overlap with coherent, eligible sample cells earns its tight credit.
  const franco = analyzeFrancoCurvature(line, { suppressedVertexIndices: junctionIndices });
  let sectionIndex = 0;
  road = 0;
  for (let i = 0; i <= count; i++) {
    const left = cells[i]!, right = cells[i + 1]!;
    while (road < runs.length - 1 && ends[road]! <= left) road++;
    let cursor = left, at = road;
    while (cursor < right && at < runs.length) {
      const stop = Math.min(right, ends[at]!);
      const meters = Math.max(0, stop - cursor);
      const run = runs[at]!;
      if (BUSY.has(run.roadClass.toLowerCase()) || run.urbanDensity.toLowerCase() === "city") busy += meters;
      if (residential(run)) streets += meters;
      if (earns(run)) eligibleMeters += meters;
      if (earns(run) && !suppressed[i]) {
        const rate = rates[i]!;
        headingArea += rate * meters;
        headingCredit += Math.min(1, rate / 90) * meters;
        if (rate >= 25) bends += meters;
        if (rate < 15) dull += meters;
        if (coherent[i]) {
          while (sectionIndex < franco.sections.length && positions[franco.sections[sectionIndex]!.endIndex]! <= cursor) sectionIndex++;
          for (let s = sectionIndex; s < franco.sections.length; s++) {
            const section = franco.sections[s]!;
            const start = positions[section.startIndex]!, end = positions[section.endIndex]!;
            if (start >= stop) break;
            francoCredit += Math.max(0, Math.min(stop, end) - Math.max(cursor, start)) * section.curvaturePerKm / 1000;
          }
        }
      }
      cursor = stop;
      at++;
    }
  }
  return {
    funScore: (headingCredit + 0.35 * francoCredit - 0.35 * busy - 0.3 * streets - 0.08 * dull) / 1000,
    headingDegreesPerKm: eligibleMeters > 0 ? headingArea / eligibleMeters : 0,
    bendMeters: bends,
    francoPerKm: eligibleMeters > 0 ? francoCredit / eligibleMeters * 1000 : 0,
    busyShare: busy / total,
    residentialShare: streets / total,
    dullMeters: dull,
  };
}
