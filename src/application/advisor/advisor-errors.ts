/**
 * Advisor error classes (10 §13) and their rider-safe states.
 *
 * The advisor is a natural-language interface to deterministic OpenGravel
 * capabilities (10 §1), so its failures must be as honest as every other
 * optional provider: a class is a stable machine token, and the rider is told
 * what happened in OpenGravel's own words — never a vendor name, never a raw
 * model message (VNX-007 / Rule E).
 *
 * The seven classes are the contract 10 §13 names. A transport can only produce
 * a subset of them (`unavailable`, `timeout`, `rate-limit`, `invalid-request`,
 * `unsupported-action`): `grounding-failed` (10 §8) and `stale-revision` (10 §6)
 * are raised by the proposal/validation layer above the transport. All seven are
 * mapped here so the surface has one place that turns a class into copy and a
 * single recovery affordance.
 */

export const ADVISOR_ERROR_CLASSES = [
  "unavailable",
  "timeout",
  "rate-limit",
  "invalid-request",
  "unsupported-action",
  "grounding-failed",
  "stale-revision",
] as const;

export type AdvisorErrorClass = (typeof ADVISOR_ERROR_CLASSES)[number];

/**
 * The one recovery affordance the surface offers for a failed turn (10 §13
 * "Keep rider text for Retry"). A stale proposal offers `refresh` — "Refresh
 * proposal" (10 §6) — never a Retry that would silently rebase model intent.
 */
export type AdvisorRecovery = "retry" | "refresh" | "none";

export interface AdvisorRiderState {
  readonly errorClass: AdvisorErrorClass;
  readonly recovery: AdvisorRecovery;
  /** OpenGravel copy: sentence case, never a provider or engine name. */
  readonly message: string;
}

type RiderStateByClass = Readonly<
  Record<AdvisorErrorClass, Omit<AdvisorRiderState, "errorClass">>
>;

/**
 * Retry appears only where a later attempt can plausibly succeed (10 §13). A
 * malformed or unsupported request is not helped by asking again, so it is a
 * terminal state; a stale revision is corrected by refreshing the proposal, not
 * by retrying the model.
 */
const RIDER_STATES: RiderStateByClass = {
  unavailable: {
    recovery: "retry",
    message: "The advisor is unavailable right now.",
  },
  timeout: {
    recovery: "retry",
    message: "The advisor took too long to answer.",
  },
  "rate-limit": {
    recovery: "retry",
    message: "The advisor is busy. Try again in a moment.",
  },
  "invalid-request": {
    recovery: "none",
    message: "The advisor could not understand that request.",
  },
  "unsupported-action": {
    recovery: "none",
    message: "The advisor cannot do that.",
  },
  "grounding-failed": {
    recovery: "retry",
    message: "That could not be matched to the map.",
  },
  "stale-revision": {
    recovery: "refresh",
    message: "This suggestion is out of date for this ride.",
  },
};

/** The rider-safe state for one error class. */
export function advisorRiderState(errorClass: AdvisorErrorClass): AdvisorRiderState {
  const entry = RIDER_STATES[errorClass];
  return { errorClass, recovery: entry.recovery, message: entry.message };
}
