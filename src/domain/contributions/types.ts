import type { RoadEntityId, RoadSpanId } from "../ride/ids";

export const CONTRIBUTION_KINDS = ["surface", "gate", "condition"] as const;
export type ContributionKind = (typeof CONTRIBUTION_KINDS)[number];

/** The detailed surface vocabulary is reduced by 6.3's taxonomy adapter. */
export const CONTRIBUTION_SURFACE_VALUES = [
  "paved-smooth",
  "paved-rough",
  "chip-seal",
  "maintained-gravel",
  "compacted",
  "loose-gravel",
  "dirt",
  "rough-track",
  "sand",
  "mud-prone",
  "rock",
  "unknown",
] as const;
export type ContributionSurfaceValue = (typeof CONTRIBUTION_SURFACE_VALUES)[number];

export const CONTRIBUTION_GATE_VALUES = ["open", "closed", "locked", "unknown"] as const;
export type ContributionGateValue = (typeof CONTRIBUTION_GATE_VALUES)[number];

export const CONTRIBUTION_CONDITION_SEVERITIES = ["minor", "moderate", "severe"] as const;
export type ContributionConditionSeverity = (typeof CONTRIBUTION_CONDITION_SEVERITIES)[number];

/** Deliberately coarse trust labels; they are not public reputation scores. */
export const CONTRIBUTION_EVIDENCE_LEVELS = ["low", "medium", "high"] as const;
export type ContributionEvidenceLevel = (typeof CONTRIBUTION_EVIDENCE_LEVELS)[number];

export interface ContributionRoadRef {
  readonly roadId: RoadEntityId;
  readonly spanId: RoadSpanId;
}

export interface ContributionProvenance {
  /** A locally minted UUID; it is not an email, account id, or display name. */
  readonly contributorPseudoId: string;
  readonly clientVersion: string;
  readonly evidenceLevel: ContributionEvidenceLevel;
}

interface ContributionBase {
  readonly roadRef: ContributionRoadRef;
  readonly observedAt: string;
  /** Accuracy of the observation location in meters, not a geometry payload. */
  readonly gps_precision_m: number;
  readonly provenance: ContributionProvenance;
}

export interface SurfaceContribution extends ContributionBase {
  readonly kind: "surface";
  readonly value: ContributionSurfaceValue;
}

export interface GateContribution extends ContributionBase {
  readonly kind: "gate";
  readonly value: ContributionGateValue;
}

export interface ConditionContribution extends ContributionBase {
  readonly kind: "condition";
  readonly value: {
    readonly tag: string;
    readonly severity: ContributionConditionSeverity;
    readonly note?: string;
  };
}

/** A bounded evidence submission, not a profile, post, or social object. */
export type ContributionEnvelope =
  | SurfaceContribution
  | GateContribution
  | ConditionContribution;

export function newContributorPseudoId(): string {
  return crypto.randomUUID();
}
