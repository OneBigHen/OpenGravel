import {
  asRoadEntityId,
  asRoadSpanId,
} from "@/domain/ride/ids";
import {
  CONTRIBUTION_MODERATION_QUEUE_LIST_MAX,
  type ContributionModerationRecord,
  type ContributionRoadRef,
} from "@/domain/contributions";
import {
  decideContribution,
  listPendingContributions,
  submitContributionForModeration,
  type ContributionDecisionFailure,
  type ContributionSubmitFailure,
} from "@/application/contributions/moderation";
import {
  CONTRIBUTION_STORE_MAX_RESULTS,
  type ContributionStore,
  type StoredContribution,
} from "./store";

export const CONTRIBUTION_RESPONSE_HEADERS: Readonly<Record<string, string>> = {
  "cache-control": "private, no-store",
};

export const CONTRIBUTION_MODERATION_DECISION_ID_PATTERN = /^contrib_[A-Za-z0-9_-]{1,80}$/;

export interface ContributionErrorBody {
  readonly error: {
    readonly code: "validation" | "abuse" | "not-found" | "conflict" | "storage";
    readonly message: string;
    readonly details?: Readonly<Record<string, unknown>>;
  };
}

export interface ContributionSuccessBody {
  readonly id: string;
  readonly contribution: StoredContribution["envelope"];
  readonly receivedAt: string;
}

export interface ContributionListBody {
  readonly contributions: readonly StoredContribution[];
  readonly limit: number;
}

export interface ContributionModerationQueueBody {
  readonly queue: readonly ContributionModerationRecord[];
  readonly limit: number;
}

export interface ContributionModerationDecisionBody {
  readonly contribution: ContributionModerationRecord;
}

export type ContributionHandlerBody =
  | ContributionSuccessBody
  | ContributionListBody
  | ContributionModerationQueueBody
  | ContributionModerationDecisionBody
  | ContributionErrorBody;

export interface ContributionHandlerResult {
  readonly status: number;
  readonly body: ContributionHandlerBody;
  readonly headers: Readonly<Record<string, string>>;
}

export interface ContributionPostDependencies {
  readonly store: ContributionStore;
  readonly now?: () => string;
}

export interface ContributionGetQuery {
  readonly roadRef?: unknown;
  readonly limit?: unknown;
}

export interface ContributionGetDependencies {
  readonly store: ContributionStore;
}

export interface ContributionModerationGetQuery {
  readonly limit?: unknown;
}

export interface ContributionModerationDependencies {
  readonly store: ContributionStore;
}

function errorBody(
  code: ContributionErrorBody["error"]["code"],
  message: string,
  reason?: string,
): ContributionErrorBody {
  return reason === undefined
    ? { error: { code, message } }
    : { error: { code, message, details: { reason } } };
}

function handlerResult(
  status: number,
  body: ContributionHandlerBody,
): ContributionHandlerResult {
  return { status, body, headers: CONTRIBUTION_RESPONSE_HEADERS };
}

function validationFailure(
  message: string,
  details?: Readonly<Record<string, unknown>>,
): ContributionHandlerResult {
  return handlerResult(400, details === undefined
    ? { error: { code: "validation", message } }
    : { error: { code: "validation", message, details } });
}

function storageFailure(): ContributionHandlerResult {
  return handlerResult(500, errorBody("storage", "The contribution could not be stored."));
}

/** Canonical query spelling: road_<id>/span_<id>. */
export function parseContributionRoadRef(value: unknown): ContributionRoadRef | null {
  if (typeof value !== "string" || value.length > 260) return null;
  const match = /^(road_[A-Za-z0-9_-]{1,120})\/(span_[A-Za-z0-9_-]{1,120})$/.exec(value);
  if (match === null) return null;
  return { roadId: asRoadEntityId(match[1]!), spanId: asRoadSpanId(match[2]!) };
}

function parsedLimit(value: unknown, maximum: number): number | null {
  if (value === undefined) return maximum;
  if (typeof value === "number" && Number.isInteger(value) && value >= 0) {
    return Math.min(value, maximum);
  }
  if (typeof value === "string" && /^\d+$/.test(value)) {
    return Math.min(Number(value), maximum);
  }
  return null;
}

function submitFailureResult(failure: ContributionSubmitFailure): ContributionHandlerResult {
  switch (failure.code) {
    case "validation":
      return validationFailure("The contribution was rejected.", { issues: failure.issues });
    case "payload-too-large":
      return handlerResult(413, errorBody("abuse", failure.message, "payload-too-large"));
    default:
      return handlerResult(429, errorBody("abuse", failure.message, failure.code));
  }
}

function decisionFailureResult(failure: ContributionDecisionFailure): ContributionHandlerResult {
  switch (failure.code) {
    case "invalid-decision":
      return validationFailure(failure.message, { reason: failure.code });
    case "already-decided":
      return handlerResult(409, errorBody("conflict", failure.message, failure.code));
    case "unknown-contribution":
      return handlerResult(404, errorBody("not-found", failure.message));
    default:
      return storageFailure();
  }
}

export async function handleContributionPost(
  body: unknown,
  dependencies: ContributionPostDependencies,
): Promise<ContributionHandlerResult> {
  try {
    const result = submitContributionForModeration(dependencies.store, body, {
      now: dependencies.now?.(),
    });
    if (!result.ok) return submitFailureResult(result.failure);
    return handlerResult(201, {
      id: result.submission.id,
      contribution: result.submission.envelope,
      receivedAt: result.submission.receivedAt,
    });
  } catch {
    return storageFailure();
  }
}

export async function handleContributionGet(
  query: ContributionGetQuery,
  dependencies: ContributionGetDependencies,
): Promise<ContributionHandlerResult> {
  const roadRef = parseContributionRoadRef(query.roadRef);
  if (roadRef === null) return validationFailure("roadRef must be road_<id>/span_<id>.");
  const limit = parsedLimit(query.limit, CONTRIBUTION_STORE_MAX_RESULTS);
  if (limit === null) return validationFailure("limit must be a non-negative integer.");
  try {
    return handlerResult(200, {
      contributions: dependencies.store.list(roadRef, limit),
      limit,
    });
  } catch {
    return storageFailure();
  }
}

/** The bounded local moderation queue: pending submissions only. */
export async function handleContributionModerationGet(
  query: ContributionModerationGetQuery,
  dependencies: ContributionModerationDependencies,
): Promise<ContributionHandlerResult> {
  const limit = parsedLimit(query.limit, CONTRIBUTION_MODERATION_QUEUE_LIST_MAX);
  if (limit === null) return validationFailure("limit must be a non-negative integer.");
  try {
    return handlerResult(200, {
      queue: listPendingContributions(dependencies.store, limit),
      limit,
    });
  } catch {
    return storageFailure();
  }
}

/** One explicit, typed moderation decision over an existing submission. */
export async function handleContributionModerationDecide(
  body: unknown,
  dependencies: ContributionModerationDependencies,
): Promise<ContributionHandlerResult> {
  const record = typeof body === "object" && body !== null && !Array.isArray(body)
    ? body as Record<string, unknown>
    : null;
  if (record === null || typeof record.id !== "string"
    || !CONTRIBUTION_MODERATION_DECISION_ID_PATTERN.test(record.id)) {
    return validationFailure("id must be a contrib_ identifier.", { reason: "invalid-id" });
  }
  try {
    const result = decideContribution(dependencies.store, record.id, record.decision);
    if (!result.ok) return decisionFailureResult(result.failure);
    return handlerResult(200, { contribution: result.submission });
  } catch {
    return storageFailure();
  }
}
