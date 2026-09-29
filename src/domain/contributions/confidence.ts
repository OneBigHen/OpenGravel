import type { ContributionEvidenceLevel, ContributionKind } from "./types";

export type ContributionConfidenceBand = "possible" | "likely";

export interface ContributionConfidenceMapping {
  readonly confidence: number;
  readonly band: ContributionConfidenceBand;
  readonly stalenessWindowDays: number;
}

export const CONTRIBUTION_STALENESS_WINDOW_DAYS: Readonly<Record<ContributionKind, number>> = {
  surface: 30,
  gate: 7,
  condition: 14,
};

/** One contribution never reaches 6.3's confirmed band by itself. */
const CONFIDENCE_BY_LEVEL: Readonly<Record<ContributionEvidenceLevel, ContributionConfidenceMapping>> = {
  low: { confidence: 0.35, band: "possible", stalenessWindowDays: 30 },
  medium: { confidence: 0.65, band: "likely", stalenessWindowDays: 30 },
  high: { confidence: 0.85, band: "likely", stalenessWindowDays: 30 },
};

export function contributionConfidenceFor(
  level: ContributionEvidenceLevel,
  kind: ContributionKind = "surface",
): ContributionConfidenceMapping {
  return {
    ...CONFIDENCE_BY_LEVEL[level],
    stalenessWindowDays: CONTRIBUTION_STALENESS_WINDOW_DAYS[kind],
  };
}
