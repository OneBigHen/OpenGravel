/**
 * Routing a long sketch in chunks (06 §18, OGV-D-285).
 *
 * A sketch reaches the engine as shape-aware anchors plus the drawn corridor.
 * A 300-mile drawing carries a few hundred anchors, more than one request
 * should hold (the hosted free plan takes five points), so this module:
 *
 * 1. splits the wire points into chunks that share their join points;
 * 2. routes the chunks concurrently, each held to its own stretch of the band;
 * 3. reviews every leg of every chunk against the drawing — an anchor that
 *    snapped onto a dead end (an out-and-back spur) is dropped, and a leg that
 *    left the drawing gets an anchor where it strayed farthest;
 * 4. re-routes each repaired chunk **once**, keeping the first answer if the
 *    repair fails; and
 * 5. stitches the chunk answers into one engine path, re-basing every index
 *    (instructions, details) onto the joined line.
 *
 * What still strays after the one repair is left as it is: the pipeline measures
 * it against the corridor and tells the rider (`sketchStraySections`). Nothing
 * here invents geometry; every point is the engine's.
 */

import type { ProviderRouteRequest } from "@/application/planner/route-provider";
import type { Coordinate } from "@/domain/ride/types";
import {
  chunkSketchWaypoints,
  isSpurAt,
  locateInOrder,
  reviewSketchLeg,
  sketchStraySections,
  sliceLineByAlong,
  stitchSketchLines,
} from "@/domain/sketch/snap";
import type { GraphHopperWirePoint } from "./request-builder";
import type {
  GraphHopperDetailInterval,
  GraphHopperInstruction,
  GraphHopperPath,
} from "./response-parser";

/** Points per request on our own engine: one origin, one finish, 22 vias. */
export const SELF_HOSTED_SKETCH_CHUNK_POINTS = 24;

/** The hosted free plan accepts at most five points per request. */
export const HOSTED_SKETCH_CHUNK_POINTS = 5;

/**
 * The most sketch anchors a hosted request list keeps. The free plan has no
 * custom model, so there is no band to hold the route between anchors, and
 * without it dense anchors measured worse (spurs), not better; every chunk
 * also costs a credit of a 500-a-day budget. Twelve anchors is three chunks.
 */
export const HOSTED_MAX_SKETCH_ANCHORS = 12;

/**
 * Thins the sketch anchors in a wire list to at most `max`, evenly by position,
 * keeping every non-sketch point (origin, stops, shaping, destination).
 */
export function thinSketchAnchors(
  points: readonly GraphHopperWirePoint[],
  max: number,
): GraphHopperWirePoint[] {
  const sketchIndices = points.flatMap((point, index) => (point.label === SKETCH_LABEL ? [index] : []));
  if (sketchIndices.length <= max) return points.slice();
  const keep = new Set<number>();
  for (let pick = 0; pick < max; pick += 1) {
    keep.add(sketchIndices[Math.round(((pick + 0.5) * sketchIndices.length) / max - 0.5)] as number);
  }
  return points.filter((point, index) => point.label !== SKETCH_LABEL || keep.has(index));
}

/** Chunk requests in flight at once, per lane. */
export const SKETCH_CHUNK_CONCURRENCY = 4;

/** How much band a chunk carries beyond its own stretch of the drawing. */
const CHUNK_BAND_MARGIN_METERS = 1_500;

/**
 * How much one meter of the drawing left unfollowed costs against one meter of
 * extra riding, when choosing between a chunk's first answer and its repair.
 */
const STRAY_COST_FACTOR = 3;

/** The label the request builder gives a sketch anchor. */
const SKETCH_LABEL = "Sketch";

/** GraphHopper's turn sign for "waypoint reached" and for "arrive". */
const SIGN_VIA = 5;
const SIGN_FINISH = 4;

/** One routed chunk, as the provider's own attempt logic answers it. */
export interface SketchChunkAnswer {
  readonly path: GraphHopperPath;
  readonly engineVersion: string;
  readonly degraded: boolean;
}

/** Routes one chunk: exactly these points, held to this stretch of the band. */
export type SketchChunkRouter = (
  points: readonly GraphHopperWirePoint[],
  band: readonly Coordinate[],
) => Promise<SketchChunkAnswer>;

/** What {@link routeSketch} did, for provider diagnostics. */
export interface SketchRoutingReport {
  readonly chunks: number;
  readonly spursDropped: number;
  readonly anchorsAdded: number;
}

export interface SketchRoutingResult extends SketchChunkAnswer {
  readonly report: SketchRoutingReport;
}

interface PlacedPoint {
  readonly point: GraphHopperWirePoint;
  /** Along-corridor meters, or `null` when there is no corridor. */
  readonly along: number | null;
}

function coordinates(path: GraphHopperPath): Coordinate[] {
  return (path.points?.coordinates ?? []).map(([lon, lat]) => ({ lon, lat }));
}

/** Runs `tasks` with at most `limit` in flight, keeping order. */
async function inPool<T>(tasks: readonly (() => Promise<T>)[], limit: number): Promise<T[]> {
  const results: T[] = new Array(tasks.length);
  let next = 0;
  const worker = async (): Promise<void> => {
    while (next < tasks.length) {
      const index = next;
      next += 1;
      results[index] = await (tasks[index] as () => Promise<T>)();
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, tasks.length) }, worker));
  return results;
}

/**
 * The route index each chunk point snapped to, found by walking the line
 * forward so a crossing or a loop never matches an earlier pass.
 */
function snappedIndices(path: GraphHopperPath, line: readonly Coordinate[]): number[] | null {
  const snapped = path.snapped_waypoints?.coordinates;
  if (snapped === undefined) return null;
  const indices: number[] = [];
  let cursor = 0;
  for (const [lon, lat] of snapped) {
    let best = cursor;
    let bestDistance = Number.POSITIVE_INFINITY;
    for (let index = cursor; index < line.length; index += 1) {
      const point = line[index] as Coordinate;
      const distance = Math.abs(point.lon - lon) + Math.abs(point.lat - lat);
      if (distance < bestDistance) {
        bestDistance = distance;
        best = index;
        if (distance === 0) break;
      }
    }
    indices.push(best);
    cursor = best;
  }
  return indices;
}

/**
 * The repaired point list for one chunk, or `null` when every leg followed the
 * drawing. Joins (the chunk's first and last point) are never dropped, so the
 * neighbouring chunks still meet.
 */
function repairChunk(
  placed: readonly PlacedPoint[],
  path: GraphHopperPath,
  corridor: readonly Coordinate[],
): { readonly points: PlacedPoint[]; readonly dropped: number; readonly added: number } | null {
  const line = coordinates(path);
  const indices = snappedIndices(path, line);
  if (indices === null || indices.length !== placed.length) return null;
  const drop = new Set<number>();
  for (let index = 1; index < placed.length - 1; index += 1) {
    if (placed[index]?.point.label !== SKETCH_LABEL) continue;
    if (isSpurAt(line, indices[index] as number)) drop.add(index);
  }
  const inserts = new Map<number, PlacedPoint>();
  for (let index = 1; index < placed.length; index += 1) {
    const from = placed[index - 1] as PlacedPoint;
    const to = placed[index] as PlacedPoint;
    if (from.along === null || to.along === null || to.along <= from.along) continue;
    const leg = line.slice(indices[index - 1], (indices[index] as number) + 1);
    const verdict = reviewSketchLeg(leg, corridor, from.along, to.along);
    if (verdict.kind === "detour") {
      // Both ends are suspect; the joins stay so the chunks still meet.
      for (const end of [index - 1, index]) {
        if (end > 0 && end < placed.length - 1 && placed[end]?.point.label === SKETCH_LABEL) drop.add(end);
      }
      continue;
    }
    if (verdict.kind !== "stray") continue;
    inserts.set(index, {
      point: {
        lon: verdict.at.lon,
        lat: verdict.at.lat,
        label: SKETCH_LABEL,
        ...(verdict.heading === null ? {} : { heading: verdict.heading }),
      },
      along: verdict.alongMeters,
    });
  }
  if (drop.size === 0 && inserts.size === 0) return null;
  const points: PlacedPoint[] = [];
  placed.forEach((entry, index) => {
    const insert = inserts.get(index);
    if (insert !== undefined) points.push(insert);
    if (!drop.has(index)) points.push(entry);
  });
  return { points, dropped: drop.size, added: inserts.size };
}

/** Re-bases one detail's intervals by `offset` points. */
function shiftIntervals(
  intervals: readonly GraphHopperDetailInterval[],
  offset: number,
): GraphHopperDetailInterval[] {
  return intervals.map(([from, to, value]) => [from + offset, to + offset, value] as const);
}

/**
 * Joins chunk paths into one engine path. A chunk's "arrive" becomes a silent
 * via (no text), which guidance already omits, so the rider is never told they
 * have arrived at a join nobody chose.
 */
export function mergeSketchPaths(paths: readonly GraphHopperPath[]): GraphHopperPath {
  if (paths.length === 1) return paths[0] as GraphHopperPath;
  const lines = paths.map((path) => path.points?.coordinates ?? []);
  const stitched = stitchSketchLines(
    lines.map((line) => line.map(([lon, lat]) => ({ lon, lat }))),
  );
  const instructions: GraphHopperInstruction[] = [];
  const details: Record<string, GraphHopperDetailInterval[]> = {};
  const snapped: (readonly [number, number])[] = [];
  let distance = 0;
  let time = 0;
  let ascend: number | undefined;
  let descend: number | undefined;
  paths.forEach((path, chunk) => {
    const offset = stitched.offsets[chunk] ?? 0;
    const last = chunk === paths.length - 1;
    for (const instruction of path.instructions ?? []) {
      const shifted: GraphHopperInstruction = {
        ...instruction,
        ...(instruction.interval === undefined
          ? {}
          : { interval: [instruction.interval[0] + offset, instruction.interval[1] + offset] as const }),
      };
      instructions.push(
        !last && instruction.sign === SIGN_FINISH ? { ...shifted, sign: SIGN_VIA, text: "" } : shifted,
      );
    }
    for (const [name, intervals] of Object.entries(path.details ?? {})) {
      if (intervals === undefined) continue;
      (details[name] ??= []).push(...shiftIntervals(intervals, offset));
    }
    const waypoints = path.snapped_waypoints?.coordinates ?? [];
    snapped.push(...(chunk === 0 ? waypoints : waypoints.slice(1)));
    distance += path.distance ?? 0;
    time += path.time ?? 0;
    if (path.ascend !== undefined) ascend = (ascend ?? 0) + path.ascend;
    if (path.descend !== undefined) descend = (descend ?? 0) + path.descend;
  });
  return {
    distance,
    time,
    ...(ascend === undefined ? {} : { ascend }),
    ...(descend === undefined ? {} : { descend }),
    points: { coordinates: stitched.line.map(({ lon, lat }) => [lon, lat] as const) },
    snapped_waypoints: { coordinates: snapped },
    instructions,
    details,
  };
}

/**
 * Routes a sketch request: chunk, route, review, repair once, stitch.
 *
 * `wirePoints` is the request's full point list (`requestWirePoints`); the
 * caller supplies the router so this module never touches the network itself.
 * A chunk that fails fails the whole sketch — a stitched route with a hole in it
 * would be an unrouted straight connector, which 06 §18 forbids.
 */
export async function routeSketch(input: {
  readonly request: ProviderRouteRequest;
  readonly wirePoints: readonly GraphHopperWirePoint[];
  readonly maxPointsPerRequest: number;
  readonly routeChunk: SketchChunkRouter;
  readonly concurrency?: number;
  readonly signal?: AbortSignal;
}): Promise<SketchRoutingResult> {
  const corridor = input.request.sketch?.corridor ?? [];
  const located = corridor.length >= 2 ? locateInOrder(corridor, input.wirePoints) : null;
  const placed: PlacedPoint[] = input.wirePoints.map((point, index) => ({
    point,
    along: located?.[index]?.alongMeters ?? null,
  }));
  const chunks = chunkSketchWaypoints(placed, input.maxPointsPerRequest);
  const bandFor = (chunk: readonly PlacedPoint[]): Coordinate[] => {
    if (corridor.length < 2) return [];
    const alongs = chunk.flatMap((entry) => (entry.along === null ? [] : [entry.along]));
    if (alongs.length === 0) return [];
    return sliceLineByAlong(
      corridor,
      Math.min(...alongs) - CHUNK_BAND_MARGIN_METERS,
      Math.max(...alongs) + CHUNK_BAND_MARGIN_METERS,
    );
  };
  const attempt = (chunk: readonly PlacedPoint[]): Promise<SketchChunkAnswer> =>
    input.routeChunk(chunk.map((entry) => entry.point), bandFor(chunk));
  const unheaded = (chunk: readonly PlacedPoint[]): PlacedPoint[] =>
    chunk.map((entry) => ({
      ...entry,
      point: {
        lon: entry.point.lon,
        lat: entry.point.lat,
        ...(entry.point.label === undefined ? {} : { label: entry.point.label }),
      },
    }));
  /**
   * A drawing is the rider's hand, not a route: one anchor can sit on a road the
   * engine cannot join to its neighbour ("Connection between locations not
   * found"), and that used to fail the whole drawing. The chunk is retried
   * without its heading hints, then split at its middle so only the stretch that
   * truly cannot be joined is refused. Joins are kept, so halves still meet.
   */
  const cancelled = (): boolean => input.signal?.aborted === true;
  const route = async (chunk: readonly PlacedPoint[]): Promise<SketchChunkAnswer> => {
    try {
      return await attempt(chunk);
    } catch (caught) {
      if (cancelled()) throw caught;
      if (chunk.some((entry) => entry.point.heading !== undefined)) {
        try {
          return await attempt(unheaded(chunk));
        } catch (again) {
          if (cancelled()) throw again;
        }
      }
      if (chunk.length <= 2) throw caught;
      const middle = Math.floor(chunk.length / 2);
      const [left, right] = [chunk.slice(0, middle + 1), chunk.slice(middle)];
      try {
        const [a, b] = [await route(unheaded(left)), await route(unheaded(right))];
        return {
          path: mergeSketchPaths([a.path, b.path]),
          engineVersion: a.engineVersion,
          degraded: a.degraded || b.degraded,
        };
      } catch (stuck) {
        if (cancelled()) throw stuck;
        // A drawn anchor no road reaches is let go; the joins never are.
        if (chunk[middle]?.point.label !== SKETCH_LABEL) throw stuck;
        return route(unheaded(chunk.filter((_entry, index) => index !== middle)));
      }
    }
  };

  let spursDropped = 0;
  let anchorsAdded = 0;
  const answers = await inPool(
    chunks.map((chunk) => async (): Promise<SketchChunkAnswer> => {
      const first = await route(chunk);
      if (corridor.length < 2) return first;
      const repair = repairChunk(chunk, first.path, corridor);
      if (repair === null) return first;
      let second: SketchChunkAnswer;
      try {
        second = await route(repair.points);
      } catch (caught) {
        if (input.signal?.aborted === true) throw caught;
        // The repair is an improvement, never a requirement: the first answer
        // is a real route, and the pipeline still measures how it strays.
        return first;
      }
      // Keep the cheaper answer: its length plus a weighted price for every
      // meter of the drawing it leaves unfollowed. Length alone would prefer a
      // shortcut off the drawing; coverage alone would keep a 17-mile loop that
      // happens to stay on drawn roads (a dropped spur anchor does exactly that).
      const band = bandFor(chunk);
      const cost = (answer: SketchChunkAnswer): number =>
        (answer.path.distance ?? 0) +
        STRAY_COST_FACTOR *
          sketchStraySections(coordinates(answer.path), band, { minLengthMeters: 0 })
            .reduce((sum, section) => sum + section.lengthMeters, 0);
      const better = cost(second) < cost(first);
      if (!better) return first;
      spursDropped += repair.dropped;
      anchorsAdded += repair.added;
      return second;
    }),
    input.concurrency ?? SKETCH_CHUNK_CONCURRENCY,
  );
  return {
    path: mergeSketchPaths(answers.map((answer) => answer.path)),
    engineVersion: answers[0]?.engineVersion ?? "",
    degraded: answers.some((answer) => answer.degraded),
    report: { chunks: chunks.length, spursDropped, anchorsAdded },
  };
}
