import { haversine } from '../../src/domain/geometry/analysis';
import { matchRoadAnchors, MAX_MATCH_ANCHORS } from '../../src/server/road-matching/match-service';
import type { Coordinate } from '../../src/domain/ride/types';
import type { ProviderCandidate, ProviderInstruction, ProviderRoadRun, RouteCandidateProvider } from '../../src/application/planner/route-provider';
import type { Mode } from './types';

/**
 * The rider's own line, put onto our roads so the same measuring code can read it.
 *
 * Why snapped and not raw: the planner's bend measure needs the road class under every
 * metre (it ignores town streets, ramps and junction corners), and a raw GPS track has none.
 * So the track goes through `matchRoadAnchors` (src/server/road-matching/match-service.ts),
 * the app's own road matcher: a handful of the rider's own track points, in order, and the
 * router's line between them. Anchors are real track points (never interpolated across the
 * thinned stretches, where a straight line would leave the road), about every 1.5 km.
 * Where a stretch cannot be matched, a raw straight connector is kept and labelled
 * "missing", so it adds length but earns nothing. The rider line is measured, never used to plan.
 */
export const SNAP_SPACING_METERS = 1500;
/** Below this share of matched length the rider line is not measured at all. */
export const MIN_SNAP_COVERAGE = 0.8;

/** The router profile that stands in for the rider's bike class while snapping. */
export function snapProfileFor(mode: Mode): string {
  return mode === 'curvy' ? 'motorcycle_twisty' : 'motorcycle_adventure';
}

/** Real track points about `spacing` metres apart along the ride, always including both ends. */
export function pickAnchors(track: readonly Coordinate[], spacing = SNAP_SPACING_METERS): Coordinate[] {
  if (track.length < 2) return [...track];
  const anchors: Coordinate[] = [track[0]!];
  let since = 0;
  for (let i = 1; i < track.length; i++) {
    since += haversine(track[i - 1]!, track[i]!);
    if (since >= spacing && i < track.length - 1) { anchors.push(track[i]!); since = 0; }
  }
  anchors.push(track.at(-1)!);
  return anchors;
}

/** Groups of at most `size` anchors; neighbouring groups share their boundary anchor so the line stays joined. */
export function chunkAnchors(anchors: readonly Coordinate[], size = MAX_MATCH_ANCHORS): Coordinate[][] {
  const chunks: Coordinate[][] = [];
  for (let start = 0; start < anchors.length - 1; start += size - 1) chunks.push(anchors.slice(start, Math.min(anchors.length, start + size)));
  return chunks;
}

type Piece = { kind: 'matched'; candidate: ProviderCandidate } | { kind: 'gap'; to: Coordinate };

export interface SnapResult {
  /** The stitched snapped line, or null when too little of it could be matched. */
  candidate: ProviderCandidate | null;
  /** Share of the line's length that the router matched onto roads. */
  coverage: number;
  matchedMeters: number;
  gapMeters: number;
  gaps: number;
  /** Router requests made for this snap. */
  routerCalls: number;
  note: string;
}

export interface SnapDeps {
  provider: Pick<RouteCandidateProvider, 'id' | 'candidates'>;
  profile: string;
  signal?: AbortSignal;
}

/** Snap one rider track. Throws if the router itself is unavailable; unmatched stretches become labelled gaps. */
export async function snapRiderLine(track: readonly Coordinate[], deps: SnapDeps): Promise<SnapResult> {
  const anchors = pickAnchors(track);
  let routerCalls = 0;
  let captured: ProviderCandidate | undefined;
  const recorder: SnapDeps['provider'] = {
    id: deps.provider.id,
    async candidates(request, signal) {
      routerCalls++;
      const set = await deps.provider.candidates(request, signal);
      captured = set.candidates[0];
      return set;
    },
  };
  const tryMatch = async (group: readonly Coordinate[]): Promise<ProviderCandidate | null> => {
    captured = undefined;
    const result = await matchRoadAnchors({ anchors: group, profile: deps.profile }, { provider: recorder, ...(deps.signal ? { signal: deps.signal } : {}) });
    if (result.ok) return captured ?? null;
    // Only "this stretch has no road match" is a gap. A router outage must stop the run, not hide as a gap.
    if (result.error.code === 'no-match' || result.error.code === 'no-route') return null;
    throw new Error(`Rider-line snap failed: ${result.error.code}`);
  };
  const match = async (group: readonly Coordinate[]): Promise<Piece[]> => {
    const matched = await tryMatch(group);
    if (matched) return [{ kind: 'matched', candidate: matched }];
    if (group.length <= 2) return [{ kind: 'gap', to: group.at(-1)! }];
    const mid = group.length >> 1;
    return [...await match(group.slice(0, mid + 1)), ...await match(group.slice(mid))];
  };
  const pieces: Piece[] = [];
  for (const chunk of chunkAnchors(anchors)) pieces.push(...await match(chunk));
  const stitched = stitchPieces(pieces, anchors[0]!, deps.profile);
  const coverage = stitched.totalMeters > 0 ? stitched.matchedMeters / stitched.totalMeters : 0;
  const base = { coverage, matchedMeters: stitched.matchedMeters, gapMeters: stitched.gapMeters, gaps: stitched.gaps, routerCalls };
  const how = `Snapped with the road matcher through ${anchors.length} of the rider's own track points (about every ${(SNAP_SPACING_METERS / 1000).toFixed(1)} km), profile ${deps.profile}`;
  if (coverage < MIN_SNAP_COVERAGE) return { ...base, candidate: null, note: `${how}; only ${(coverage * 100).toFixed(0)}% could be matched, so the rider line is not measured` };
  return { ...base, candidate: stitched.candidate, note: `${how}; ${(coverage * 100).toFixed(0)}% matched${stitched.gaps ? `, ${stitched.gaps} raw gap(s) kept unscored` : ''}` };
}

const MISSING_RUN = (meters: number): ProviderRoadRun => ({ meters, durationSeconds: null, surface: 'missing', roadClass: 'missing', roadEnvironment: 'missing', urbanDensity: 'missing', curvatureRatio: null, toll: null });
const lineMeters = (line: readonly Coordinate[]): number => line.slice(1).reduce((sum, p, i) => sum + haversine(line[i]!, p), 0);
const addInto = (into: Record<string, number>, from: Readonly<Record<string, number>> | undefined): void => { for (const [k, v] of Object.entries(from ?? {})) into[k] = (into[k] ?? 0) + v; };

/** Join matched pieces end to end into one candidate the scorecard can measure like any other. */
export function stitchPieces(pieces: readonly Piece[], origin: Coordinate, profile: string): { candidate: ProviderCandidate; matchedMeters: number; gapMeters: number; gaps: number; totalMeters: number } {
  const geometry: Coordinate[] = [];
  const runs: ProviderRoadRun[] = [];
  const instructions: ProviderInstruction[] = [];
  const surfaceByRoadClassMeters: Record<string, number> = {};
  const curvatureMeters: Record<string, number> = {};
  let tollMeters = 0, duration = 0, distance = 0, matchedMeters = 0, gapMeters = 0, gaps = 0;
  let providerId = 'scorecard-rider-line';
  const append = (line: readonly Coordinate[]): number => {
    // The next piece starts where the last ended; drop the repeated point so no zero-length step appears.
    const last = geometry.at(-1);
    const drop = last !== undefined && line.length > 0 && haversine(last, line[0]!) < 1 ? 1 : 0;
    const base = geometry.length === 0 ? 0 : geometry.length - drop;
    geometry.push(...line.slice(drop));
    return base;
  };
  for (const piece of pieces) {
    if (piece.kind === 'gap') {
      const from = geometry.at(-1) ?? origin;
      const meters = haversine(from, piece.to);
      if (geometry.length === 0) geometry.push(from);
      geometry.push(piece.to);
      if (meters > 0) runs.push(MISSING_RUN(meters));
      gapMeters += meters; distance += meters; gaps++;
      continue;
    }
    const c = piece.candidate;
    providerId = c.providerId;
    // After a raw gap the next matched stretch starts a few metres off the gap's end: account for the hop.
    const last = geometry.at(-1);
    const hop = last !== undefined && c.geometry.length > 0 ? haversine(last, c.geometry[0]!) : 0;
    if (hop >= 1) { runs.push(MISSING_RUN(hop)); gapMeters += hop; distance += hop; }
    const base = append(c.geometry);
    const pieceRuns = c.roadSummary?.roadRuns;
    // No ordered road details means unknown, never clear: label the whole stretch "missing".
    runs.push(...(pieceRuns ?? [MISSING_RUN(lineMeters(c.geometry))]));
    for (const instruction of c.instructions ?? []) instructions.push(instruction.geometryIndex === undefined ? instruction : { ...instruction, geometryIndex: instruction.geometryIndex + base });
    addInto(surfaceByRoadClassMeters, c.roadSummary?.surfaceByRoadClassMeters);
    addInto(curvatureMeters, c.roadSummary?.curvatureMeters);
    tollMeters += c.roadSummary?.tollMeters ?? 0;
    duration += c.durationSeconds; distance += c.distanceMeters; matchedMeters += c.distanceMeters;
  }
  const candidate: ProviderCandidate = {
    providerId, profile, geometry, distanceMeters: distance, durationSeconds: duration, instructions,
    roadSummary: { totalMeters: distance, surfaceByRoadClassMeters, curvatureMeters, tollMeters, roadRuns: runs },
  };
  return { candidate, matchedMeters, gapMeters, gaps, totalMeters: matchedMeters + gapMeters };
}
