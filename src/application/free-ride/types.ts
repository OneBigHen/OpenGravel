import type { EvidenceValue } from "@/domain/evidence/types";
import type { GeometryStore } from "@/application/geometry/geometry-store";
import type {
  BikeConstraintSnapshot,
  Coordinate,
  DepartureIntent,
  RoadCharacterIntent,
  SurfaceIntent,
  TerrainIntent,
} from "@/domain/ride/types";
import type { GeometryRef } from "@/domain/ride/ids";
import type {
  NoveltyPreference,
  WeatherPreference,
} from "@/domain/route/intent";
import type { RoutePolicy } from "@/domain/route/policy";
import type {
  RouteEvidence,
  RouteScore,
  RouteWarning,
} from "@/domain/route/types";
import type { LaneDiagnostic } from "../planner/candidate-lanes";
import type { PipelineDiagnostic } from "../planner/pipeline";
import type {
  ProviderCandidate,
  RouteCandidateProvider,
} from "../planner/route-provider";

export interface FreeRideTimeBudget {
  readonly targetMinutes: number;
  readonly toleranceMinutes: number;
}

export interface FreeRideDiscoveryInput {
  /** Stable identity supplied by the caller; the engine mints no authority id. */
  readonly discoveryId: string;
  /** A current-position observation. Unknown/unusable input stops before routing. */
  readonly origin: EvidenceValue<Coordinate>;
  readonly timeBudget: FreeRideTimeBudget;
  readonly departure: DepartureIntent;
  readonly roadCharacter: RoadCharacterIntent;
  readonly surface: SurfaceIntent;
  readonly terrain: TerrainIntent;
  readonly bike: BikeConstraintSnapshot;
  readonly noveltyPreference: NoveltyPreference;
  /** Optional by design: absent weather evidence cannot invent a preference fact. */
  readonly weatherPreference?: WeatherPreference;
}

/** The exact rider constraints an evidence adapter measures a candidate against. */
export interface FreeRideEvidenceContext {
  readonly departure: DepartureIntent;
  readonly roadCharacter: RoadCharacterIntent;
  readonly surface: SurfaceIntent;
  readonly terrain: TerrainIntent;
  readonly bike: BikeConstraintSnapshot;
  readonly noveltyPreference: NoveltyPreference;
  readonly weatherPreference?: WeatherPreference;
}

/**
 * Candidate facts used by discovery. Every value is evidence-wrapped so an
 * adapter cannot smuggle an unqualified positive claim into eligibility or UI.
 */
export interface FreeRideCandidateEvidence {
  readonly surfaceFit: EvidenceValue<number>;
  readonly terrainCompatibility: EvidenceValue<boolean>;
  readonly bikeCompatibility: EvidenceValue<boolean>;
  readonly roadCharacterFit: EvidenceValue<number>;
  readonly novelty: EvidenceValue<number>;
  readonly weatherSuitability: EvidenceValue<number>;
}

export interface FreeRideEvidencePort {
  assess(
    candidate: ProviderCandidate,
    context: FreeRideEvidenceContext,
    signal: AbortSignal,
  ): Promise<Partial<FreeRideCandidateEvidence>>;
}

export interface FreeRideDiscoveryDeps {
  readonly provider: RouteCandidateProvider;
  readonly evidence: FreeRideEvidencePort;
  readonly geometryStore: GeometryStore;
  readonly policy?: RoutePolicy;
}

export interface FreeRideDiscoveryDiagnostic {
  readonly stage: "evidence";
  readonly code: "evidence-unavailable";
  readonly candidateIndex: number;
  readonly message: string;
}

export interface FreeRideTimeboxAssessment {
  readonly status: "matched" | "mismatch";
  readonly targetMinutes: number;
  readonly actualMinutes: number;
  readonly differenceMinutes: number;
  readonly evidence: EvidenceValue<{
    readonly matched: boolean;
    readonly targetMinutes: number;
    readonly actualMinutes: number;
    readonly differenceMinutes: number;
  }>;
}

export interface FreeRideLoopProposal {
  readonly id: string;
  readonly fingerprint: string;
  readonly geometryRef: GeometryRef;
  readonly metrics: {
    readonly distanceMeters: EvidenceValue<number>;
    readonly durationMinutes: EvidenceValue<number>;
  };
  readonly timebox: FreeRideTimeboxAssessment;
  readonly facts: FreeRideCandidateEvidence;
  readonly evidence: RouteEvidence;
  readonly score: RouteScore;
  readonly warnings: readonly RouteWarning[];
}

export type FreeRideDiscoveryStatus = "origin-unknown" | "empty" | "ready";

export interface FreeRideDiscoveryResult {
  readonly status: FreeRideDiscoveryStatus;
  readonly origin: EvidenceValue<Coordinate>;
  readonly proposals: readonly FreeRideLoopProposal[];
  readonly selectedProposalId: string | null;
  readonly diagnostics: readonly (
    | PipelineDiagnostic
    | LaneDiagnostic
    | FreeRideDiscoveryDiagnostic
  )[];
}
