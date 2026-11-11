/**
 * The surface coming up on the ride line
 * (08-RIDE-NAVIGATION-AND-FREE-RIDE §2, §6; CLAUDE.md: unknown never becomes
 * paved).
 *
 * The planner already knows where the gravel is: the engine writes ordered
 * surface runs along the answer (`src/application/roads/engine-road-evidence.ts`).
 * This module turns them into the one fact a rider needs at speed — the next
 * change of surface and how far away it is — and nothing else:
 *
 * - **Unknown is carried, never guessed.** A run the engine did not measure
 *   comes back as `unknown`; it is never folded into `paved`.
 * - **No measurements means no line.** An empty run list, or a route with a
 *   single surface, has no *change* to announce, and the surface shows nothing
 *   rather than "paved ahead".
 * - **Short runs fold into their neighbour.** A 30 m sliver between two paved
 *   stretches would make the line flicker at speed. Runs under
 *   {@link MIN_SURFACE_RUN_METERS} join the run before them (or the one after,
 *   when they open the route), the same rule the planner's own run merger uses.
 * - **A passed change is never reported.** The answer is always ahead of the
 *   rider: a distance here cannot be negative, and once the last change is
 *   behind them there is no line at all.
 *
 * Pure: no clock, no storage, no browser. The caller supplies the rider's
 * distance along the route in metres.
 */

/** One of the four classes the engine measures. `unknown` is a real answer. */
export type SurfaceKind = "paved" | "gravel" | "dirt" | "unknown";

/** One stretch of a known surface, in metres from the start of the route. */
export interface SurfaceRunSpan {
  /** Start of the run, inclusive, in metres along the route. */
  readonly from: number;
  /** End of the run, exclusive, in metres along the route. */
  readonly to: number;
  readonly kind: SurfaceKind;
}

/** The next change of surface and the stretch it starts. */
export interface SurfaceAhead {
  readonly kind: SurfaceKind;
  /** Metres until the change; never negative. */
  readonly inMeters: number;
  /** How long the new surface lasts; at least {@link MIN_SURFACE_RUN_METERS}. */
  readonly forMeters: number;
}

/**
 * Runs shorter than this fold into their neighbour: a rider at 50 mph covers
 * 150 m in under seven seconds, so anything shorter is a flicker, not a fact.
 */
export const MIN_SURFACE_RUN_METERS = 150;

/** A run list longer than this is not a route answer; the engine caps at 120. */
export const MAX_SURFACE_RUNS = 512;

const SURFACE_KINDS: readonly SurfaceKind[] = ["paved", "gravel", "dirt", "unknown"];

/**
 * Structural validation for the persisted Ride Focus pointer. A run must start
 * at or after the route start and end after it starts; a surface the engine
 * does not define is rejected rather than carried as an invented class.
 */
export function isSurfaceRunSpan(value: unknown): value is SurfaceRunSpan {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const run = value as Record<string, unknown>;
  return (
    typeof run["from"] === "number" &&
    Number.isFinite(run["from"]) &&
    run["from"] >= 0 &&
    typeof run["to"] === "number" &&
    Number.isFinite(run["to"]) &&
    run["to"] > run["from"] &&
    typeof run["kind"] === "string" &&
    (SURFACE_KINDS as readonly string[]).includes(run["kind"])
  );
}

export function isSurfaceRunSpans(value: unknown): value is readonly SurfaceRunSpan[] {
  return (
    Array.isArray(value) &&
    value.length > 0 &&
    value.length <= MAX_SURFACE_RUNS &&
    value.every(isSurfaceRunSpan)
  );
}

/**
 * The runs in travel order with short slivers folded away and touching runs of
 * one surface joined. The order is the provider's; a run list that arrives out
 * of order is sorted rather than trusted, so a distance can never be measured
 * against a backwards line.
 */
export function mergeSurfaceRuns(runs: readonly SurfaceRunSpan[]): readonly SurfaceRunSpan[] {
  const valid = runs
    .filter(isSurfaceRunSpan)
    .slice()
    .sort((left, right) => left.from - right.from);
  const merged: { from: number; to: number; kind: SurfaceKind }[] = [];
  /** Where a short opening run starts, so the run after it grows backwards. */
  let heldStart: number | null = null;
  let walkedTo = 0;
  for (const run of valid) {
    // Overlapping answers are trimmed to the part not already covered.
    const from: number = heldStart ?? Math.max(run.from, walkedTo);
    const to = run.to;
    if (!(to > from)) continue;
    const last = merged[merged.length - 1];
    const short = to - from < MIN_SURFACE_RUN_METERS;
    if (last !== undefined && (last.kind === run.kind || short)) {
      last.to = to;
    } else if (last === undefined && short) {
      heldStart = from;
    } else {
      merged.push({ from, to, kind: run.kind });
      heldStart = null;
    }
    walkedTo = to;
  }
  return merged;
}

/** Total measured length of the runs, in metres; `0` when there are none. */
export function surfaceRunLengthMeters(runs: readonly SurfaceRunSpan[]): number {
  const merged = mergeSurfaceRuns(runs);
  const last = merged[merged.length - 1];
  return last === undefined ? 0 : last.to;
}

/**
 * The next surface change at or after `distanceAlongMeters`, or `null` when
 * there is nothing to announce (no runs, one surface, or the rider is past the
 * last change).
 *
 * `distanceAlongMeters` is the rider's own place on the line. The run the rider
 * is standing in does not count as "ahead": the answer is the run after it, so
 * a change the rider has just crossed is never printed as "in 0 m".
 */
export function surfaceAhead(
  runs: readonly SurfaceRunSpan[] | null | undefined,
  distanceAlongMeters: number,
): SurfaceAhead | null {
  if (!Number.isFinite(distanceAlongMeters)) return null;
  const merged = mergeSurfaceRuns(runs ?? []);
  if (merged.length < 2) return null;
  const at = Math.max(0, distanceAlongMeters);
  const change = (run: SurfaceRunSpan, from: number): SurfaceAhead => ({
    kind: run.kind,
    inMeters: Math.max(0, run.from - from),
    forMeters: run.to - run.from,
  });
  for (let index = 0; index < merged.length; index += 1) {
    const run = merged[index]!;
    if (at >= run.from && at < run.to) {
      const next = merged[index + 1];
      return next === undefined ? null : change(next, at);
    }
  }
  // A gap in the runs (or before the first run): the next run start is the
  // change. Past the last run there is nothing left to announce.
  const upcoming = merged.find((run) => run.from > at);
  return upcoming === undefined ? null : change(upcoming, at);
}
