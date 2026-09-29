/**
 * Moderation state machine for contribution submissions (02-ARCHITECTURE-CONTRACT
 * §20 moderation status).
 *
 * Decisions are explicit and typed: a pending submission may become accepted or
 * rejected exactly once, and a terminal decision never silently reopens. Every
 * refused transition returns an honest typed failure instead of throwing or
 * repairing state.
 */
import type { ContributionEnvelope } from "./types";
import type { ContributionReporterIdentity } from "./reporter";

export const CONTRIBUTION_MODERATION_STATES = ["pending", "accepted", "rejected"] as const;
export type ContributionModerationState = (typeof CONTRIBUTION_MODERATION_STATES)[number];

export const CONTRIBUTION_MODERATION_DECISIONS = ["accept", "reject"] as const;
export type ContributionModerationDecision = (typeof CONTRIBUTION_MODERATION_DECISIONS)[number];

export type ContributionModerationFailureCode =
  | "unknown-state"
  | "invalid-decision"
  | "already-decided";

export interface ContributionModerationFailure {
  readonly code: ContributionModerationFailureCode;
  readonly message: string;
}

export type ContributionModerationTransition =
  | {
      readonly ok: true;
      readonly decision: ContributionModerationDecision;
      readonly state: Exclude<ContributionModerationState, "pending">;
    }
  | { readonly ok: false; readonly failure: ContributionModerationFailure };

/** A server-owned contribution record with bounded moderation state. */
export interface ContributionModerationRecord {
  readonly id: string;
  readonly envelope: ContributionEnvelope;
  readonly reporter: ContributionReporterIdentity;
  readonly receivedAt: string;
  readonly state: ContributionModerationState;
  readonly decidedAt: string | null;
}

function oneOf<T extends string>(value: unknown, values: readonly T[]): value is T {
  return typeof value === "string" && values.includes(value as T);
}

/**
 * The only legal transition: pending → accepted | rejected. Anything else —
 * an unrecognized state, an unrecognized decision token, or a second decision
 * on a terminal record — is rejected with a typed failure.
 */
export function applyModerationDecision(
  state: unknown,
  decision: unknown,
): ContributionModerationTransition {
  if (!oneOf(state, CONTRIBUTION_MODERATION_STATES)) {
    return {
      ok: false,
      failure: {
        code: "unknown-state",
        message: "The moderation state is not recognized.",
      },
    };
  }
  if (!oneOf(decision, CONTRIBUTION_MODERATION_DECISIONS)) {
    return {
      ok: false,
      failure: {
        code: "invalid-decision",
        message: "The moderation decision is not recognized.",
      },
    };
  }
  if (state !== "pending") {
    return {
      ok: false,
      failure: {
        code: "already-decided",
        message: "The contribution already has a moderation decision.",
      },
    };
  }
  return {
    ok: true,
    decision,
    state: decision === "accept" ? "accepted" : "rejected",
  };
}
