/**
 * Conflict-aware evidence aggregation for RoadEntity (07 §2/§5–§7; Task 6.2).
 *
 * Evidence is stored as reports, not as one mutable road fact. Aggregation keeps
 * those reports visible, applies source weighting, and marks disagreement rather
 * than averaging categorical values into a new surface that nobody reported.
 * Generated route output has weight zero: a route request cannot prove the road
 * it requested.
 */

import type { RoadEntityId, RoadSpanId } from "@/domain/ride/ids";
import type {
  SurfaceAggregationOptions,
  SurfaceAssessment,
  SurfaceBand,
} from "@/domain/roads/surface";
import { aggregateRoadSurface } from "./surface-evidence";

export type RoadEvidenceSource =
  | "official-authority"
  | "osm"
  | "gravel-atlas"
  | "road-span"
  | "recorded-ride"
  | "import"
  | "route-corpus"
  | "generated-route";

export type RoadEvidenceAspect = "surface" | "access" | "condition" | "character" | "road-class";

export interface RoadEvidenceRecord {
  readonly id: string;
  readonly entityId: RoadEntityId;
  /** Optional span scope retained for contribution/evidence uploads. */
  readonly spanId?: RoadSpanId;
  readonly source: RoadEvidenceSource;
  readonly sourceId?: string;
  readonly observedAt: string;
  /** Optional expiration declarations consumed by the surface adapter. */
  readonly stalenessWindowDays?: number;
  readonly stalenessWindowMs?: number;
  readonly expiresAt?: string;
  readonly aspect?: RoadEvidenceAspect;
  /** `null` is an explicit unknown report; it is never a negative value. */
  readonly value: string | null;
  /** `null` is unknown confidence; it never becomes zero by implication. */
  readonly confidence: number | null;
  /** Optional legacy/RIG fields retained at the application boundary. */
  readonly contributorId?: string;
  readonly gpsPrecisionM?: number;
  readonly duplicateFamilyId?: string;
  readonly coveredFraction?: number;
  readonly routeRoleWeight?: number;
}

export type RoadEvidenceConfidenceBand = "High" | "Medium" | "Low" | "Unverified";

export interface RoadEvidenceSummary {
  readonly entityId: RoadEntityId;
  /** A value is emitted only when it wins clearly enough to be useful. */
  readonly surfaceValue: string | null;
  readonly confidence: number | null;
  readonly confidenceBand: RoadEvidenceConfidenceBand;
  readonly conflict: boolean;
  /** Counts non-generated reports, including explicit unknown reports. */
  readonly evidenceCount: number;
  readonly sourceDiversity: number;
  readonly latestObservedAt: string | null;
  /** All reports are retained for the road-detail evidence table. */
  readonly records: readonly RoadEvidenceRecord[];
  /** Canonical surface result used by new route/road surfaces. */
  readonly surfaceAssessment?: SurfaceAssessment;
  readonly surfaceBand?: SurfaceBand;
}

/** Source weights ported from legacy RIG evidence, with generated routes at 0. */
export const ROAD_EVIDENCE_SOURCE_WEIGHTS: Readonly<Record<RoadEvidenceSource, number>> = {
  "official-authority": 1,
  osm: 0.75,
  "gravel-atlas": 0.9,
  "road-span": 0.6,
  "recorded-ride": 1,
  import: 0.2,
  "route-corpus": 0.2,
  "generated-route": 0,
};

function clampConfidence(value: number | null): number | null {
  if (value === null || !Number.isFinite(value)) return null;
  return Math.max(0, Math.min(1, value));
}

function reportWeight(record: RoadEvidenceRecord): number {
  const sourceWeight = ROAD_EVIDENCE_SOURCE_WEIGHTS[record.source];
  const confidence = clampConfidence(record.confidence) ?? 0;
  const coverage = record.coveredFraction === undefined
    ? 1
    : Math.max(0, Math.min(1, record.coveredFraction));
  const roleWeight = record.routeRoleWeight === undefined
    ? 1
    : Math.max(0, Math.min(1, record.routeRoleWeight));
  return sourceWeight * confidence * coverage * roleWeight;
}

function rounded(value: number): number {
  return Number(value.toFixed(3));
}

function bandFor(confidence: number | null): RoadEvidenceConfidenceBand {
  if (confidence === null || confidence <= 0) return "Unverified";
  if (confidence >= 0.8) return "High";
  if (confidence >= 0.5) return "Medium";
  return "Low";
}

function compareRecords(left: RoadEvidenceRecord, right: RoadEvidenceRecord): number {
  return right.observedAt.localeCompare(left.observedAt) || left.id.localeCompare(right.id);
}

function summaryFor(
  entityId: RoadEntityId,
  input: readonly RoadEvidenceRecord[],
  options: SurfaceAggregationOptions = {},
): RoadEvidenceSummary {
  const records = [...input].sort(compareRecords);
  const usableRecords = records.filter((record) => ROAD_EVIDENCE_SOURCE_WEIGHTS[record.source] > 0);
  const knownRecords = usableRecords.filter(
    (record) => (record.aspect === undefined || record.aspect === "surface")
      && record.value !== null
      && reportWeight(record) > 0,
  );
  const values = new Set(knownRecords.map((record) => record.value));
  const conflict = values.size > 1;

  const totals = new Map<string, number>();
  for (const record of knownRecords) {
    if (record.value === null) continue;
    totals.set(record.value, (totals.get(record.value) ?? 0) + reportWeight(record));
  }
  const ranked = [...totals.entries()].sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]));
  const winner = ranked[0];
  const runnerUp = ranked[1];
  const clearWinner = winner !== undefined
    && (runnerUp === undefined || winner[1] >= runnerUp[1] * 2);
  const surfaceValue = winner !== undefined && (!conflict || clearWinner) ? winner[0] : null;

  let confidence: number | null = null;
  if (winner !== undefined) {
    const winning = knownRecords.filter((record) => record.value === winner[0]);
    const weight = winning.reduce((total, record) => total + reportWeight(record), 0);
    const weightedConfidence = winning.reduce(
      (total, record) => total + reportWeight(record) * (clampConfidence(record.confidence) ?? 0),
      0,
    );
    const base = weight === 0 ? null : weightedConfidence / weight;
    confidence = base === null ? null : conflict ? base * 0.5 : base;
  }

  const surfaceAssessment = aggregateRoadSurface(input, options);
  return {
    entityId,
    surfaceValue,
    confidence: confidence === null ? null : rounded(confidence),
    confidenceBand: bandFor(confidence),
    conflict,
    evidenceCount: usableRecords.length,
    sourceDiversity: new Set(usableRecords.map((record) =>
      `${record.source}:${record.sourceId ?? record.contributorId ?? "default"}`)).size,
    latestObservedAt: records[0]?.observedAt ?? null,
    records,
    surfaceAssessment,
    surfaceBand: surfaceAssessment.band,
  };
}

/**
 * Groups reports into deterministic per-entity summaries. Empty input produces
 * no entities: callers must obtain the entity list from the read model and can
 * then call this function with an empty report list to render Unverified.
 */
export function aggregateRoadEvidence(
  records: readonly RoadEvidenceRecord[],
  options: SurfaceAggregationOptions = {},
): readonly RoadEvidenceSummary[] {
  const grouped = new Map<RoadEntityId, RoadEvidenceRecord[]>();
  for (const record of records) {
    const group = grouped.get(record.entityId) ?? [];
    group.push(record);
    grouped.set(record.entityId, group);
  }
  return [...grouped.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([entityId, entityRecords]) => summaryFor(entityId, entityRecords, options));
}

/** Named alias for callers that describe the operation as a merge. */
export const mergeRoadEvidence = aggregateRoadEvidence;

/** Readable source copy for the evidence table; no source text is fabricated. */
export function roadEvidenceSourceLabel(source: RoadEvidenceSource): string {
  switch (source) {
    case "official-authority": return "Official authority";
    case "osm": return "OpenStreetMap";
    case "gravel-atlas": return "Gravel Atlas";
    case "road-span": return "Road span";
    case "recorded-ride": return "Recorded ride";
    case "route-corpus": return "Route corpus";
    case "generated-route": return "Generated route";
    case "import": return "Imported track";
  }
}
