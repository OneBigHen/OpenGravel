/**
 * Application-boundary enforcement for contribution moderation.
 *
 * Every submission passes validation, the payload bound, and the abuse bounds
 * before it reaches a store, and every moderation decision goes through the
 * domain state machine. UI and API callers cannot bypass these rules because
 * they never talk to the store directly for moderation work.
 */
import {
  CONTRIBUTION_ABUSE_LIMITS,
  CONTRIBUTION_MAX_PAYLOAD_BYTES,
  CONTRIBUTION_RATE_WINDOW_MS,
  applyModerationDecision,
  checkContributionAbuseBounds,
  contributionPayloadBytes,
  parseContribution,
  reporterIdentityFor,
  type ContributionAbuseFailure,
  type ContributionAbuseLimits,
  type ContributionEnvelope,
  type ContributionModerationDecision,
  type ContributionModerationFailure,
  type ContributionModerationRecord,
  type ContributionValidationError,
} from "@/domain/contributions";

/**
 * Persistence surface the moderation boundary needs. The server contribution
 * store implements it; it is not a second contribution store.
 */
export interface ContributionModerationPort {
  append(envelope: ContributionEnvelope): ContributionModerationRecord;
  find(id: string): ContributionModerationRecord | null;
  /**
   * Appends one decision; the server stamps the decision instant, exactly like
   * `append` stamps the receipt instant.
   */
  recordDecision(
    id: string,
    decision: ContributionModerationDecision,
  ): ContributionModerationRecord | null;
  listPending(limit: number): readonly ContributionModerationRecord[];
  pendingCount(): number;
  pendingCountFor(pseudoId: string): number;
  recentSubmissionCount(pseudoId: string, windowMs: number): number;
}

export interface ContributionSubmitOptions {
  /** Reference clock for validation and rate windows; defaults to now. */
  readonly now?: string;
  readonly limits?: ContributionAbuseLimits;
  readonly maxPayloadBytes?: number;
}

export type ContributionSubmitFailure =
  | { readonly code: "validation"; readonly issues: readonly ContributionValidationError[] }
  | { readonly code: "payload-too-large"; readonly message: string }
  | ContributionAbuseFailure;

export type ContributionSubmitResult =
  | { readonly ok: true; readonly submission: ContributionModerationRecord }
  | { readonly ok: false; readonly failure: ContributionSubmitFailure };

export type ContributionDecisionFailure =
  | { readonly code: "unknown-contribution"; readonly message: string }
  | ContributionModerationFailure;

export type ContributionDecisionResult =
  | { readonly ok: true; readonly submission: ContributionModerationRecord }
  | { readonly ok: false; readonly failure: ContributionDecisionFailure };


/**
 * Validates one submission and stores it as a pending, bounded record —
 * selected road span/evidence only, with reporter identity projected from the
 * validated provenance pseudonym.
 */
export function submitContributionForModeration(
  port: ContributionModerationPort,
  input: unknown,
  options: ContributionSubmitOptions = {},
): ContributionSubmitResult {
  const maxPayloadBytes = options.maxPayloadBytes ?? CONTRIBUTION_MAX_PAYLOAD_BYTES;
  if (contributionPayloadBytes(input) > maxPayloadBytes) {
    return {
      ok: false,
      failure: {
        code: "payload-too-large",
        message: "The contribution payload is too large.",
      },
    };
  }

  const parsed = parseContribution(input, { now: options.now });
  if (!parsed.ok) {
    return { ok: false, failure: { code: "validation", issues: parsed.errors } };
  }

  const reporter = reporterIdentityFor(parsed.value);
  const limits = options.limits ?? CONTRIBUTION_ABUSE_LIMITS;
  const abuse = checkContributionAbuseBounds({
    queuePending: port.pendingCount(),
    reporterPending: port.pendingCountFor(reporter.pseudoId),
    reporterRecentSubmissions: port.recentSubmissionCount(
      reporter.pseudoId,
      CONTRIBUTION_RATE_WINDOW_MS,
    ),
  }, limits);
  if (abuse !== null) return { ok: false, failure: abuse };

  return { ok: true, submission: port.append(parsed.value) };
}

/**
 * Applies one explicit moderation decision. Terminal decisions never reopen:
 * the domain state machine refuses them with an honest typed failure.
 */
export function decideContribution(
  port: ContributionModerationPort,
  id: string,
  decision: unknown,
): ContributionDecisionResult {
  const record = port.find(id);
  if (record === null) {
    return {
      ok: false,
      failure: { code: "unknown-contribution", message: "The contribution does not exist." },
    };
  }
  const transition = applyModerationDecision(record.state, decision);
  if (!transition.ok) return { ok: false, failure: transition.failure };

  const decided = port.recordDecision(id, transition.decision);
  if (decided === null) {
    return {
      ok: false,
      failure: { code: "unknown-contribution", message: "The contribution does not exist." },
    };
  }
  return { ok: true, submission: decided };
}

/** Bounded local moderation queue: pending submissions only. */
export function listPendingContributions(
  port: ContributionModerationPort,
  limit: number,
): readonly ContributionModerationRecord[] {
  return port.listPending(limit);
}
