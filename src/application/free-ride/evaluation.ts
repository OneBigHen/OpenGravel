import {
  isUsableEvidence,
  unavailableEvidence,
  unknownEvidence,
  type EvidenceValue,
} from "@/domain/evidence/types";
import { haversine } from "@/domain/geometry/analysis";
import type { Coordinate } from "@/domain/ride/types";
import type {
  EligibilityFailureCode,
  EligibilityWarningCode,
  RouteEligibility,
} from "@/domain/route/eligibility";
import type { RouteEvidence } from "@/domain/route/types";
import type {
  FreeRideCandidateEvidence,
  FreeRideEvidenceContext,
} from "./types";

const UNKNOWN_REASONS = {
  surfaceFit: "No usable surface evidence covers this loop.",
  terrainCompatibility: "No usable terrain evidence covers this loop.",
  bikeCompatibility: "No usable bike-compatibility evidence covers this loop.",
  roadCharacterFit: "No usable road-character evidence covers this loop.",
  novelty: "No personal ride-history evidence covers this loop.",
  weatherSuitability: "No applicable weather evidence covers this loop.",
} as const;

export function normalizeFreeRideEvidence(
  evidence: Partial<FreeRideCandidateEvidence>,
): FreeRideCandidateEvidence {
  return {
    surfaceFit: evidence.surfaceFit ?? unknownEvidence(UNKNOWN_REASONS.surfaceFit),
    terrainCompatibility:
      evidence.terrainCompatibility ?? unknownEvidence(UNKNOWN_REASONS.terrainCompatibility),
    bikeCompatibility:
      evidence.bikeCompatibility ?? unknownEvidence(UNKNOWN_REASONS.bikeCompatibility),
    roadCharacterFit:
      evidence.roadCharacterFit ?? unknownEvidence(UNKNOWN_REASONS.roadCharacterFit),
    novelty: evidence.novelty ?? unknownEvidence(UNKNOWN_REASONS.novelty),
    weatherSuitability:
      evidence.weatherSuitability ?? unknownEvidence(UNKNOWN_REASONS.weatherSuitability),
  };
}

export function unavailableFreeRideEvidence(): FreeRideCandidateEvidence {
  return {
    surfaceFit: unavailableEvidence(),
    terrainCompatibility: unavailableEvidence(),
    bikeCompatibility: unavailableEvidence(),
    roadCharacterFit: unavailableEvidence(),
    novelty: unavailableEvidence(),
    weatherSuitability: unavailableEvidence(),
  };
}

function isFalse(evidence: EvidenceValue<boolean>): boolean {
  return isUsableEvidence(evidence) && evidence.value === false;
}

function isLowFit(evidence: EvidenceValue<number>): boolean {
  return (
    isUsableEvidence(evidence) &&
    evidence.value !== null &&
    Number.isFinite(evidence.value) &&
    evidence.value < 0.5
  );
}

export function evaluateFreeRideEligibility(
  facts: FreeRideCandidateEvidence,
  context: FreeRideEvidenceContext,
): RouteEligibility {
  const failures: {
    readonly code: EligibilityFailureCode;
    readonly message: string;
  }[] = [];
  const warnings: {
    readonly code: EligibilityWarningCode;
    readonly message: string;
  }[] = [];

  if (isFalse(facts.bikeCompatibility)) {
    failures.push({
      code: "bike-incompatible",
      message: "Candidate evidence contradicts a hard bike constraint.",
    });
  }
  if (isFalse(facts.terrainCompatibility)) {
    failures.push({
      code: "terrain-incompatible",
      message: "Candidate evidence contradicts the requested terrain tolerance.",
    });
  }
  if (isLowFit(facts.surfaceFit)) {
    warnings.push({
      code: "surface-preference-mismatch",
      message: "The measured surface evidence does not fit the requested preference.",
    });
  } else if (
    !isUsableEvidence(facts.surfaceFit) &&
    (context.surface.unknownSurfacePolicy === "avoid-when-possible" ||
      context.surface.targetUnpavedShare !== undefined)
  ) {
    warnings.push({
      code: "surface-evidence-unverifiable",
      message: "Surface evidence is insufficient to verify the requested preference.",
    });
  }
  if (isLowFit(facts.roadCharacterFit)) {
    warnings.push({
      code: "road-character-mismatch",
      message: "The measured road character does not fit the requested preference.",
    });
  }
  if (
    context.weatherPreference === "avoid-adverse" &&
    isLowFit(facts.weatherSuitability)
  ) {
    warnings.push({
      code: "weather-preference-mismatch",
      message: "Applicable weather evidence lowers this loop's suitability.",
    });
  }

  return {
    eligible: failures.length === 0,
    failures,
    warnings,
  };
}

export function freeRideRouteEvidence(
  facts: FreeRideCandidateEvidence,
): RouteEvidence {
  return {
    surfaceMix: facts.surfaceFit,
    difficultyCoverage: facts.terrainCompatibility,
    knownRoadConfidence: facts.bikeCompatibility,
    roadClassMix: facts.roadCharacterFit,
    novelty: facts.novelty,
    weatherExposure: facts.weatherSuitability,
  };
}

function interpolate(start: Coordinate, end: Coordinate, share: number): Coordinate {
  return {
    lon: start.lon + (end.lon - start.lon) * share,
    lat: start.lat + (end.lat - start.lat) * share,
  };
}

/** The middle 70% by traveled distance, excluding unavoidable local egress/return. */
export function coreRidingSection(
  geometry: readonly Coordinate[],
): readonly Coordinate[] {
  if (geometry.length < 4) return geometry;
  const segmentLengths: number[] = [];
  let total = 0;
  for (let index = 0; index + 1 < geometry.length; index += 1) {
    const start = geometry[index];
    const end = geometry[index + 1];
    if (start === undefined || end === undefined) continue;
    const length = haversine(start, end);
    segmentLengths.push(length);
    total += length;
  }
  if (!Number.isFinite(total) || total <= 0) return geometry;

  const from = total * 0.15;
  const to = total * 0.85;
  const core: Coordinate[] = [];
  let traveled = 0;
  for (let index = 0; index < segmentLengths.length; index += 1) {
    const start = geometry[index];
    const end = geometry[index + 1];
    const length = segmentLengths[index];
    if (start === undefined || end === undefined || length === undefined || length <= 0) {
      continue;
    }
    const segmentEnd = traveled + length;
    if (segmentEnd < from) {
      traveled = segmentEnd;
      continue;
    }
    if (traveled > to) break;
    const startShare = Math.max(0, (from - traveled) / length);
    const endShare = Math.min(1, (to - traveled) / length);
    if (core.length === 0) core.push(interpolate(start, end, startShare));
    if (endShare === 1) {
      core.push({ lon: end.lon, lat: end.lat });
    } else {
      core.push(interpolate(start, end, endShare));
      break;
    }
    traveled = segmentEnd;
  }
  return core.length >= 2 ? core : geometry;
}
