/**
 * The deterministic rider-value formula used by the Phase 2 experiments.
 *
 * This module only consumes measured values. A missing value remains null and
 * contributes neither evidence nor a fabricated neutral preference. The
 * application adapter owns turning provider facts into these measurements.
 */

export const RIDE_FORMULA_VERSION = "ride-formula-v1" as const;

export type RideFormulaPreference =
  | "balanced"
  | "gravel"
  | "dual-sport"
  | "curvy"
  | "backroads";

export const RIDE_FORMULA_VARIABLES = [
  "urbanEscapeMinutes",
  "coreQualityShare",
  "arrivalSlackMinutes",
  "returnSlackMinutes",
  "francoTotalCurvature",
  "francoCurvaturePerKm",
  "bendShare",
  "curvatureContinuity",
  "sustainedRunMeters",
  "routeCoherence",
  "speedSweetSpotShare",
  "stopDensityPer10Km",
  "busyRoadShare",
  "liveCongestionDelayMinutes",
  "unpavedShare",
  "surfaceTargetFit",
  "continuousDirtMeters",
  "dirtCorridorQuality",
  "gradeRisk",
  "smoothnessRisk",
  "unknownSurfaceShare",
  "elevationTerrain",
  "scenery",
  "roadMemoryQuality",
  "novelty",
  "trust",
  "evidenceCoverage",
  "timeCost",
] as const;

export type RideFormulaVariable = (typeof RIDE_FORMULA_VARIABLES)[number];

export interface RideFormulaMeasurement {
  /** Raw measured value in `unit`; null means the source did not establish it. */
  readonly value: number | null;
  /** Unit is part of the diagnostic contract: meters, minutes, share, or ratio. */
  readonly unit: string;
  readonly confidence: number | null;
  readonly source: string;
}

export interface RideFormulaInput {
  readonly preference: RideFormulaPreference;
  readonly canonicalEligible: boolean;
  readonly hardFailureCodes: readonly string[];
  readonly variables: Partial<Record<RideFormulaVariable, RideFormulaMeasurement>>;
  /** Signed posterior adjustments, bounded by the formula before application. */
  readonly personalization?: {
    readonly weightAdjustments: Partial<Record<RideFormulaVariable, number>>;
    readonly confidence: number;
  };
}

export interface RideFormulaVariableResult extends RideFormulaMeasurement {
  /** Comparable `0..1` term after unit-aware normalization. */
  readonly normalized: number | null;
}

export interface RideFormulaResult {
  readonly version: typeof RIDE_FORMULA_VERSION;
  /** Comparable rider value on a `0..100` scale. */
  readonly value: number;
  /** Evidence confidence on a `0..1` scale. */
  readonly confidence: number;
  /** Canonical eligibility is preserved; formula value cannot promote a failure. */
  readonly eligible: boolean;
  readonly variables: Record<RideFormulaVariable, RideFormulaVariableResult>;
  /** Effective normalized weights, including any bounded personalization. */
  readonly weights: Record<RideFormulaVariable, number>;
}

type WeightTable = Readonly<Record<RideFormulaVariable, number>>;

const zeroWeights = (): Record<RideFormulaVariable, number> =>
  Object.fromEntries(RIDE_FORMULA_VARIABLES.map((variable) => [variable, 0])) as Record<RideFormulaVariable, number>;

/*
 * Initial policy weights, calibrated only against the recorded routing corpus
 * (without rider labels). They are intentionally explicit and exported in the
 * result so the corpus benchmark can report the exact policy applied to a
 * candidate. Dirt continuity and Franco curvature are the strongest terms for
 * the two modes where the product promises a dirt or backroad ride.
 */
const WEIGHTS: Readonly<Record<RideFormulaPreference, WeightTable>> = {
  balanced: {
    urbanEscapeMinutes: 0.04, coreQualityShare: 0.08, arrivalSlackMinutes: 0.03, returnSlackMinutes: 0.03,
    francoTotalCurvature: 0.08, francoCurvaturePerKm: 0.03, bendShare: 0.03, curvatureContinuity: 0.06,
    sustainedRunMeters: 0.04, routeCoherence: 0.08, speedSweetSpotShare: 0.06, stopDensityPer10Km: 0.04,
    busyRoadShare: 0.08, liveCongestionDelayMinutes: 0.03, unpavedShare: 0.03, surfaceTargetFit: 0.04,
    continuousDirtMeters: 0.03, dirtCorridorQuality: 0.02, gradeRisk: 0.02, smoothnessRisk: 0.02,
    unknownSurfaceShare: 0.02, elevationTerrain: 0.02, scenery: 0.02, roadMemoryQuality: 0.02,
    novelty: 0.02, trust: 0.06, evidenceCoverage: 0.04, timeCost: 0.08,
  },
  gravel: {
    urbanEscapeMinutes: 0.02, coreQualityShare: 0.06, arrivalSlackMinutes: 0.02, returnSlackMinutes: 0.02,
    francoTotalCurvature: 0.11, francoCurvaturePerKm: 0.04, bendShare: 0.03, curvatureContinuity: 0.06,
    sustainedRunMeters: 0.05, routeCoherence: 0.05, speedSweetSpotShare: 0.03, stopDensityPer10Km: 0.02,
    busyRoadShare: 0.04, liveCongestionDelayMinutes: 0.02, unpavedShare: 0.12, surfaceTargetFit: 0.13,
    continuousDirtMeters: 0.15, dirtCorridorQuality: 0.08, gradeRisk: 0.02, smoothnessRisk: 0.01,
    unknownSurfaceShare: 0.02, elevationTerrain: 0.01, scenery: 0.01, roadMemoryQuality: 0.02,
    novelty: 0.01, trust: 0.05, evidenceCoverage: 0.04, timeCost: 0.06,
  },
  "dual-sport": {
    urbanEscapeMinutes: 0.02, coreQualityShare: 0.05, arrivalSlackMinutes: 0.02, returnSlackMinutes: 0.02,
    francoTotalCurvature: 0.1, francoCurvaturePerKm: 0.04, bendShare: 0.03, curvatureContinuity: 0.05,
    sustainedRunMeters: 0.05, routeCoherence: 0.05, speedSweetSpotShare: 0.02, stopDensityPer10Km: 0.02,
    busyRoadShare: 0.03, liveCongestionDelayMinutes: 0.01, unpavedShare: 0.11, surfaceTargetFit: 0.11,
    continuousDirtMeters: 0.16, dirtCorridorQuality: 0.09, gradeRisk: 0.02, smoothnessRisk: 0.02,
    unknownSurfaceShare: 0.02, elevationTerrain: 0.02, scenery: 0.01, roadMemoryQuality: 0.02,
    novelty: 0.01, trust: 0.05, evidenceCoverage: 0.04, timeCost: 0.06,
  },
  curvy: {
    urbanEscapeMinutes: 0.04, coreQualityShare: 0.08, arrivalSlackMinutes: 0.02, returnSlackMinutes: 0.02,
    francoTotalCurvature: 0.2, francoCurvaturePerKm: 0.08, bendShare: 0.05, curvatureContinuity: 0.12,
    sustainedRunMeters: 0.08, routeCoherence: 0.1, speedSweetSpotShare: 0.05, stopDensityPer10Km: 0.04,
    busyRoadShare: 0.05, liveCongestionDelayMinutes: 0.01, unpavedShare: 0.01, surfaceTargetFit: 0.02,
    continuousDirtMeters: 0.01, dirtCorridorQuality: 0.01, gradeRisk: 0.01, smoothnessRisk: 0.01,
    unknownSurfaceShare: 0.01, elevationTerrain: 0.02, scenery: 0.02, roadMemoryQuality: 0.02,
    novelty: 0.01, trust: 0.05, evidenceCoverage: 0.04, timeCost: 0.07,
  },
  backroads: {
    urbanEscapeMinutes: 0.06, coreQualityShare: 0.08, arrivalSlackMinutes: 0.02, returnSlackMinutes: 0.02,
    francoTotalCurvature: 0.18, francoCurvaturePerKm: 0.07, bendShare: 0.04, curvatureContinuity: 0.1,
    sustainedRunMeters: 0.07, routeCoherence: 0.11, speedSweetSpotShare: 0.05, stopDensityPer10Km: 0.05,
    busyRoadShare: 0.08, liveCongestionDelayMinutes: 0.01, unpavedShare: 0.01, surfaceTargetFit: 0.02,
    continuousDirtMeters: 0.01, dirtCorridorQuality: 0.01, gradeRisk: 0.01, smoothnessRisk: 0.01,
    unknownSurfaceShare: 0.01, elevationTerrain: 0.01, scenery: 0.02, roadMemoryQuality: 0.03,
    novelty: 0.02, trust: 0.05, evidenceCoverage: 0.04, timeCost: 0.07,
  },
};

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}

function finite(value: number | null | undefined): value is number {
  return value !== null && value !== undefined && Number.isFinite(value);
}

function normalize(variable: RideFormulaVariable, value: number): number {
  switch (variable) {
    case "urbanEscapeMinutes": return 1 - clamp01(value / 60);
    case "arrivalSlackMinutes":
    case "returnSlackMinutes": return clamp01((value + 30) / 60);
    case "francoTotalCurvature": return clamp01(value / 1_000);
    case "francoCurvaturePerKm": return clamp01(value / 1_000);
    case "bendShare":
    case "curvatureContinuity":
    case "routeCoherence":
    case "coreQualityShare":
    case "speedSweetSpotShare":
    case "surfaceTargetFit":
    case "dirtCorridorQuality":
    case "elevationTerrain":
    case "scenery":
    case "roadMemoryQuality":
    case "novelty":
    case "trust":
    case "evidenceCoverage": return clamp01(value);
    case "sustainedRunMeters":
    case "continuousDirtMeters": return clamp01(value / 4_000);
    case "stopDensityPer10Km": return 1 - clamp01(value / 25);
    case "busyRoadShare":
    case "unpavedShare":
    case "gradeRisk":
    case "smoothnessRisk":
    case "unknownSurfaceShare": return 1 - clamp01(value);
    case "liveCongestionDelayMinutes": return 1 - clamp01(value / 30);
    case "timeCost": return 1 - clamp01(value - 1);
  }
}

function effectiveWeights(input: RideFormulaInput): Record<RideFormulaVariable, number> {
  const weights = zeroWeights();
  const base = WEIGHTS[input.preference];
  let total = 0;
  for (const variable of RIDE_FORMULA_VARIABLES) {
    const adjustment = input.personalization?.weightAdjustments[variable];
    const bounded = finite(adjustment) ? Math.max(-0.25, Math.min(0.25, adjustment)) : 0;
    const confidence = input.personalization === undefined
      ? 1
      : clamp01(input.personalization.confidence);
    const value = (base[variable] ?? 0) * (1 + bounded * confidence);
    weights[variable] = value;
    total += value;
  }
  if (total > 0) {
    for (const variable of RIDE_FORMULA_VARIABLES) weights[variable] /= total;
  }
  return weights;
}

function measurementResult(
  variable: RideFormulaVariable,
  measurement: RideFormulaMeasurement | undefined,
): RideFormulaVariableResult {
  if (measurement === undefined || !finite(measurement.value)) {
    return {
      value: null,
      unit: measurement?.unit ?? "unknown",
      confidence: null,
      source: measurement?.source ?? "unknown",
      normalized: null,
    };
  }
  const confidence = finite(measurement.confidence) ? clamp01(measurement.confidence) : 0;
  return {
    ...measurement,
    value: measurement.value,
    confidence,
    normalized: normalize(variable, measurement.value),
  };
}

/** Score one candidate's measured rider value without consulting process state. */
export function scoreRideFormula(input: RideFormulaInput): RideFormulaResult {
  const weights = effectiveWeights(input);
  const variables = zeroWeights() as unknown as Record<RideFormulaVariable, RideFormulaVariableResult>;
  let weightedValue = 0;
  let observedWeight = 0;
  let confidenceWeight = 0;
  for (const variable of RIDE_FORMULA_VARIABLES) {
    const result = measurementResult(variable, input.variables[variable]);
    variables[variable] = result;
    const weight = weights[variable] ?? 0;
    if (result.normalized === null || result.confidence === null || result.confidence <= 0) continue;
    observedWeight += weight;
    confidenceWeight += weight * result.confidence;
    weightedValue += weight * result.normalized * result.confidence;
  }
  const value = weightedValue * 100;
  const confidence = clamp01((observedWeight + confidenceWeight) / 2);
  return {
    version: RIDE_FORMULA_VERSION,
    value: Number(value.toFixed(4)),
    confidence: Number(confidence.toFixed(4)),
    eligible: input.canonicalEligible && input.hardFailureCodes.length === 0,
    variables,
    weights,
  };
}
