/**
 * Abuse bounds for contribution submissions, enforced at the domain/application
 * boundary — never by UI or API callers alone.
 *
 * The queue bound keeps the local moderation queue finite, the per-reporter
 * bounds keep one pseudonym from flooding it, and the payload bound refuses
 * oversized serialized submissions even when field limits would later drop the
 * unknown fields.
 */

export const CONTRIBUTION_MAX_PAYLOAD_BYTES = 8 * 1024;
export const CONTRIBUTION_MODERATION_QUEUE_MAX_PENDING = 250;
export const CONTRIBUTION_MODERATION_QUEUE_LIST_MAX = 100;
export const CONTRIBUTION_MAX_PENDING_PER_REPORTER = 15;
export const CONTRIBUTION_RATE_WINDOW_MS = 60 * 60 * 1000;
export const CONTRIBUTION_MAX_SUBMISSIONS_PER_WINDOW = 30;

export type ContributionAbuseCode =
  | "queue-full"
  | "reporter-pending-cap"
  | "reporter-rate-exceeded";

export interface ContributionAbuseFailure {
  readonly code: ContributionAbuseCode;
  readonly message: string;
}

export interface ContributionAbuseCounts {
  readonly queuePending: number;
  readonly reporterPending: number;
  readonly reporterRecentSubmissions: number;
}

export interface ContributionAbuseLimits {
  readonly queueMaxPending: number;
  readonly maxPendingPerReporter: number;
  readonly maxSubmissionsPerWindow: number;
}

export const CONTRIBUTION_ABUSE_LIMITS: ContributionAbuseLimits = {
  queueMaxPending: CONTRIBUTION_MODERATION_QUEUE_MAX_PENDING,
  maxPendingPerReporter: CONTRIBUTION_MAX_PENDING_PER_REPORTER,
  maxSubmissionsPerWindow: CONTRIBUTION_MAX_SUBMISSIONS_PER_WINDOW,
};

/** Serialized submission size in bytes; the honest unit for the payload bound. */
export function contributionPayloadBytes(value: unknown): number {
  return new TextEncoder().encode(JSON.stringify(value) ?? "null").byteLength;
}

function boundedCount(value: number): number {
  return Number.isFinite(value) ? Math.max(0, Math.trunc(value)) : 0;
}

/**
 * Pure bound check. A count at its limit already refuses the next submission,
 * so each limit is a true ceiling. When several bounds are exceeded at once the
 * queue bound is reported first, then per-reporter pending, then rate.
 */
export function checkContributionAbuseBounds(
  counts: ContributionAbuseCounts,
  limits: ContributionAbuseLimits = CONTRIBUTION_ABUSE_LIMITS,
): ContributionAbuseFailure | null {
  if (boundedCount(counts.queuePending) >= limits.queueMaxPending) {
    return {
      code: "queue-full",
      message: "The moderation queue is full.",
    };
  }
  if (boundedCount(counts.reporterPending) >= limits.maxPendingPerReporter) {
    return {
      code: "reporter-pending-cap",
      message: "The reporter has too many contributions awaiting moderation.",
    };
  }
  if (boundedCount(counts.reporterRecentSubmissions) >= limits.maxSubmissionsPerWindow) {
    return {
      code: "reporter-rate-exceeded",
      message: "The reporter has submitted too many contributions recently.",
    };
  }
  return null;
}
