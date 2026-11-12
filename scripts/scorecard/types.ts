import type { Coordinate } from '../../src/domain/ride/types';

export type Mode = 'gravel' | 'dual-sport' | 'curvy';
export interface Ride {
  id: string;
  label: string;
  source: 'catalog' | 'benchmark' | 'corpus';
  mode: Mode;
  requestId: string;
  start: Coordinate;
  end?: Coordinate;
  loopMinutes?: number;
  avoidHighways?: boolean;
  riderTrack?: { catalogId: string; geometryPolyline: string };
}
export interface Measurement {
  miles: number;
  minutes: number;
  /** Good miles the verdict uses: mapped dirt, or the planner's own bend metres for Curvy (road-bends-v1, scorecard v2). */
  goodMiles: number;
  goodShare: number;
  /** The same two numbers as scorecard v1 measured them (Franco v1 bend metres for Curvy), kept so v1 can still be printed. */
  v1GoodMiles: number;
  v1GoodShare: number;
  dirtShare: number | null;
  francoPerKm: number;
  busyShare: number | null;
  extraMinutes: number;
  riderMatch: number | null;
  unknownSurfaceShare: number;
  planningSeconds: number;
  trustFailures: string[];
  unknownTrust: string[];
  authorityWarnings: string[];
  geometry: readonly Coordinate[];
}
/** What one plan cost the router. Counted outside src/, by the scorecard's own wrapper. */
export interface RouterUse {
  /** Router requests made while the planner was working, before it handed back an answer. */
  calls: number;
  /** Requests made afterwards by detached shadow work (drained before the next ride). */
  shadowCalls: number;
  /** Seconds until the first router answer of the full plan that carried a route came back; null if none did.
   * Old name: firstRouteSeconds. Requests run in single file here, so this is NOT what a rider waits for. */
  firstCallSeconds: number | null;
  /** Seconds one real first-answer request takes (planRide, includeAlternatives false, as the app sends it); null if it failed. */
  firstAnswerSeconds: number | null;
}
/** How the rider's own track was put onto our roads. */
export interface RiderLineSnap {
  /** Share of the rider's line (by length) that the router matched onto roads. */
  coverage: number;
  /** Router requests the snap needed (not counted against OpenGravel). */
  routerCalls: number;
  profile: string;
  fromCache: boolean;
  note: string;
}
export type Verdict = 'Win' | 'Tie' | 'Loss';
export interface Row {
  ride: Ride;
  openGravel: Measurement | null;
  fastest: Measurement | null;
  /** Third contestant: the rider's own line, snapped to our roads. Shown, never scored, never used to plan. */
  riderLine: Measurement | null;
  riderSnap: RiderLineSnap | null;
  /** Scorecard v3 verdict: the headline (see scoring.ts winTieLossV3). */
  verdict: Verdict;
  reasons: string[];
  /** The verdict rule v2 gives for the same routes (planner's own bend measure, frozen curvy share). */
  verdictV2: Verdict;
  reasonsV2: string[];
  /** The verdict scorecard v1 would have given, so both headlines can be printed. */
  verdictV1: Verdict;
  reasonsV1: string[];
  routerUse: RouterUse | null;
  errors: string[];
}
