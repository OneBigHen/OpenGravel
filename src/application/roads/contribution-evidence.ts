import {
  contributionConfidenceFor,
  type ContributionEnvelope,
} from "@/domain/contributions";
import type { RoadEvidenceRecord } from "./road-evidence";

/** Maps one validated contribution into the 6.3 report/read-model shape. */
export function contributionToRoadEvidence(
  id: string,
  contribution: ContributionEnvelope,
): RoadEvidenceRecord | null {
  if (contribution.kind === "condition" && contribution.value.tag === "comment") return null;
  const mapping = contributionConfidenceFor(
    contribution.provenance.evidenceLevel,
    contribution.kind,
  );
  const value = contribution.kind === "condition"
    ? `${contribution.value.tag}:${contribution.value.severity}`
    : contribution.value;
  return {
    id,
    entityId: contribution.roadRef.roadId,
    spanId: contribution.roadRef.spanId,
    source: "recorded-ride",
    sourceId: contribution.provenance.contributorPseudoId,
    contributorId: contribution.provenance.contributorPseudoId,
    observedAt: contribution.observedAt,
    aspect: contribution.kind === "surface"
      ? "surface"
      : contribution.kind === "gate"
        ? "access"
        : "condition",
    value,
    confidence: mapping.confidence,
    stalenessWindowDays: mapping.stalenessWindowDays,
    gpsPrecisionM: contribution.gps_precision_m,
  };
}
