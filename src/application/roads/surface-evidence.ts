/**
 * RoadEvidenceRecord → surface-domain adapter (07 §2/§4–§7; Task 6.3).
 *
 * The read model keeps its legacy source vocabulary and raw values. This seam
 * declares the source weight and converts those reports into the pure taxonomy
 * aggregator. Generated route rows remain visible in provenance but are always
 * zero-weight.
 */

import {
  aggregateSurface,
  type SurfaceAggregationOptions,
  type SurfaceAssessment,
  type SurfaceBand,
  type SurfaceEvidence,
} from "@/domain/roads/surface";
import { isUsableEvidence, type EvidenceValue } from "@/domain/evidence/types";
import type { RoadEvidenceRecord, RoadEvidenceSource } from "./road-evidence";

export type RoadSurfaceEvidenceInput = RoadEvidenceRecord;

const SOURCE_WEIGHTS: Readonly<Record<RoadEvidenceSource, number>> = {
  "official-authority": 1,
  osm: 0.75,
  "gravel-atlas": 0.9,
  "road-span": 0.6,
  "recorded-ride": 0.8,
  "import": 0.2,
  "route-corpus": 0.2,
  "generated-route": 0,
};

const SOURCE_LABELS: Readonly<Record<RoadEvidenceSource, string>> = {
  "official-authority": "Official authority",
  osm: "OpenStreetMap",
  "gravel-atlas": "Gravel Atlas",
  "road-span": "Road span",
  "recorded-ride": "Recorded ride",
  import: "Imported track",
  "route-corpus": "Route corpus",
  "generated-route": "Generated route",
};

/** Adapts one legacy report without changing or dropping the original record. */
export function surfaceEvidenceFromRoadEvidence(
  record: RoadSurfaceEvidenceInput,
): SurfaceEvidence {
  return {
    id: record.id,
    value: record.value,
    source: record.source,
    ...(record.sourceId === undefined && record.contributorId === undefined
      ? {}
      : { sourceKey: record.sourceId ?? record.contributorId }),
    sourceLabel: SOURCE_LABELS[record.source],
    observedAt: record.observedAt,
    weight: record.source === "generated-route" ? 0 : SOURCE_WEIGHTS[record.source],
    confidence: record.confidence,
    ...(record.stalenessWindowDays === undefined
      ? {}
      : { stalenessWindowDays: record.stalenessWindowDays }),
    ...(record.stalenessWindowMs === undefined
      ? {}
      : { stalenessWindowMs: record.stalenessWindowMs }),
    ...(record.expiresAt === undefined ? {} : { expiresAt: record.expiresAt }),
  };
}

export function aggregateRoadSurface(
  records: readonly RoadSurfaceEvidenceInput[],
  options: SurfaceAggregationOptions = {},
): SurfaceAssessment {
  return aggregateSurface(
    records
      .filter((record) => record.aspect === undefined || record.aspect === "surface")
      .map(surfaceEvidenceFromRoadEvidence),
    options,
  );
}

/** Projects the route pipeline's keyed evidence without treating geometry as evidence. */
export function aggregateRouteSurface(
  evidence: EvidenceValue<unknown> | undefined,
): SurfaceAssessment {
  if (evidence === undefined || evidence.value === null || evidence.status === "unknown"
    || evidence.status === "unavailable" || evidence.status === "stale") {
    return aggregateSurface([]);
  }
  const rawValue = typeof evidence.value === "string"
    ? evidence.value
    : typeof evidence.value === "object" && evidence.value !== null
      ? (() => {
          const value = evidence.value as Record<string, unknown>;
          return typeof value.surface === "string"
            ? value.surface
            : typeof value.surfaceClass === "string"
              ? value.surfaceClass
              : null;
        })()
      : null;
  if (rawValue === null) return aggregateSurface([]);
  return aggregateSurface(evidence.provenance.map((source) => ({
    id: source.id,
    value: rawValue,
    source: source.id,
    sourceLabel: source.label,
    confidence: evidence.confidence,
    observedAt: source.observedAt ?? evidence.observedAt,
  })));
}

export function surfaceBandLabel(band: SurfaceBand): string {
  return `Surface ${band}`;
}

/**
 * The share of a route's length a usable surface report actually covers (0..1).
 *
 * - `0` when there is no usable claim at all (07 §2 rule 2), which is also when
 *   the aggregated value is `unknown` — a conflicting, unrecognized or absent
 *   report verifies nothing, so the badge and the mileage can never disagree;
 * - the report's own `coverage` when it stated one;
 * - `null` when a usable report did **not** state a share. The share is then
 *   unknown, which is a different fact from "covers everything" and must not be
 *   rounded to either end (`OGV-D-251`).
 */
function verifiedSurfaceShare(
  evidence: EvidenceValue<unknown> | undefined,
): number | null {
  if (evidence === undefined || !isUsableEvidence(evidence)) return 0;
  if (aggregateRouteSurface(evidence).value === "unknown") return 0;
  const coverage = evidence.coverage;
  if (coverage === undefined || !Number.isFinite(coverage)) return null;
  return Math.max(0, Math.min(1, coverage));
}

/**
 * How much of a route's length has no verified surface, in meters — 07 §5's
 * `coverage` column reduced to the one number a rider reads (04 §11/§13).
 *
 * `null` means the question is not answerable from the evidence at hand (an
 * unmeasurable length, or a usable report that never stated its coverage), and
 * every caller renders that as "not measured" rather than as zero.
 */
export function unverifiedSurfaceMeters(
  evidence: EvidenceValue<unknown> | undefined,
  distanceMeters: number,
): number | null {
  if (!Number.isFinite(distanceMeters) || distanceMeters < 0) return null;
  const verified = verifiedSurfaceShare(evidence);
  return verified === null ? null : distanceMeters * (1 - verified);
}

export function surfaceValueLabel(assessment: SurfaceAssessment): string {
  return assessment.value === "unknown" ? "Surface unknown" : assessment.value;
}
