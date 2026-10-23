/** Browser adapter for OpenGravel's own advisor route; it never receives a key. */

import {
  ADVISOR_ERROR_CLASSES,
  advisorRiderState,
  parseAdvisorDraftReply,
  type AdvisorDraftResult,
  type AdvisorErrorClass,
  type AdvisorProposalClient,
} from "@/application/advisor";

/**
 * The browser's own ceiling on one advisor turn. The server applies a shorter
 * deadline, so its honest "took too long" class normally arrives first; this is
 * the backstop for a stalled connection that never answers at all.
 */
export const ADVISOR_CLIENT_DEADLINE_MS = 22_000;

export interface AdvisorApiClientOptions {
  readonly fetcher?: typeof fetch;
  readonly path?: string;
  /** Overrides {@link ADVISOR_CLIENT_DEADLINE_MS}; tests and constrained clients. */
  readonly deadlineMs?: number;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function errorClass(value: unknown): AdvisorErrorClass | null {
  return typeof value === "string" && (ADVISOR_ERROR_CLASSES as readonly string[]).includes(value)
    ? value as AdvisorErrorClass
    : null;
}

function errorForStatus(status: number): AdvisorErrorClass {
  if (status === 429) return "rate-limit";
  if (status === 408 || status === 504) return "timeout";
  if (status === 400 || status === 413 || status === 422) return "invalid-request";
  return "unavailable";
}

/** Seconds the server asked the client to wait, when it said so. */
function retryAfterSeconds(response: Response): number | null {
  const header = response.headers.get("retry-after");
  if (header === null) return null;
  const seconds = Number(header);
  return Number.isFinite(seconds) && seconds >= 0 ? seconds : null;
}

/** Creates the browser-side advisor client. The server alone owns provider config. */
export function createAdvisorApiClient(options: AdvisorApiClientOptions = {}): AdvisorProposalClient {
  const path = options.path ?? "/api/advisor";
  const fetcher = options.fetcher ?? fetch;
  const deadlineMs = options.deadlineMs ?? ADVISOR_CLIENT_DEADLINE_MS;
  return {
    async request(request, signal): Promise<AdvisorDraftResult> {
      // One deadline for the whole turn: a slow response and a stalled body read
      // count against the same budget, so the sheet cannot hang for a minute.
      const attempt = new AbortController();
      const onCallerAbort = (): void => attempt.abort();
      let rejectCancelled: () => void = () => undefined;
      const cancelled = new Promise<never>((_resolve, reject) => {
        rejectCancelled = () => reject(signal?.reason);
      });
      if (signal?.aborted === true) {
        attempt.abort();
        rejectCancelled();
      } else {
        signal?.addEventListener("abort", onCallerAbort, { once: true });
        signal?.addEventListener("abort", rejectCancelled, { once: true });
      }
      let timer: ReturnType<typeof setTimeout> | undefined;
      const deadline = new Promise<null>((resolve) => {
        timer = setTimeout(() => {
          attempt.abort();
          resolve(null);
        }, deadlineMs);
      });
      try {
        const work = (async (): Promise<AdvisorDraftResult | null> => {
          const response = await fetcher(path, {
            method: "POST",
            headers: { "content-type": "application/json", accept: "application/json" },
            body: JSON.stringify(request),
            signal: attempt.signal,
          });
          const body: unknown = await response.json().catch(() => null);
          if (!response.ok) {
            const serverClass = isRecord(body) && isRecord(body["error"])
              ? errorClass(body["error"]["class"])
              : null;
            const state = advisorRiderState(serverClass ?? errorForStatus(response.status));
            const retryAfter = retryAfterSeconds(response);
            return { ok: false, ...state, ...(retryAfter === null ? {} : { retryAfterSeconds: retryAfter }) };
          }
          const draft = isRecord(body) ? parseAdvisorDraftReply(body["draft"]) : null;
          return draft === null
            ? { ok: false, ...advisorRiderState("unavailable") }
            : { ok: true, draft };
        })();
        const result = await Promise.race([work, cancelled, deadline]);
        return result ?? { ok: false, ...advisorRiderState("timeout") };
      } catch (error) {
        if (signal?.aborted === true) throw signal.reason;
        if (attempt.signal.aborted) return { ok: false, ...advisorRiderState("timeout") };
        if (error instanceof DOMException && error.name === "AbortError") throw error;
        return { ok: false, ...advisorRiderState("unavailable") };
      } finally {
        if (timer !== undefined) clearTimeout(timer);
        signal?.removeEventListener("abort", onCallerAbort);
        signal?.removeEventListener("abort", rejectCancelled);
      }
    },
  };
}
