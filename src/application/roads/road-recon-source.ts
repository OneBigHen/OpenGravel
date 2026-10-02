import type { BoundingBox, SourceBudget } from "@/application/route-intelligence/types";
import type { Coordinate } from "@/domain/ride/types";

/**
 * Candidate-generation evidence for interesting roads.
 *
 * Recon is deliberately weaker than RoadAuthorityRecord and RoadEvidenceRecord:
 * it can cause OpenGravel to investigate/rank a road, but it cannot by itself
 * prove motorcycle access or a meter-by-meter surface classification.
 */
export type RoadReconSurfaceHint =
  | "gravel-present"
  | "unimproved-present"
  | "unpaved"
  | "unknown";

export interface RoadReconRecord {
  readonly sourceId: string;
  readonly sourceRecordId: string;
  readonly name: string | null;
  readonly geometry: readonly Coordinate[];
  readonly surfaceHints: readonly RoadReconSurfaceHint[];
  readonly roadOwner: string | null;
  readonly trafficCount: number | null;
  readonly lengthMiles: number | null;
  readonly confidence: number;
  readonly notes: readonly string[];
}

export interface RoadReconSourceInfo {
  readonly id: string;
  readonly label: string;
  readonly coverage: readonly BoundingBox[];
  /** Always candidate-only: never legal-access authority. */
  readonly authority: "recon";
}

export interface RoadReconSnapshot {
  readonly status: "fresh" | "stale" | "unavailable";
  readonly fetchedAt: string | null;
  readonly reason: string | null;
  readonly truncated: boolean;
  readonly records: readonly RoadReconRecord[];
  readonly covered: readonly BoundingBox[];
}

export interface RoadReconSource {
  readonly info: RoadReconSourceInfo;
  readonly budget: SourceBudget;
  snapshot(corridor: BoundingBox, signal?: AbortSignal): Promise<RoadReconSnapshot>;
}
