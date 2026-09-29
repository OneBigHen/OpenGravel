import { isUsableEvidence, knownEvidence, unknownEvidence, type EvidenceSource, type EvidenceValue } from "@/domain/evidence/types";
import type { Coordinate } from "@/domain/ride/types";
import type { SessionNavigationState } from "@/domain/ride-session/navigation";
import type { SessionRouteBinding } from "@/domain/ride-session/types";
import type { GeometryRef } from "@/domain/ride/ids";
import type { RouteInstruction } from "@/domain/route/types";
import { deepFreeze } from "@/domain/util/freeze";

export type RiderWorkload = "low" | "normal" | "high";

const GPS_WORKLOAD_SOURCE: EvidenceSource = {
  id: "ride-focus-speed-band", label: "Current speed", category: "derived", authoritativeFor: ["workload"],
};

/**
 * Unknown below useful road speed; 8–18 m/s is normal, faster is high. High
 * workload trims what the rider must look at or touch; it does not silence a
 * short helmet cue (COPILOT §7), so it no longer blocks a suggestion.
 */
export function deriveLiveSuggestionWorkload(navigation: SessionNavigationState): EvidenceValue<RiderWorkload> {
  const position = navigation.position;
  if (navigation.activity !== "free" || position.quality !== "fresh-good" ||
      position.speedMps === null || !Number.isFinite(position.speedMps)) {
    return unknownEvidence("current GPS workload inputs are unavailable");
  }
  if (position.speedMps > 18) return knownEvidence("high", GPS_WORKLOAD_SOURCE);
  if (position.speedMps < 8) return unknownEvidence("speed is below the suggestion workload band");
  return knownEvidence("normal", GPS_WORKLOAD_SOURCE);
}

export interface LiveSuggestionCandidate {
  readonly id: string;
  /** Provider road name, or the honest generic title `Suggested road`. */
  readonly label: string;
  /** The actual upcoming maneuver point the rider would take. */
  readonly entry: Coordinate;
  /** Along-route distance from the current position to that decision point. */
  readonly distanceToDecisionMeters: number;
  /** Length of the full suggested segment; never present this as turn distance. */
  readonly distanceMeters: number;
  readonly route: SessionRouteBinding;
  /** Smallest absolute turn from current heading, in degrees. */
  readonly headingDeltaDegrees: number;
  readonly requiresUTurn: boolean;
  readonly instructions?: readonly RouteInstruction[];
  /** Route-plan evidence used to choose among eligible ahead segments. */
  readonly evidence?: LiveSuggestionEvidence;
  /** Present for production suggestions whose route line is durably stored. */
  readonly routeGeometryRef?: GeometryRef;
  /** Provider-reported segment duration; absent stays unknown in the card. */
  readonly durationSeconds?: number;
}

export interface LiveSuggestionEvidence {
    readonly roadCharacterFit: EvidenceValue<number>;
    readonly surfaceFit: EvidenceValue<number>;
    readonly novelty: EvidenceValue<number>;
}

export interface LiveSuggestionPort {
  propose(input: {
    readonly coordinate: Coordinate;
    readonly headingDegrees: number;
  }, signal: AbortSignal): Promise<readonly LiveSuggestionCandidate[]>;
}

export interface LiveSuggestionEvidencePort {
  assess(candidate: LiveSuggestionCandidate, signal: AbortSignal): Promise<LiveSuggestionEvidence>;
}

export interface LiveSuggestionPolicy {
  readonly minimumMovingSpeedMps: number;
  readonly maximumAheadDeltaDegrees: number;
  readonly cooldownMs: number;
}

export interface LiveSuggestionInput {
  readonly navigation: SessionNavigationState;
  readonly workload: EvidenceValue<RiderWorkload>;
  readonly now: string;
  readonly lastSuggestionAt: string | null;
}

export type LiveSuggestionResult =
  | { readonly status: "suggestion"; readonly suggestion: LiveSuggestionCandidate }
  | { readonly status: "quiet"; readonly reason: "not-free" | "gps" | "not-moving" | "workload" | "cooldown" | "none-ahead" };

function elapsedMs(now: string, then: string): number | null {
  const current = Date.parse(now);
  const previous = Date.parse(then);
  if (!Number.isFinite(current) || !Number.isFinite(previous)) return null;
  return Math.max(0, current - previous);
}

function evidenceScore(evidence: LiveSuggestionEvidence): number {
  return Object.values(evidence).reduce((sum, value) => {
    if (!isUsableEvidence(value) || value.value === null) return sum;
    return Number.isFinite(value.value) && value.value >= 0 && value.value <= 1
      ? sum + value.value
      : sum;
  }, 0);
}

export async function evaluateLiveSuggestion(
  input: LiveSuggestionInput,
  deps: {
    readonly port: LiveSuggestionPort;
    readonly evidence: LiveSuggestionEvidencePort;
    readonly policy: LiveSuggestionPolicy;
  },
  signal: AbortSignal,
): Promise<LiveSuggestionResult> {
  if (signal.aborted) throw signal.reason;
  const navigation = input.navigation;
  if (navigation.activity !== "free") return deepFreeze({ status: "quiet", reason: "not-free" });
  const position = navigation.position;
  if (
    navigation.aheadGuidanceSuspended ||
    position.quality !== "fresh-good" ||
    position.coordinate === null ||
    position.headingDegrees === null
  ) return deepFreeze({ status: "quiet", reason: "gps" });
  if (position.speedMps === null || position.speedMps < deps.policy.minimumMovingSpeedMps) {
    return deepFreeze({ status: "quiet", reason: "not-moving" });
  }
  if (!isUsableEvidence(input.workload) || input.workload.value === null) {
    return deepFreeze({ status: "quiet", reason: "workload" });
  }
  if (input.lastSuggestionAt !== null) {
    const elapsed = elapsedMs(input.now, input.lastSuggestionAt);
    if (elapsed === null || elapsed < deps.policy.cooldownMs) {
      return deepFreeze({ status: "quiet", reason: "cooldown" });
    }
  }
  const candidates = await deps.port.propose({
    coordinate: position.coordinate,
    headingDegrees: position.headingDegrees,
  }, signal);
  if (signal.aborted) throw signal.reason;
  const eligible = candidates.filter((candidate) =>
    !candidate.requiresUTurn &&
    Number.isFinite(candidate.headingDeltaDegrees) &&
    Math.abs(candidate.headingDeltaDegrees) <= deps.policy.maximumAheadDeltaDegrees
  );
  const assessed = await Promise.all(eligible.map(async (candidate) => ({
    candidate,
    evidence: await deps.evidence.assess(candidate, signal),
  })));
  if (signal.aborted) throw signal.reason;
  assessed.sort((left, right) =>
    evidenceScore(right.evidence) - evidenceScore(left.evidence) ||
    left.candidate.id.localeCompare(right.candidate.id),
  );
  const suggestion = assessed[0]?.candidate;
  return suggestion === undefined
    ? deepFreeze({ status: "quiet", reason: "none-ahead" })
    : deepFreeze({ status: "suggestion", suggestion });
}
