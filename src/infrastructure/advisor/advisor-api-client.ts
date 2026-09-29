/** Browser adapter for OpenGravel's own advisor route; it never receives a key. */

import {
  ADVISOR_ERROR_CLASSES,
  advisorRiderState,
  parseAdvisorDraftReply,
  type AdvisorDraftResult,
  type AdvisorErrorClass,
  type AdvisorProposalClient,
} from "@/application/advisor";

export interface AdvisorApiClientOptions {
  readonly fetcher?: typeof fetch;
  readonly path?: string;
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

/** Creates the browser-side advisor client. The server alone owns provider config. */
export function createAdvisorApiClient(options: AdvisorApiClientOptions = {}): AdvisorProposalClient {
  const path = options.path ?? "/api/advisor";
  const fetcher = options.fetcher ?? fetch;
  return {
    async request(request, signal): Promise<AdvisorDraftResult> {
      try {
        const response = await fetcher(path, {
          method: "POST",
          headers: { "content-type": "application/json", accept: "application/json" },
          body: JSON.stringify(request),
          ...(signal === undefined ? {} : { signal }),
        });
        const body: unknown = await response.json().catch(() => null);
        if (!response.ok) {
          const serverClass = isRecord(body) && isRecord(body["error"])
            ? errorClass(body["error"]["class"])
            : null;
          const state = advisorRiderState(serverClass ?? errorForStatus(response.status));
          return { ok: false, ...state };
        }
        const draft = isRecord(body) ? parseAdvisorDraftReply(body["draft"]) : null;
        return draft === null
          ? { ok: false, ...advisorRiderState("unavailable") }
          : { ok: true, draft };
      } catch (error) {
        if (signal?.aborted) throw signal.reason;
        if (error instanceof DOMException && error.name === "AbortError") throw error;
        return { ok: false, ...advisorRiderState("unavailable") };
      }
    },
  };
}
