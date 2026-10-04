/**
 * Bounded Gravel Atlas probes. The atlas is a source of route-shaping prizes;
 * the provider and the canonical planner gate remain authoritative for the
 * returned road. Each probe is one provider call so the family runner owns
 * ordering, cancellation and the shared call budget.
 */

import { haversine } from "@/domain/geometry/analysis";
import type { Coordinate } from "@/domain/ride/types";
import { indexRoute, lineOverlap } from "@/application/roads/route-overlap";
import type { GravelAtlasCorridor } from "@/application/roads/gravel-atlas";
import {
  searchCorridorPrizeLoops,
  type CorridorPrize,
} from "./corridor-prize-loop";
import type {
  FunCandidateGenerator,
  FunGeneratorContext,
  FunProbe,
  FunProbeExecution,
} from "./fun-generators";
import type {
  ProviderCandidate,
  ProviderRoadSpan,
  ProviderRouteRequest,
} from "./route-provider";

export const ATLAS_GENERATOR_IDS = ["gravel-prize", "backroad-stitch"] as const;
export type AtlasGeneratorId = (typeof ATLAS_GENERATOR_IDS)[number];

const MAX_ATLAS_CORRIDORS = 12;
const MAX_ATLAS_PROPOSALS = 2;
const MAX_CORRIDERS_PER_SEQUENCE = 3;
const MAX_SPAN_ANCHORS = 8;
const MAX_SPAN_CORRIDOR_POINTS = 256;
const MIN_CORRIDOR_ADHERENCE = 0.5;
const MIN_LEGAL_CONFIDENCE = 0.65;
const MAX_DETOUR_FACTOR = 1.35;
const CONNECTOR_STRETCH = 1.5;
const DEFAULT_SPEED_METERS_PER_SECOND = 15;
/** Dirt is ridden slowly; the profile caps gravel near 45 km/h and real riding is slower. */
const DIRT_SPEED_METERS_PER_SECOND = 8;
/** Plan to use at most this share of the time cap: the estimate is straight-line. */
const ESTIMATE_SAFETY = 1;
/** Attempts a probe may spend: the full sequence, then one without its weakest corridor. */
const MAX_ATTEMPTS_PER_PROBE = 2;
const DIRT_SURFACES = new Set([
  "gravel",
  "fine_gravel",
  "compacted",
  "dirt",
  "ground",
  "unpaved",
  "earth",
]);

interface SelectedSequence {
  readonly corridors: readonly GravelAtlasCorridor[];
  readonly estimatedSeconds: number;
  readonly connectorMeters: number;
  readonly prize: number;
  readonly key: string;
}

interface AtlasPlan {
  /** Attempts, widest first; a failed attempt retries with the next one. */
  readonly sequences: readonly SelectedSequence[];
  readonly requests: readonly ProviderRouteRequest[];
}

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}

function validCoordinate(point: Coordinate | undefined): point is Coordinate {
  return point !== undefined && Number.isFinite(point.lon) && Number.isFinite(point.lat);
}

function validLine(line: readonly Coordinate[]): boolean {
  return line.length >= 2 && line.every((point) => validCoordinate(point));
}

function copy(point: Coordinate): Coordinate {
  return { lon: point.lon, lat: point.lat };
}

function sampleLine(line: readonly Coordinate[], maximum: number): readonly Coordinate[] {
  if (line.length <= maximum) return line.map(copy);
  const points: Coordinate[] = [];
  for (let slot = 0; slot < maximum; slot += 1) {
    const index = Math.round((slot * (line.length - 1)) / (maximum - 1));
    const point = line[index];
    if (point !== undefined && (points.at(-1)?.lon !== point.lon || points.at(-1)?.lat !== point.lat)) {
      points.push(copy(point));
    }
  }
  return points;
}

function corridorAnchors(line: readonly Coordinate[]): readonly Coordinate[] {
  return sampleLine(line, MAX_SPAN_ANCHORS);
}

function sourceScore(corridor: GravelAtlasCorridor, kind: AtlasGeneratorId): number {
  const length = Math.max(1, corridor.lengthMeters);
  const legal = clamp01(corridor.legalConfidence);
  const quality = clamp01(corridor.quality);
  const franco = corridor.francoScore <= 1
    ? clamp01(corridor.francoScore)
    : clamp01(corridor.francoScore / 1_000);
  const bend = clamp01(corridor.bendShare);
  if (kind === "gravel-prize") {
    const continuity = clamp01(corridor.longestDirtRunMeters / length);
    return quality * legal * length * (0.5 + franco) * (0.7 + bend) * (0.6 + continuity);
  }
  return quality * legal * length * (0.5 + franco) * (0.7 + bend);
}

function requestHasAuthoredGeometry(request: ProviderRouteRequest): boolean {
  return (
    request.stops.length > 0 ||
    request.shaping.length > 0 ||
    request.sketch !== undefined ||
    (request.roadSpans?.length ?? 0) > 0
  );
}

function dirtMode(request: ProviderRouteRequest): boolean {
  return request.options.surfacePreference === "dirt-preferred" ||
    request.options.bike?.category === "dual-sport";
}

function roughTrackAllowed(request: ProviderRouteRequest): boolean {
  return request.options.bike?.category === "dual-sport" &&
    request.options.bike.roughTracks === "allow";
}

function gradeFromKey(key: string): number | null {
  const match = /(?:grade)?([1-5])$/i.exec(key.trim());
  return match === null ? null : Number(match[1]);
}

function corridorAllowed(
  corridor: GravelAtlasCorridor,
  request: ProviderRouteRequest,
  kind: AtlasGeneratorId,
): boolean {
  if (!validLine(corridor.geometry)) return false;
  if (!(corridor.lengthMeters > 0) || corridor.legalConfidence < MIN_LEGAL_CONFIDENCE) return false;
  if (!corridor.access.legal || corridor.access.sandShare > 0) return false;
  if (corridor.seasonal.closed || corridor.seasonal.seasonalClosed) return false;
  // A dead end means riding the corridor and turning round: not a way through.
  if (corridor.entryLinks === 0 || corridor.exitLinks === 0) return false;
  // The router could not ride it at about its own length: never route toward it.
  if (corridor.routable === false) return false;
  if (kind === "gravel-prize" && corridor.kind !== "dirt") return false;
  if (kind === "backroad-stitch" && corridor.kind !== "backroad") return false;
  if (kind === "gravel-prize" && !dirtMode(request)) return false;
  if (kind === "backroad-stitch" && request.options.roadCharacter !== "curvy" && request.options.roadCharacter !== "backroads") return false;

  const maxGrade = corridor.maxTrackGrade ?? 0;
  if (maxGrade >= 5) return false;
  if (maxGrade >= 3 && !roughTrackAllowed(request)) return false;
  if (Object.entries(corridor.gradeMix).some(([key, meters]) => {
    const grade = gradeFromKey(key);
    return meters > 0 && grade !== null && grade >= 3 && !roughTrackAllowed(request);
  })) return false;
  if (Object.entries(corridor.gradeMix).some(([key, meters]) => {
    const grade = gradeFromKey(key);
    return meters > 0 && grade === 5;
  })) return false;
  if (request.options.bike?.roughTracks === "avoid" && maxGrade >= 3) return false;
  if (request.options.bike?.category === "street" || request.options.bike?.category === "touring") {
    if (maxGrade >= 3) return false;
  }
  return true;
}

function fastestProductionSeconds(context: FunGeneratorContext): number | null {
  const durations = context.production
    .map((route) => route.measurement.durationSeconds)
    .filter((duration) => Number.isFinite(duration) && duration > 0);
  if (durations.length === 0) return null;
  return Math.min(...durations);
}

function speedProxy(context: FunGeneratorContext): number {
  const routes = context.production.filter((route) =>
    route.measurement.durationSeconds > 0 && route.measurement.distanceMeters > 0,
  );
  if (routes.length === 0) return DEFAULT_SPEED_METERS_PER_SECOND;
  const speed = Math.min(...routes.map((route) => route.measurement.distanceMeters / route.measurement.durationSeconds));
  return Math.max(8, Math.min(30, speed));
}

function reversed(corridor: GravelAtlasCorridor): GravelAtlasCorridor {
  return { ...corridor, geometry: [...corridor.geometry].reverse() };
}

/** Straight-line connector metres through the corridors, in order, ending at the finish. */
function connectorMeters(
  request: ProviderRouteRequest,
  corridors: readonly GravelAtlasCorridor[],
): number {
  let total = 0;
  let from = request.origin;
  for (const corridor of corridors) {
    const first = corridor.geometry[0];
    const last = corridor.geometry.at(-1);
    if (!validCoordinate(first) || !validCoordinate(last)) return Number.POSITIVE_INFINITY;
    total += haversine(from, first);
    from = last;
  }
  total += haversine(from, request.destination);
  return total;
}

/**
 * Estimated seconds for origin, corridors in order, finish. Connectors are
 * stretched (roads are not straight) and dirt is ridden slower than the
 * connectors, so the estimate errs long rather than short.
 */
function estimateSeconds(
  request: ProviderRouteRequest,
  corridors: readonly GravelAtlasCorridor[],
  speed: number,
): number {
  const dirtSpeed = Math.min(speed, DIRT_SPEED_METERS_PER_SECOND);
  const corridorSeconds = corridors.reduce(
    (sum, corridor) => sum + corridor.lengthMeters / (corridor.kind === "dirt" ? dirtSpeed : speed),
    0,
  );
  return (connectorMeters(request, corridors) * CONNECTOR_STRETCH) / speed + corridorSeconds;
}

/** The orientation of a reversible corridor that costs the least connector distance. */
function cheaperOrientation(
  corridor: GravelAtlasCorridor,
  request: ProviderRouteRequest,
): GravelAtlasCorridor {
  if (!corridor.reversible) return corridor;
  const flipped = reversed(corridor);
  return connectorMeters(request, [flipped]) < connectorMeters(request, [corridor]) ? flipped : corridor;
}

function sequenceKey(corridors: readonly GravelAtlasCorridor[]): string {
  return corridors.map((corridor) => corridor.id).join(">");
}

function selectReachable(
  corridors: readonly GravelAtlasCorridor[],
  request: ProviderRouteRequest,
  context: FunGeneratorContext,
  kind: AtlasGeneratorId,
): readonly GravelAtlasCorridor[] {
  const fastest = fastestProductionSeconds(context);
  const speed = speedProxy(context);
  const loop = request.discovery !== undefined;
  const upperSeconds = loop
    ? Math.max(60, (request.discovery!.targetMinutes + request.discovery!.toleranceMinutes) * 60)
    : fastest === null ? null : fastest * MAX_DETOUR_FACTOR;
  if (upperSeconds === null) return [];
  return corridors
    .filter((corridor) => corridorAllowed(corridor, request, kind))
    .map((corridor) => cheaperOrientation(corridor, request))
    .map((corridor) => ({ corridor, seconds: estimateSeconds(request, [corridor], speed) }))
    .filter(({ seconds }) => seconds <= upperSeconds * ESTIMATE_SAFETY + 1e-6)
    .sort((left, right) =>
      sourceScore(right.corridor, kind) - sourceScore(left.corridor, kind) ||
      left.seconds - right.seconds ||
      left.corridor.id.localeCompare(right.corridor.id),
    )
    .slice(0, MAX_ATLAS_CORRIDORS)
    .map(({ corridor }) => corridor);
}

function sequencePrize(corridors: readonly GravelAtlasCorridor[], kind: AtlasGeneratorId): number {
  return corridors.reduce((sum, corridor) => sum + sourceScore(corridor, kind), 0);
}

function sequenceCandidates(
  corridors: readonly GravelAtlasCorridor[],
  request: ProviderRouteRequest,
  context: FunGeneratorContext,
  kind: AtlasGeneratorId,
): readonly SelectedSequence[] {
  const fastest = fastestProductionSeconds(context);
  const speed = speedProxy(context);
  const loop = request.discovery !== undefined;
  const upperSeconds = loop
    ? Math.max(60, (request.discovery!.targetMinutes + request.discovery!.toleranceMinutes) * 60)
    : fastest === null ? null : fastest * MAX_DETOUR_FACTOR;
  if (upperSeconds === null) return [];

  if (loop) {
    const prizes: CorridorPrize[] = corridors.map((corridor) => ({
      id: corridor.id,
      entry: corridor.geometry[0]!,
      exit: corridor.geometry.at(-1)!,
      traversalSeconds: corridor.lengthMeters / (corridor.kind === "dirt" ? Math.min(speed, DIRT_SPEED_METERS_PER_SECOND) : speed),
      utility: clamp01(sourceScore(corridor, kind) / Math.max(corridor.lengthMeters, 1)),
      groupId: corridor.id,
    }));
    const found = searchCorridorPrizeLoops({
      origin: request.origin,
      budgetSeconds: upperSeconds,
      prizes,
      estimateConnectorSeconds: (from, to) => haversine(from, to) * CONNECTOR_STRETCH / speed,
      options: { maxPrizes: MAX_CORRIDERS_PER_SEQUENCE, maxResults: MAX_ATLAS_PROPOSALS, minimumPrizeUtility: 0, maxConnectorShare: 0.75 },
    });
    const byId = new Map(corridors.map((corridor) => [corridor.id, corridor]));
    return found
      .map((result): SelectedSequence | null => {
        const chosen = result.prizeIds.flatMap((id) => {
          const corridor = byId.get(id);
          return corridor === undefined ? [] : [corridor];
        });
        if (chosen.length === 0) return null;
        return {
          corridors: chosen,
          estimatedSeconds: result.estimatedSeconds,
          connectorMeters: result.connectorSeconds * speed,
          prize: sequencePrize(chosen, kind),
          key: sequenceKey(chosen),
        };
      })
      .filter((sequence): sequence is SelectedSequence => sequence !== null);
  }

  type BeamState = { corridors: readonly GravelAtlasCorridor[]; estimatedSeconds: number };
  let beam: BeamState[] = [{ corridors: [], estimatedSeconds: 0 }];
  const completed: SelectedSequence[] = [];
  for (let depth = 0; depth < MAX_CORRIDERS_PER_SEQUENCE; depth += 1) {
    const next: BeamState[] = [];
    for (const state of beam) {
      for (const corridor of corridors) {
        if (state.corridors.some((item) => item.id === corridor.id)) continue;
        const withCorridor = [...state.corridors, corridor];
        const seconds = estimateSeconds(request, withCorridor, speed);
        if (seconds > upperSeconds * ESTIMATE_SAFETY + 1e-6) continue;
        next.push({ corridors: withCorridor, estimatedSeconds: seconds });
      }
    }
    next.sort((left, right) => {
      const leftScore = sequencePrize(left.corridors, kind) - left.estimatedSeconds * 0.01;
      const rightScore = sequencePrize(right.corridors, kind) - right.estimatedSeconds * 0.01;
      return rightScore - leftScore || left.estimatedSeconds - right.estimatedSeconds || sequenceKey(left.corridors).localeCompare(sequenceKey(right.corridors));
    });
    beam = next.slice(0, MAX_ATLAS_CORRIDORS);
    for (const state of beam) {
      if (state.corridors.length === 0) continue;
      completed.push({
        corridors: state.corridors,
        estimatedSeconds: state.estimatedSeconds,
        connectorMeters: connectorMeters(request, state.corridors),
        prize: sequencePrize(state.corridors, kind),
        key: sequenceKey(state.corridors),
      });
    }
  }
  const ranked = completed.sort(
    (left, right) => right.prize - left.prize || left.estimatedSeconds - right.estimatedSeconds || left.key.localeCompare(right.key),
  );
  // Distinct proposals use disjoint corridors, so a second probe is a real
  // alternative rather than the first one plus a tail.
  const chosen: SelectedSequence[] = [];
  const used = new Set<string>();
  for (const sequence of ranked) {
    if (sequence.corridors.some((corridor) => used.has(corridor.id))) continue;
    chosen.push(sequence);
    for (const corridor of sequence.corridors) used.add(corridor.id);
    if (chosen.length >= MAX_ATLAS_PROPOSALS) break;
  }
  return chosen;
}

/** The sequence without its weakest corridor: the cheaper second attempt. */
function narrowed(sequence: SelectedSequence, request: ProviderRouteRequest, speed: number, kind: AtlasGeneratorId): SelectedSequence | null {
  if (sequence.corridors.length < 2) return null;
  const weakest = [...sequence.corridors].sort((left, right) => sourceScore(left, kind) - sourceScore(right, kind))[0]!;
  const rest = sequence.corridors.filter((corridor) => corridor.id !== weakest.id);
  return {
    corridors: rest,
    estimatedSeconds: estimateSeconds(request, rest, speed),
    connectorMeters: connectorMeters(request, rest),
    prize: sequencePrize(rest, kind),
    key: sequenceKey(rest),
  };
}

function spansForSequence(corridors: readonly GravelAtlasCorridor[]): readonly ProviderRoadSpan[] {
  return corridors.map((corridor) => ({
    id: `atlas:${corridor.id}`,
    mode: "must",
    direction: "forward",
    anchors: corridorAnchors(corridor.geometry),
    corridor: sampleLine(corridor.geometry, MAX_SPAN_CORRIDOR_POINTS),
    corridorToleranceMeters: 80,
  }));
}

function requestForSequence(
  request: ProviderRouteRequest,
  sequence: SelectedSequence,
): ProviderRouteRequest {
  const isLoop = request.discovery !== undefined;
  const withoutDiscovery = { ...request };
  delete (withoutDiscovery as { discovery?: unknown }).discovery;
  return {
    ...withoutDiscovery,
    destination: isLoop ? request.origin : request.destination,
    roadSpans: spansForSequence(sequence.corridors),
    options: { ...request.options, includeAlternatives: false },
  };
}

function corridorAdherence(route: readonly Coordinate[], corridors: readonly GravelAtlasCorridor[]): number | null {
  if (route.length < 2) return null;
  const index = indexRoute(route);
  let ridden = 0;
  let total = 0;
  for (const corridor of corridors) {
    const overlap = lineOverlap(index, corridor.geometry, 50);
    ridden += overlap.riddenMeters;
    total += overlap.lineMeters;
  }
  return total > 0 ? clamp01(ridden / total) : null;
}

function observedUnpavedShare(candidate: ProviderCandidate): number | null {
  const summary = candidate.roadSummary;
  if (summary === undefined || !(summary.totalMeters > 0)) return null;
  const keys = Object.entries(summary.surfaceByRoadClassMeters);
  if (keys.length === 0) return null;
  const sand = keys.some(([key, meters]) => key.split("|")[0]?.toLowerCase() === "sand" && meters > 0);
  if (sand) return null;
  const missing = keys.reduce((sum, [key, meters]) => sum + (key.split("|")[0]?.toLowerCase() === "missing" ? meters : 0), 0);
  const known = summary.totalMeters - missing;
  if (!(known > 0)) return null;
  const unpaved = keys.reduce((sum, [key, meters]) => {
    const surface = key.split("|")[0]?.toLowerCase() ?? "";
    return sum + (DIRT_SURFACES.has(surface) ? meters : 0);
  }, 0);
  return clamp01(unpaved / known);
}

function knownUnsafeRoad(candidate: ProviderCandidate): boolean {
  return candidate.roadSummary?.roadRuns?.some((run) =>
    run.carAccess === false ||
    run.roadAccess?.toLowerCase() === "private" ||
    run.surface.toLowerCase() === "sand",
  ) ?? false;
}

function withMetadata(
  generatorId: AtlasGeneratorId,
  candidate: ProviderCandidate,
  sequence: SelectedSequence,
  observed: number,
  fastestSeconds: number | null,
): ProviderCandidate {
  return {
    ...candidate,
    providerMetadata: {
      ...candidate.providerMetadata,
      atlasGenerator: generatorId,
      atlasCorridorIds: JSON.stringify(sequence.corridors.map((corridor) => corridor.id)),
      observedUnpavedShare: observed,
      ...(fastestSeconds === null
        ? {}
        : { addedMinutes: Number(((candidate.durationSeconds - fastestSeconds) / 60).toFixed(2)) }),
      atlasEstimatedSeconds: Math.round(sequence.estimatedSeconds),
    },
  };
}

/** Why an attempt failed in a way a narrower sequence might fix. */
const RETRYABLE_NOTES = new Set(["time-cap", "low-adherence", "no-path"]);

function evaluateAnswer(
  id: AtlasGeneratorId,
  answer: ProviderCandidate | null,
  sequence: SelectedSequence,
  fastestSeconds: number | null,
  request: ProviderRouteRequest,
): FunProbeExecution {
  if (answer === null) return { candidate: null, adherence: null, note: "no-path" };
  if (knownUnsafeRoad(answer)) return { candidate: null, adherence: null, note: "unsafe-road" };
  const observed = observedUnpavedShare(answer);
  if (observed === null) {
    const hasSand = Object.keys(answer.roadSummary?.surfaceByRoadClassMeters ?? {}).some((key) => key.startsWith("sand|"));
    return { candidate: null, adherence: null, note: hasSand ? "sand-route" : "missing-unpaved-evidence" };
  }
  const adherence = corridorAdherence(answer.geometry, sequence.corridors);
  if (adherence === null || adherence < MIN_CORRIDOR_ADHERENCE) {
    return { candidate: null, adherence, note: "low-adherence" };
  }
  if (request.discovery !== undefined) {
    const maximum = (request.discovery.targetMinutes + request.discovery.toleranceMinutes) * 60;
    const minimum = Math.max(0, request.discovery.targetMinutes - request.discovery.toleranceMinutes) * 60;
    if (answer.durationSeconds > maximum + 1e-6) return { candidate: null, adherence, note: "time-cap" };
    if (answer.durationSeconds + 1e-6 < minimum) return { candidate: null, adherence, note: "loop-shortfall" };
  } else if (fastestSeconds === null || answer.durationSeconds > fastestSeconds * MAX_DETOUR_FACTOR + 1e-6) {
    return { candidate: null, adherence, note: "time-cap" };
  }
  return { candidate: withMetadata(id, answer, sequence, observed, fastestSeconds), adherence, note: "ok" };
}

function makeProbe(
  id: AtlasGeneratorId,
  plan: AtlasPlan,
  fastestSeconds: number | null,
  request: ProviderRouteRequest,
): FunProbe {
  const widest = plan.sequences[0]!;
  return {
    id: `${id}:${widest.key}`,
    generator: id,
    maxProviderCalls: plan.sequences.length,
    sourceIds: widest.corridors.flatMap((corridor) => corridor.sourceIds.length > 0 ? corridor.sourceIds : [corridor.id]),
    forecast: {
      curvatureUnit: clamp01(widest.corridors.reduce((sum, corridor) => sum + corridor.francoScore, 0) / Math.max(widest.corridors.length, 1)),
      addedSeconds: fastestSeconds === null ? null : Math.max(0, widest.estimatedSeconds - fastestSeconds),
    },
    async execute(call) {
      let last: FunProbeExecution = { candidate: null, adherence: null, note: "no-path" };
      for (let attempt = 0; attempt < plan.sequences.length; attempt += 1) {
        const answer = await call(plan.requests[attempt]!);
        last = evaluateAnswer(id, answer, plan.sequences[attempt]!, fastestSeconds, request);
        if (last.candidate !== null || !RETRYABLE_NOTES.has(last.note)) return last;
      }
      return last;
    },
  };
}

function buildPlans(
  id: AtlasGeneratorId,
  context: FunGeneratorContext,
  corridors: readonly GravelAtlasCorridor[],
): readonly AtlasPlan[] {
  if (requestHasAuthoredGeometry(context.request)) return [];
  const fastest = fastestProductionSeconds(context);
  if (fastest === null && context.request.discovery === undefined) return [];
  const reachable = selectReachable(corridors, context.request, context, id);
  const speed = speedProxy(context);
  return sequenceCandidates(reachable, context.request, context, id).map((widest) => {
    const second = narrowed(widest, context.request, speed, id);
    const sequences = second === null ? [widest] : [widest, second].slice(0, MAX_ATTEMPTS_PER_PROBE);
    return { sequences, requests: sequences.map((sequence) => requestForSequence(context.request, sequence)) };
  });
}

function generatorFor(
  id: AtlasGeneratorId,
  supplied: readonly GravelAtlasCorridor[],
): FunCandidateGenerator {
  return {
    id,
    propose(context) {
      const corridors = supplied.length > 0 ? supplied : context.atlasCorridors ?? [];
      const fastest = fastestProductionSeconds(context);
      if (fastest === null && context.request.discovery === undefined) return [];
      return buildPlans(id, context, corridors)
        .slice(0, MAX_ATLAS_PROPOSALS)
        .map((plan) => makeProbe(id, plan, fastest, context.request));
    },
  };
}

/** Build the atlas generators; registration in the existing family is caller-owned. */
export function createAtlasGenerators(
  corridors: readonly GravelAtlasCorridor[],
): readonly FunCandidateGenerator[] {
  return ATLAS_GENERATOR_IDS.map((id) => generatorFor(id, corridors));
}
