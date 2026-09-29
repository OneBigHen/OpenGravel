/**
 * The advisor transport port (10 §14, 02-ARCHITECTURE-CONTRACT §19).
 *
 * This is the model-independent seam: the advisor calls a language model to
 * phrase structured evidence (10 §18), and this port is the only thing that
 * knows how that call is made. It carries **plain data only** — a bounded list
 * of messages in, either a completion's text or a classified failure out — so no
 * product code can come to depend on a model-specific output shape (10 §14) or
 * on a vendor's SDK.
 *
 * Model selection is deployment config: an adapter is built for one endpoint +
 * model + server-side key (15 §... / 10 §15) and swapped by config alone. The
 * application layer never sees a provider type, a provider message or a secret.
 *
 * ## Why a result instead of a thrown error
 *
 * Every model outcome is a value: `send` resolves to an
 * {@link AdvisorTransportResult} and never throws for a provider reason, so the
 * caller classifies failures from a stable {@link AdvisorErrorClass} rather than
 * from vendor text (10 §13). The one exception is a caller-initiated abort: the
 * caller's own `AbortSignal` re-throws its reason, because stopping on request
 * is not a model failure to report to the rider.
 */

import { advisorRiderState, type AdvisorErrorClass } from "../advisor-errors";

export type AdvisorMessageRole = "system" | "user" | "assistant";

/** One bounded conversational turn. Imported-route names are untrusted data. */
export interface AdvisorMessage {
  readonly role: AdvisorMessageRole;
  readonly content: string;
}

export interface AdvisorTransportRequest {
  /** Bounded message list; the tool/prompt layer keeps this small (10 §3/§15). */
  readonly messages: readonly AdvisorMessage[];
  /** Optional strict structured output contract, translated by the adapter. */
  readonly outputSchema?: AdvisorOutputSchema;
  readonly signal?: AbortSignal;
}

/** Model-neutral JSON Schema boundary; vendor wire names stay in infrastructure. */
export interface AdvisorOutputSchema {
  readonly name: string;
  readonly schema: Readonly<Record<string, unknown>>;
}

export interface AdvisorTransportSuccess {
  readonly ok: true;
  /**
   * The model's completion text. It is never trusted here: a post-generation
   * validator owns schema and numeric grounding (10 §14, §18).
   */
  readonly text: string;
}

export interface AdvisorTransportFailure {
  readonly ok: false;
  readonly errorClass: AdvisorErrorClass;
  /** `true` only for `recovery === "retry"` states (10 §13). */
  readonly retryable: boolean;
  /** Rider-safe copy; never a provider message or a secret. */
  readonly message: string;
}

export type AdvisorTransportResult =
  | AdvisorTransportSuccess
  | AdvisorTransportFailure;

export interface AdvisorTransport {
  send(request: AdvisorTransportRequest): Promise<AdvisorTransportResult>;
}

/**
 * Builds a transport failure whose copy and retryability always agree with the
 * class's rider-safe state, so an adapter only names the class.
 */
export function advisorFailure(
  errorClass: AdvisorErrorClass,
): AdvisorTransportFailure {
  const state = advisorRiderState(errorClass);
  return {
    ok: false,
    errorClass,
    retryable: state.recovery === "retry",
    message: state.message,
  };
}
