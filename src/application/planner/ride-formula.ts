/** Application projection for the pure ride-formula-v1 scorer. */

import {
  analyzeFrancoCurvature,
  type FrancoCurvatureAnalysis,
} from "@/domain/geometry/franco-curvature";
import type { RouteEvidence } from "@/domain/route/types";
import {
  scoreRideFormula,
  RIDE_FORMULA_VARIABLES,
  type RideFormulaMeasurement,
  type RideFormulaPreference,
  type RideFormulaResult,
  type RideFormulaVariable,
} from "@/domain/route/ride-formula";
import {
  analyzeRideCoherence,
  type RideArcWorthwhileJudge,
} from "./ride-coherence";
import type {
  ProviderCandidate,
  ProviderRoadRun,
  ProviderRouteOptions,
} from "./route-provider";

export interface RideFormulaDiscovery {
  readonly targetMinutes: number;
  readonly toleranceMinutes: number;
}

export interface RideFormulaClosureAssessment {
  readonly trust: number | null;
  readonly confidence: number | null;
  readonly source?: string;
}

export interface RideFormulaDirtAtlasEvidence {
  readonly overlapMeters: number | null;
  readonly longestContinuousDirtMeters: number | null;
  readonly bendShare: number | null;
  readonly quality: number | null;
  readonly legalConfidence: number | null;
}

export interface RideFormulaLiveTrafficEvidence {
  readonly delayMinutes: number | null;
  readonly confidence: number | null;
}

export interface RideFormulaEnrichment {
  readonly evidence?: RouteEvidence;
  readonly canonicalEligible?: boolean;
  readonly hardFailureCodes?: readonly string[];
  readonly fastestSeconds?: number;
  readonly discovery?: RideFormulaDiscovery;
  readonly closureAssessment?: RideFormulaClosureAssessment;
  readonly francoCurvature?: FrancoCurvatureAnalysis | null;
  readonly dirtAtlas?: RideFormulaDirtAtlasEvidence;
  readonly liveTraffic?: RideFormulaLiveTrafficEvidence;
  readonly elevationTerrain?: RideFormulaMeasurement;
  readonly scenery?: RideFormulaMeasurement;
  readonly roadMemoryQuality?: RideFormulaMeasurement;
  readonly novelty?: RideFormulaMeasurement;
  readonly personalization?: {
    readonly weightAdjustments: Partial<Record<RideFormulaVariable, number>>;
    readonly confidence: number;
  };
}

const DIRT_SURFACES = new Set([
  "gravel", "fine_gravel", "compacted", "dirt", "ground", "unpaved", "earth",
]);
const SAND_SURFACES = new Set(["sand", "mud"]);
const BLOCKED_SURFACES = new Set(["sand"]);
const ROUGH_SMOOTHNESS = new Set(["bad", "very_bad", "horrible", "very_horrible", "impassable"]);
const DIRT_TRACK_GRADES = new Set(["grade1", "grade2", "grade3", "grade4"]);
const BUSY_CLASSES = new Set(["motorway", "trunk", "primary"]);

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}

function finite(value: number | null | undefined): value is number {
  return value !== null && value !== undefined && Number.isFinite(value);
}

function measurement(
  value: number | null,
  unit: string,
  source: string,
  confidence: number | null = value === null ? null : 0.7,
): RideFormulaMeasurement {
  return {
    value: value !== null && Number.isFinite(value) ? value : null,
    unit,
    source,
    confidence: finite(confidence) ? clamp01(confidence) : null,
  };
}

function runSurface(run: ProviderRoadRun): string {
  return run.surface.trim().toLowerCase();
}

function runIsDirt(run: ProviderRoadRun): boolean {
  return DIRT_SURFACES.has(runSurface(run)) ||
    (run.trackType !== null && run.trackType !== undefined && DIRT_TRACK_GRADES.has(run.trackType.toLowerCase()));
}

function runIsUnknown(run: ProviderRoadRun): boolean {
  const surface = runSurface(run);
  return surface === "" || surface === "missing" || surface === "unknown";
}

function runIsBusy(run: ProviderRoadRun): boolean {
  const roadClass = run.roadClass.trim().toLowerCase();
  return BUSY_CLASSES.has(roadClass) || run.roadClassLink === true || run.urbanDensity.toLowerCase() === "city";
}

function validRun(run: ProviderRoadRun): boolean {
  return Number.isFinite(run.meters) && run.meters > 0;
}

function totalRunMeters(runs: readonly ProviderRoadRun[]): number {
  return runs.reduce((sum, run) => sum + (validRun(run) ? run.meters : 0), 0);
}

function runSurfaceMetrics(candidate: ProviderCandidate): {
  readonly unpavedShare: number | null;
  readonly unknownShare: number | null;
  readonly busyShare: number | null;
  readonly continuousDirtMeters: number | null;
  readonly speedSweetSpotShare: number | null;
  readonly gradeRisk: number | null;
  readonly smoothnessRisk: number | null;
} {
  const summary = candidate.roadSummary;
  const runs = summary?.roadRuns;
  if (runs !== undefined && runs.length > 0) {
    const total = totalRunMeters(runs);
    if (!(total > 0)) {
      return {
        unpavedShare: null, unknownShare: null, busyShare: null, continuousDirtMeters: null,
        speedSweetSpotShare: null, gradeRisk: null, smoothnessRisk: null,
      };
    }
    let unpaved = 0;
    let unknown = 0;
    let busy = 0;
    let sweet = 0;
    let rough = 0;
    let badSurface = 0;
    let longestDirt = 0;
    let currentDirt = 0;
    for (const run of runs) {
      if (!validRun(run)) continue;
      const meters = run.meters;
      const dirt = runIsDirt(run);
      if (dirt && !SAND_SURFACES.has(runSurface(run))) {
        unpaved += meters;
        currentDirt += meters;
        longestDirt = Math.max(longestDirt, currentDirt);
      } else {
        currentDirt = 0;
      }
      if (runIsUnknown(run)) unknown += meters;
      if (runIsBusy(run)) busy += meters;
      if (finite(run.maxSpeedKmh) && run.maxSpeedKmh >= 56 && run.maxSpeedKmh <= 90) sweet += meters;
      if (run.trackType !== null && run.trackType !== undefined && /grade[3-5]/i.test(run.trackType)) rough += meters;
      if (run.smoothness !== null && run.smoothness !== undefined && ROUGH_SMOOTHNESS.has(run.smoothness.toLowerCase())) badSurface += meters;
    }
    return {
      unpavedShare: unpaved / total,
      unknownShare: unknown / total,
      busyShare: busy / total,
      continuousDirtMeters: longestDirt,
      speedSweetSpotShare: sweet / total,
      gradeRisk: rough / total,
      smoothnessRisk: badSurface / total,
    };
  }
  if (summary === undefined || !(summary.totalMeters > 0)) {
    return {
      unpavedShare: null, unknownShare: null, busyShare: null, continuousDirtMeters: null,
      speedSweetSpotShare: null, gradeRisk: null, smoothnessRisk: null,
    };
  }
  let unpaved = 0;
  let unknown = 0;
  let busy = 0;
  for (const [key, meters] of Object.entries(summary.surfaceByRoadClassMeters)) {
    if (!(meters > 0)) continue;
    const [surface = "missing", roadClass = "missing"] = key.split("|");
    if (DIRT_SURFACES.has(surface)) unpaved += meters;
    if (surface === "missing" || surface === "unknown") unknown += meters;
    if (BUSY_CLASSES.has(roadClass) || roadClass.endsWith("_link")) busy += meters;
  }
  return {
    unpavedShare: unpaved / summary.totalMeters,
    unknownShare: unknown / summary.totalMeters,
    busyShare: busy / summary.totalMeters,
    continuousDirtMeters: null,
    speedSweetSpotShare: null,
    gradeRisk: null,
    smoothnessRisk: null,
  };
}

function francoFor(
  candidate: ProviderCandidate,
  supplied: FrancoCurvatureAnalysis | null | undefined,
): FrancoCurvatureAnalysis | null {
  if (supplied !== undefined) return supplied;
  if (candidate.geometry.length < 3) return null;
  const suppressed = (candidate.instructions ?? [])
    .filter((instruction) => instruction.geometryIndex !== undefined && (
      instruction.maneuver !== undefined && instruction.maneuver !== "straight" ||
      /roundabout|junction|crossing|signal|stop|give/i.test(instruction.type)
    ))
    .flatMap((instruction) => instruction.geometryIndex === undefined ? [] : [instruction.geometryIndex]);
  return analyzeFrancoCurvature(candidate.geometry, { suppressedVertexIndices: suppressed });
}

function worthwhileJudge(
  options: ProviderRouteOptions,
): RideArcWorthwhileJudge {
  return (run): number | null => {
    const surface = runSurface(run);
    const roadClass = run.roadClass.trim().toLowerCase();
    if (surface === "" || surface === "missing" || surface === "unknown" || roadClass === "" || roadClass === "missing") return null;
    if (run.carAccess === false || run.roadAccess?.toLowerCase() === "private") return 0;
    const dirt = DIRT_SURFACES.has(surface) || (run.trackType !== null && run.trackType !== undefined && DIRT_TRACK_GRADES.has(run.trackType.toLowerCase()));
    const arterial = BUSY_CLASSES.has(roadClass) || run.roadClassLink === true;
    if (options.bike?.category === "dual-sport" || options.surfacePreference === "dirt-preferred") {
      if (SAND_SURFACES.has(surface)) return 0;
      if (dirt) return 1;
      return arterial ? 0.15 : 0.4;
    }
    if (options.roadCharacter === "curvy" || options.roadCharacter === "backroads") {
      const curved = run.curvatureRatio !== null && run.curvatureRatio !== undefined && run.curvatureRatio < 0.93;
      return arterial ? 0.15 : curved ? 0.9 : 0.55;
    }
    return arterial ? 0.35 : 0.65;
  };
}

function preferenceFor(options: ProviderRouteOptions): RideFormulaPreference {
  if (options.bike?.category === "dual-sport") return "dual-sport";
  if (options.surfacePreference === "dirt-preferred") return "gravel";
  if (options.roadCharacter === "curvy") return "curvy";
  if (options.roadCharacter === "backroads") return "backroads";
  return "balanced";
}

function targetFit(options: ProviderRouteOptions, unpavedShare: number | null): number | null {
  if (unpavedShare === null) return null;
  if (options.surfacePreference !== "dirt-preferred" && options.bike?.category !== "dual-sport") return 1 - unpavedShare;
  const target = options.targetUnpavedShare ?? 0.35;
  return clamp01(1 - Math.abs(unpavedShare - target) / Math.max(target, 1 - target));
}

function routeCoherenceMeasurement(candidate: ProviderCandidate, options: ProviderRouteOptions) {
  const diagnostics = analyzeRideCoherence({
    geometry: candidate.geometry,
    ...(candidate.instructions === undefined ? {} : { instructions: candidate.instructions }),
    ...(candidate.roadSummary === undefined ? {} : { roadSummary: candidate.roadSummary }),
    ...(candidate.roadSummary?.roadRuns === undefined ? {} : { worthwhile: worthwhileJudge(options) }),
  });
  const path = diagnostics.path;
  const route = path === null ? null : clamp01(
    1 - path.backtrackingShare * 0.7 - path.selfOverlapShare * 0.5 - (path.geometryReversalCount > 0 ? 0.2 : 0),
  );
  return { diagnostics, route };
}

function knownRoadMemory(
  evidence: RouteEvidence | undefined,
  distanceMeters: number,
): RideFormulaMeasurement | null {
  if (evidence === undefined || !(distanceMeters > 0)) return null;
  const metersFor = (key: string): number | null => {
    const value = evidence[key]?.value;
    if (typeof value !== "object" || value === null) return null;
    const meters = (value as Record<string, unknown>)["meters"];
    const ratedMeters = (value as Record<string, unknown>)["ratedMeters"];
    return typeof meters === "number" && Number.isFinite(meters)
      ? Math.max(0, meters)
      : typeof ratedMeters === "number" && Number.isFinite(ratedMeters)
        ? Math.max(0, ratedMeters)
        : null;
  };
  const named = metersFor("namedRoads");
  const gravel = metersFor("verifiedGravel");
  const meters = Math.max(named ?? 0, gravel ?? 0);
  if (!(meters > 0)) return null;
  const confidence = Math.max(
    evidence.namedRoads?.confidence ?? 0,
    evidence.verifiedGravel?.confidence ?? 0,
    evidence.knownRoadConfidence?.confidence ?? 0,
  );
  return measurement(
    clamp01(meters / distanceMeters),
    "share",
    "known-roads",
    confidence > 0 ? confidence : null,
  );
}

function derivedHardFailures(candidate: ProviderCandidate): readonly string[] {
  const runs = candidate.roadSummary?.roadRuns;
  const total = candidate.roadSummary?.totalMeters;
  if (runs === undefined || !finite(total) || !(total > 0)) return [];
  const covered = totalRunMeters(runs);
  if (covered < total * 0.99) return [];
  const failures = new Set<string>();
  for (const run of runs) {
    if (run.carAccess === false) failures.add("no-car-access");
    const access = run.roadAccess?.toLowerCase() ?? "";
    if (access === "private" || access === "no") failures.add("private-or-closed-road");
    if (BLOCKED_SURFACES.has(runSurface(run))) failures.add("sand-surface");
  }
  return [...failures].sort();
}

function put(
  variables: Partial<Record<RideFormulaVariable, RideFormulaMeasurement>>,
  key: RideFormulaVariable,
  value: number | null,
  unit: string,
  source: string,
  confidence?: number | null,
): void {
  variables[key] = measurement(value, unit, source, confidence);
}

/** Project one provider candidate into formula-v1 and score it. */
export function scoreCandidateWithRideFormula(
  candidate: ProviderCandidate,
  options: ProviderRouteOptions,
  enrichment: RideFormulaEnrichment = {},
): RideFormulaResult {
  const variables: Partial<Record<RideFormulaVariable, RideFormulaMeasurement>> = {};
  const road = runSurfaceMetrics(candidate);
  const franco = francoFor(candidate, enrichment.francoCurvature);
  const coherence = routeCoherenceMeasurement(candidate, options);
  const arc = coherence.diagnostics.arc;
  const summaryConfidence = candidate.roadSummary === undefined ? null : 0.7;

  put(variables, "unpavedShare", road.unpavedShare, "share", "graphhopper-road-runs", summaryConfidence);
  put(variables, "unknownSurfaceShare", road.unknownShare, "share", "graphhopper-road-runs", summaryConfidence);
  put(variables, "busyRoadShare", road.busyShare, "share", "graphhopper-road-runs", summaryConfidence);
  put(variables, "continuousDirtMeters", enrichment.dirtAtlas?.longestContinuousDirtMeters ?? road.continuousDirtMeters, "m", enrichment.dirtAtlas === undefined ? "graphhopper-road-runs" : "gravel-atlas", enrichment.dirtAtlas?.legalConfidence ?? summaryConfidence);
  put(variables, "speedSweetSpotShare", road.speedSweetSpotShare, "share", "graphhopper-road-runs", summaryConfidence);
  put(variables, "gradeRisk", road.gradeRisk, "share", "graphhopper-road-runs", summaryConfidence);
  put(variables, "smoothnessRisk", road.smoothnessRisk, "share", "graphhopper-road-runs", summaryConfidence);
  put(variables, "surfaceTargetFit", targetFit(options, road.unpavedShare), "share", "rider-surface-intent", road.unpavedShare === null ? null : 1);

  put(variables, "francoTotalCurvature", franco?.totalCurvature ?? null, "curvature-m", "franco-v1", franco === null ? null : candidate.geometry.length > 3 ? 0.7 : 0.45);
  put(variables, "francoCurvaturePerKm", franco?.curvaturePerKm ?? null, "curvature-m/km", "franco-v1", franco === null ? null : candidate.geometry.length > 3 ? 0.7 : 0.45);
  put(variables, "bendShare", franco?.bendShare ?? null, "share", "franco-v1", franco === null ? null : 0.7);
  put(variables, "curvatureContinuity", franco === null || franco.totalCurvature <= 0 ? null : clamp01(franco.longestRunMeters / Math.max(franco.bendMeters, 1)), "share", "franco-v1", franco === null ? null : 0.7);
  put(variables, "sustainedRunMeters", franco?.longestRunMeters ?? null, "m", "franco-v1", franco === null ? null : 0.7);
  put(variables, "routeCoherence", coherence.route, "share", "ride-coherence", coherence.route === null ? null : 0.7);

  put(variables, "urbanEscapeMinutes", arc?.escape === null || arc === null ? null : arc.escape.durationSeconds / 60, "minutes", "ride-arc", arc === null ? null : 0.7);
  put(variables, "coreQualityShare", arc?.coreWorthwhileShare ?? null, "share", "ride-arc", arc === null ? null : 0.7);
  const slack = enrichment.discovery === undefined || !finite(enrichment.discovery.targetMinutes)
    ? null
    : enrichment.discovery.targetMinutes - candidate.durationSeconds / 60;
  put(variables, "arrivalSlackMinutes", slack, "minutes", "discovery-timebox", slack === null ? null : 1);
  put(variables, "returnSlackMinutes", slack, "minutes", "discovery-timebox", slack === null ? null : 1);

  const distance10Km = Math.max(candidate.distanceMeters / 10_000, 0.1);
  const maneuverCount = coherence.diagnostics.path?.maneuverCount;
  put(variables, "stopDensityPer10Km", maneuverCount === null || maneuverCount === undefined ? null : maneuverCount / distance10Km, "maneuvers/10km", "route-instructions", maneuverCount === null || maneuverCount === undefined ? null : 0.65);
  put(variables, "liveCongestionDelayMinutes", enrichment.liveTraffic?.delayMinutes ?? null, "minutes", "tomtom-flow", enrichment.liveTraffic?.confidence ?? null);

  const atlas = enrichment.dirtAtlas;
  put(variables, "dirtCorridorQuality", atlas?.quality ?? null, "share", "gravel-atlas", atlas?.legalConfidence ?? null);
  put(variables, "elevationTerrain", enrichment.elevationTerrain?.value ?? null, enrichment.elevationTerrain?.unit ?? "share", enrichment.elevationTerrain?.source ?? "elevation", enrichment.elevationTerrain?.confidence ?? null);
  put(variables, "scenery", enrichment.scenery?.value ?? null, enrichment.scenery?.unit ?? "share", enrichment.scenery?.source ?? "scenery", enrichment.scenery?.confidence ?? null);
  const memory = enrichment.roadMemoryQuality ?? knownRoadMemory(enrichment.evidence, candidate.distanceMeters);
  put(variables, "roadMemoryQuality", memory?.value ?? null, memory?.unit ?? "share", memory?.source ?? "road-memory", memory?.confidence ?? null);
  put(variables, "novelty", enrichment.novelty?.value ?? null, enrichment.novelty?.unit ?? "share", enrichment.novelty?.source ?? "road-memory", enrichment.novelty?.confidence ?? null);
  put(variables, "trust", enrichment.closureAssessment?.trust ?? null, "share", enrichment.closureAssessment?.source ?? "closure-assessment", enrichment.closureAssessment?.confidence ?? null);
  const observed = Object.values(variables).filter((value) => value?.value !== null).length;
  put(variables, "evidenceCoverage", observed / RIDE_FORMULA_VARIABLES.length, "share", "formula-evidence", observed === 0 ? null : 0.8);
  const fastest = enrichment.fastestSeconds;
  put(variables, "timeCost", finite(fastest) && fastest > 0 ? candidate.durationSeconds / fastest : null, "ratio", "candidate-duration", finite(fastest) && fastest > 0 ? 1 : null);

  return scoreRideFormula({
    preference: preferenceFor(options),
    canonicalEligible: enrichment.canonicalEligible ?? true,
    hardFailureCodes: [...new Set([...(enrichment.hardFailureCodes ?? []), ...derivedHardFailures(candidate)])],
    variables,
    ...(enrichment.personalization === undefined ? {} : { personalization: enrichment.personalization }),
  });
}
