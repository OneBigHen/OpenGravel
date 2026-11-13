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
/** One threshold the verdict had to clear, and how far over it the route is. */
export interface MarginBar {
  /** Plain-English name of the bar, as the rider sees it in the report. */
  label: string;
  /** The route's value for this bar (good miles, share, or miles above fastest). */
  score: number;
  /** The value the rule asks for. */
  bar: number;
  /** score / bar: 1.0 is exactly on the bar, 1.1 is 10% above it. Infinity when the bar is zero. */
  ratio: number;
}
/** Scorecard v4 item c: how close a Win is to the bar it had to clear. */
export interface WinMargin {
  /** Best passing path's closest bar, as a share above it (0.04 = 4% above). Null when unmeasured. */
  aboveBar: number | null;
  /** True when the best passing path clears its closest bar by less than 10%. Only meaningful for a Win. */
  thin: boolean;
  /** The closest bar that path cleared. */
  bar: string | null;
  /** Every threshold behind the verdict, kept so a thin label can be explained. */
  detail: MarginBar[];
}
/** Scorecard v4 item d: what the "fastest" reference was, and whether it is honestly fastest. */
export interface FastestReferenceCheck {
  /** Only A-to-B rides have a fastest reference; loops are compared with an equal-time loop. */
  applicable: boolean;
  referenceMinutes: number | null;
  chosenMinutes: number | null;
  /** How much quicker our chosen line is than the reference, as a share of the reference (0.03 = 3%). */
  quickerShare: number | null;
  /** True when our own line is more than 2% quicker than the line called "fastest": the reference is broken. */
  failed: boolean;
  message: string;
}
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
  /** How close this row's v3 verdict is to its bar (item c). */
  margin: WinMargin;
  /** What the fastest reference was, and whether our own line beat it (item d). */
  referenceCheck: FastestReferenceCheck;
  routerUse: RouterUse | null;
  errors: string[];
}
