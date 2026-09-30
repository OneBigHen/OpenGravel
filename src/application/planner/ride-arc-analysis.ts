/**
 * Ride Arc phase analysis.
 *
 * OpenGravel's product thesis is phase-dependent:
 *
 *   ESCAPE -> CORE RIDE -> RETURN / ARRIVAL
 *
 * This module does not decide whether a road is worthwhile. The caller supplies
 * ordered segment evidence that already answered that question using canonical
 * road facts/policy. The analyzer only finds a sustained core region and
 * measures how the rider's time is distributed around it.
 *
 * Unknown road evidence stays unknown. A route with sparse segment evidence
 * cannot earn a precise "58 min good roads" claim.
 */

export interface RideArcSegment {
  readonly id: string;
  readonly distanceMeters: number;
  readonly durationSeconds: number;
  /**
   * Bounded 0..1 segment-level "worthwhile for this ride intent" evidence.
   * null means the application cannot currently establish this segment's fit.
   */
  readonly worthwhile: number | null;
}

export interface RideArcAnalysisOptions {
  /** Segment value at/above this is a known worthwhile section. */
  readonly worthwhileThreshold?: number;
  /**
   * A short weak/unknown connector may sit inside one sustained core run. A gap
   * longer than this splits the run.
   */
  readonly maximumBridgeSeconds?: number;
  /** Minimum known worthwhile time required for one core run. */
  readonly minimumCoreWorthwhileSeconds?: number;
  /** Minimum worthwhile share inside a qualifying core run. */
  readonly minimumCoreWorthwhileShare?: number;
  /** Below this segment-evidence coverage, phase claims stay unavailable. */
  readonly minimumEvidenceCoverage?: number;
}

export interface RideArcPhase {
  readonly startSegmentIndex: number;
  readonly endSegmentIndex: number;
  readonly durationSeconds: number;
  readonly distanceMeters: number;
}

export interface RideArcAnalysis {
  readonly totalSeconds: number;
  readonly totalMeters: number;

  readonly evidenceCoverage: number;
  readonly knownEvidenceSeconds: number;
  readonly unknownEvidenceSeconds: number;
  readonly worthwhileSeconds: number;
  readonly worthwhileMeters: number;

  /**
   * Conservative share of the whole ride known to be worthwhile. Unknown time
   * stays in the denominator rather than being guessed positive.
   */
  readonly worthwhileMinuteRatio: number;

  readonly coreDetected: boolean;
  readonly escape: RideArcPhase | null;
  readonly core: RideArcPhase | null;
  readonly terminal: RideArcPhase | null;

  /** Known worthwhile share inside the selected core region. */
  readonly coreWorthwhileShare: number | null;
  /** Number of short non-worthwhile/unknown seconds bridged inside the core. */
  readonly coreBridgeSeconds: number | null;
}

interface ResolvedOptions {
  readonly worthwhileThreshold: number;
  readonly maximumBridgeSeconds: number;
  readonly minimumCoreWorthwhileSeconds: number;
  readonly minimumCoreWorthwhileShare: number;
  readonly minimumEvidenceCoverage: number;
}

interface CoreRun {
  readonly start: number;
  readonly end: number;
  readonly durationSeconds: number;
  readonly distanceMeters: number;
  readonly worthwhileSeconds: number;
  readonly bridgeSeconds: number;
}

const DEFAULT_WORTHWHILE_THRESHOLD = 0.65;
const DEFAULT_MAXIMUM_BRIDGE_SECONDS = 120;
const DEFAULT_MINIMUM_CORE_WORTHWHILE_SECONDS = 8 * 60;
const DEFAULT_MINIMUM_CORE_WORTHWHILE_SHARE = 0.6;
const DEFAULT_MINIMUM_EVIDENCE_COVERAGE = 0.6;
const EPSILON = 1e-9;

function unit(value: number): boolean {
  return Number.isFinite(value) && value >= 0 && value <= 1;
}

function validSegment(segment: RideArcSegment): boolean {
  return (
    segment.id.trim().length > 0 &&
    Number.isFinite(segment.distanceMeters) &&
    segment.distanceMeters >= 0 &&
    Number.isFinite(segment.durationSeconds) &&
    segment.durationSeconds > 0 &&
    (segment.worthwhile === null || unit(segment.worthwhile))
  );
}

function resolveOptions(
  options: RideArcAnalysisOptions,
): ResolvedOptions | null {
  const worthwhileThreshold =
    options.worthwhileThreshold ?? DEFAULT_WORTHWHILE_THRESHOLD;
  const maximumBridgeSeconds =
    options.maximumBridgeSeconds ?? DEFAULT_MAXIMUM_BRIDGE_SECONDS;
  const minimumCoreWorthwhileSeconds =
    options.minimumCoreWorthwhileSeconds ??
    DEFAULT_MINIMUM_CORE_WORTHWHILE_SECONDS;
  const minimumCoreWorthwhileShare =
    options.minimumCoreWorthwhileShare ??
    DEFAULT_MINIMUM_CORE_WORTHWHILE_SHARE;
  const minimumEvidenceCoverage =
    options.minimumEvidenceCoverage ??
    DEFAULT_MINIMUM_EVIDENCE_COVERAGE;

  if (
    !unit(worthwhileThreshold) ||
    !Number.isFinite(maximumBridgeSeconds) ||
    maximumBridgeSeconds < 0 ||
    !Number.isFinite(minimumCoreWorthwhileSeconds) ||
    minimumCoreWorthwhileSeconds <= 0 ||
    !unit(minimumCoreWorthwhileShare) ||
    !unit(minimumEvidenceCoverage)
  ) {
    return null;
  }

  return {
    worthwhileThreshold,
    maximumBridgeSeconds,
    minimumCoreWorthwhileSeconds,
    minimumCoreWorthwhileShare,
    minimumEvidenceCoverage,
  };
}

function isWorthwhile(
  segment: RideArcSegment,
  threshold: number,
): boolean {
  return segment.worthwhile !== null &&
    segment.worthwhile + EPSILON >= threshold;
}

function phase(
  segments: readonly RideArcSegment[],
  start: number,
  end: number,
): RideArcPhase | null {
  if (start < 0 || end < start || end >= segments.length) return null;
  let durationSeconds = 0;
  let distanceMeters = 0;
  for (let index = start; index <= end; index += 1) {
    const segment = segments[index];
    if (segment === undefined) continue;
    durationSeconds += segment.durationSeconds;
    distanceMeters += segment.distanceMeters;
  }
  return {
    startSegmentIndex: start,
    endSegmentIndex: end,
    durationSeconds,
    distanceMeters,
  };
}

function candidateRuns(
  segments: readonly RideArcSegment[],
  options: ResolvedOptions,
): readonly CoreRun[] {
  const worthwhileIndexes = segments
    .map((segment, index) =>
      isWorthwhile(segment, options.worthwhileThreshold) ? index : -1,
    )
    .filter((index) => index >= 0);
  if (worthwhileIndexes.length === 0) return [];

  const runs: CoreRun[] = [];
  let start = worthwhileIndexes[0]!;
  let previousWorthwhile = start;

  const flush = (end: number): void => {
    let durationSeconds = 0;
    let distanceMeters = 0;
    let worthwhileSeconds = 0;

    for (let index = start; index <= end; index += 1) {
      const segment = segments[index];
      if (segment === undefined) continue;
      durationSeconds += segment.durationSeconds;
      distanceMeters += segment.distanceMeters;
      if (isWorthwhile(segment, options.worthwhileThreshold)) {
        worthwhileSeconds += segment.durationSeconds;
      }
    }

    const worthwhileShare =
      durationSeconds > 0 ? worthwhileSeconds / durationSeconds : 0;
    if (
      worthwhileSeconds + EPSILON >=
        options.minimumCoreWorthwhileSeconds &&
      worthwhileShare + EPSILON >=
        options.minimumCoreWorthwhileShare
    ) {
      runs.push({
        start,
        end,
        durationSeconds,
        distanceMeters,
        worthwhileSeconds,
        bridgeSeconds: durationSeconds - worthwhileSeconds,
      });
    }
  };

  for (let cursor = 1; cursor < worthwhileIndexes.length; cursor += 1) {
    const nextWorthwhile = worthwhileIndexes[cursor]!;
    let gapSeconds = 0;
    for (
      let index = previousWorthwhile + 1;
      index < nextWorthwhile;
      index += 1
    ) {
      gapSeconds += segments[index]?.durationSeconds ?? 0;
    }

    if (gapSeconds > options.maximumBridgeSeconds + EPSILON) {
      flush(previousWorthwhile);
      start = nextWorthwhile;
    }
    previousWorthwhile = nextWorthwhile;
  }

  flush(previousWorthwhile);
  return runs;
}

function selectPrimaryCore(runs: readonly CoreRun[]): CoreRun | null {
  const ordered = [...runs].sort((left, right) => {
    if (left.worthwhileSeconds !== right.worthwhileSeconds) {
      return right.worthwhileSeconds - left.worthwhileSeconds;
    }
    if (left.bridgeSeconds !== right.bridgeSeconds) {
      return left.bridgeSeconds - right.bridgeSeconds;
    }
    if (left.durationSeconds !== right.durationSeconds) {
      return right.durationSeconds - left.durationSeconds;
    }
    return left.start - right.start;
  });
  return ordered[0] ?? null;
}

/**
 * Finds the main sustained riding core from ordered segment evidence.
 *
 * The function returns null only for malformed input/options. A well-formed
 * route with insufficient evidence returns an honest analysis with
 * coreDetected=false instead of fabricating phase boundaries.
 */
export function analyzeRideArc(
  segments: readonly RideArcSegment[],
  options: RideArcAnalysisOptions = {},
): RideArcAnalysis | null {
  if (segments.length === 0 || !segments.every(validSegment)) return null;
  const resolved = resolveOptions(options);
  if (resolved === null) return null;

  let totalSeconds = 0;
  let totalMeters = 0;
  let knownEvidenceSeconds = 0;
  let unknownEvidenceSeconds = 0;
  let worthwhileSeconds = 0;
  let worthwhileMeters = 0;

  for (const segment of segments) {
    totalSeconds += segment.durationSeconds;
    totalMeters += segment.distanceMeters;

    if (segment.worthwhile === null) {
      unknownEvidenceSeconds += segment.durationSeconds;
      continue;
    }

    knownEvidenceSeconds += segment.durationSeconds;
    if (isWorthwhile(segment, resolved.worthwhileThreshold)) {
      worthwhileSeconds += segment.durationSeconds;
      worthwhileMeters += segment.distanceMeters;
    }
  }

  const evidenceCoverage =
    totalSeconds > 0 ? knownEvidenceSeconds / totalSeconds : 0;
  const worthwhileMinuteRatio =
    totalSeconds > 0 ? worthwhileSeconds / totalSeconds : 0;

  if (
    evidenceCoverage + EPSILON <
    resolved.minimumEvidenceCoverage
  ) {
    return {
      totalSeconds,
      totalMeters,
      evidenceCoverage,
      knownEvidenceSeconds,
      unknownEvidenceSeconds,
      worthwhileSeconds,
      worthwhileMeters,
      worthwhileMinuteRatio,
      coreDetected: false,
      escape: null,
      core: null,
      terminal: null,
      coreWorthwhileShare: null,
      coreBridgeSeconds: null,
    };
  }

  const core = selectPrimaryCore(candidateRuns(segments, resolved));
  if (core === null) {
    return {
      totalSeconds,
      totalMeters,
      evidenceCoverage,
      knownEvidenceSeconds,
      unknownEvidenceSeconds,
      worthwhileSeconds,
      worthwhileMeters,
      worthwhileMinuteRatio,
      coreDetected: false,
      escape: null,
      core: null,
      terminal: null,
      coreWorthwhileShare: null,
      coreBridgeSeconds: null,
    };
  }

  const escape =
    core.start === 0
      ? null
      : phase(segments, 0, core.start - 1);
  const corePhase = phase(segments, core.start, core.end);
  const terminal =
    core.end >= segments.length - 1
      ? null
      : phase(segments, core.end + 1, segments.length - 1);

  return {
    totalSeconds,
    totalMeters,
    evidenceCoverage,
    knownEvidenceSeconds,
    unknownEvidenceSeconds,
    worthwhileSeconds,
    worthwhileMeters,
    worthwhileMinuteRatio,
    coreDetected: true,
    escape,
    core: corePhase,
    terminal,
    coreWorthwhileShare:
      core.durationSeconds > 0
        ? core.worthwhileSeconds / core.durationSeconds
        : null,
    coreBridgeSeconds: core.bridgeSeconds,
  };
}
