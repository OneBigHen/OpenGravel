/**
 * The model-independent advisor transport adapter (10 §14, 02-ARCHITECTURE-CONTRACT §19).
 *
 * One concrete {@link AdvisorTransport} that speaks a widely-compatible
 * chat-completions wire: `POST {endpoint}` with `{ model, messages }` and a
 * server-side bearer key, reading the completion back from
 * `choices[0].message.content`. Because the application layer sees only the
 * plain-data port, a deployment swaps model or vendor by config alone (10 §14);
 * a provider with a different wire (e.g. Gemini) is a sibling adapter behind the
 * same port.
 *
 * Every model outcome is normalized into an {@link AdvisorErrorClass} (10 §13):
 * the mapping below turns HTTP/network/timeout failures into stable classes, and
 * the rider copy comes from the application's class table — never a vendor
 * message, never the key (10 §15, OGV-D-162). Literal imports only in this
 * region so the boundary stays statically verifiable (OGV-D-136).
 */

import {
  advisorFailure,
  type AdvisorTransport,
  type AdvisorTransportResult,
  type AdvisorErrorClass,
} from "@/application/advisor";
import {
  DEFAULT_OPENROUTER_ENDPOINT,
  advisorFallbackSettingsFromEnv,
  advisorTransportSettingsFromEnv,
  type AdvisorTransportSettings,
} from "./config";

/** Ceiling for one model call; a transport never waits forever. */
export const DEFAULT_ADVISOR_TIMEOUT_MS = 30_000;
/** With a fallback behind it, the first model gets less time before the rider is handed over. */
export const PRIMARY_WITH_FALLBACK_TIMEOUT_MS = 12_000;
/** Failures a second model can fix; the rider's own request errors are not among them. */
const FALLBACK_CLASSES: ReadonlySet<AdvisorErrorClass> = new Set(["rate-limit", "timeout", "unavailable"]);
const OPENROUTER_PROPOSAL_COMPLETION_TOKENS = 1_200;

export interface AdvisorTransportOptions {
  readonly fetcher?: typeof fetch;
  readonly timeoutMs?: number;
}

type JsonRecord = Record<string, unknown>;

function record(value: unknown): JsonRecord | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as JsonRecord)
    : null;
}

/**
 * Maps a non-OK HTTP status to a 10 §13 error class. Order matters: a rate
 * limit and a timeout are transient and specific, a wrong endpoint/model is an
 * unsupported action, a malformed request is the caller's fault, and everything
 * server-side or unauthenticated is an outage the rider did not cause.
 */
export function advisorErrorClassForStatus(status: number): AdvisorErrorClass {
  if (status === 429) return "rate-limit";
  if (status === 408 || status === 504 || status === 522 || status === 524) return "timeout";
  if (status === 404 || status === 405 || status === 415) return "unsupported-action";
  if (status === 400 || status === 413 || status === 422) return "invalid-request";
  // 402: the model account is out of credits or quota — an outage, not the rider's words.
  if (status === 401 || status === 402 || status === 403) return "unavailable";
  if (status >= 500) return "unavailable";
  if (status >= 400) return "invalid-request";
  return "unavailable";
}

/** Reads `choices[0].message.content`; anything else is not a usable completion. */
function extractCompletionText(body: unknown): string | null {
  const choices = record(body)?.["choices"];
  if (!Array.isArray(choices) || choices.length === 0) return null;
  const content = record(record(choices[0])?.["message"])?.["content"];
  return typeof content === "string" ? content : null;
}

/** Builds one transport bound to a deployment's endpoint, model and key. */
export function createAdvisorTransport(
  settings: AdvisorTransportSettings,
  options: AdvisorTransportOptions = {},
): AdvisorTransport {
  const fetcher = options.fetcher ?? fetch;
  const timeoutMs = options.timeoutMs ?? DEFAULT_ADVISOR_TIMEOUT_MS;
  return {
    async send(request): Promise<AdvisorTransportResult> {
      const callerSignal = request.signal;
      const controller = new AbortController();
      let timedOut = false;
      const timer = setTimeout(() => {
        timedOut = true;
        controller.abort();
      }, timeoutMs);
      const onCallerAbort = (): void => controller.abort();
      callerSignal?.addEventListener("abort", onCallerAbort, { once: true });
      try {
        const response = await fetcher(settings.endpoint, {
          method: "POST",
          headers: {
            "content-type": "application/json",
            accept: "application/json",
            // Server-side authorization only; the key never leaves this call.
            authorization: `Bearer ${settings.apiKey}`,
          },
          body: JSON.stringify({
            model: settings.model,
            messages: request.messages,
            ...(request.outputSchema === undefined
              ? {}
              : {
                  response_format: {
                    type: "json_schema",
                    json_schema: {
                      name: request.outputSchema.name,
                      strict: true,
                      schema: request.outputSchema.schema,
                    },
                  },
                }),
            ...(request.outputSchema === undefined
              ? {}
              : settings.endpoint === DEFAULT_OPENROUTER_ENDPOINT
                ? {
                    max_completion_tokens: OPENROUTER_PROPOSAL_COMPLETION_TOKENS,
                    reasoning: { effort: "none" },
                  }
                : { max_tokens: 700 }),
          }),
          signal: controller.signal,
        });
        if (!response.ok) return advisorFailure(advisorErrorClassForStatus(response.status));
        const text = extractCompletionText(await response.json().catch(() => null));
        return text === null ? advisorFailure("unavailable") : { ok: true, text };
      } catch {
        // A caller abort is not a model failure: re-throw the caller's reason.
        if (callerSignal?.aborted) throw callerSignal.reason;
        if (timedOut) return advisorFailure("timeout");
        // A network rejection is an outage; its detail is server diagnostics
        // (13 §13), never rider copy.
        return advisorFailure("unavailable");
      } finally {
        clearTimeout(timer);
        callerSignal?.removeEventListener("abort", onCallerAbort);
      }
    },
  };
}

/**
 * Tries `primary`, and hands the same request to `fallback` when the first
 * model is rate-limited, timed out or down. A caller abort is never retried.
 */
export function withAdvisorFallback(primary: AdvisorTransport, fallback: AdvisorTransport): AdvisorTransport {
  return {
    async send(request): Promise<AdvisorTransportResult> {
      const first = await primary.send(request);
      if (first.ok || !FALLBACK_CLASSES.has(first.errorClass) || request.signal?.aborted === true) return first;
      return fallback.send(request);
    },
  };
}

/**
 * The deployment's transport, or `null` when no model is configured. Callers
 * gate on {@link advisorCapabilityFromEnv} and never reach a transport in a
 * no-key deployment (10 §2).
 */
export function advisorTransportFromEnv(
  env: Readonly<Record<string, string | undefined>> = process.env,
  options: AdvisorTransportOptions = {},
): AdvisorTransport | null {
  const settings = advisorTransportSettingsFromEnv(env);
  if (settings === null) return null;
  const fallback = advisorFallbackSettingsFromEnv(env);
  if (fallback === null) return createAdvisorTransport(settings, options);
  return withAdvisorFallback(
    createAdvisorTransport(settings, { ...options, timeoutMs: options.timeoutMs ?? PRIMARY_WITH_FALLBACK_TIMEOUT_MS }),
    createAdvisorTransport(fallback, options),
  );
}
