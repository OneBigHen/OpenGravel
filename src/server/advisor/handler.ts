/** Bounded HTTP boundary for the optional, proposal-only ride advisor. */

import {
  advisorRiderState,
  parseAdvisorRequest,
  requestAdvisorDraft,
  type AdvisorErrorClass,
  type AdvisorTransport,
} from "@/application/advisor";
import type { PlaceSearchPort } from "@/application/geocoding/place-search";
import type { DailyCap, RateLimiter } from "@/server/rate-limit";

export const MAX_ADVISOR_REQUEST_BYTES = 8 * 1024;

export interface AdvisorHandlerDependencies {
  readonly transport: AdvisorTransport | null;
  readonly places: PlaceSearchPort;
  readonly limiter: RateLimiter;
  /** Process-wide daily budget so one crowd cannot exhaust the free-tier model quota for everyone. */
  readonly dailyCap?: DailyCap;
}

type BodyRead =
  | { readonly status: "ok"; readonly text: string }
  | { readonly status: "invalid" | "too-large" };

async function readBoundedBody(request: Request): Promise<BodyRead> {
  const declared = request.headers.get("content-length");
  if (declared !== null) {
    const length = Number(declared);
    if (!Number.isSafeInteger(length) || length < 0) return { status: "invalid" };
    if (length > MAX_ADVISOR_REQUEST_BYTES) return { status: "too-large" };
  }
  const reader = request.body?.getReader();
  if (reader === undefined) return { status: "invalid" };
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const part = await reader.read();
      if (part.done) break;
      size += part.value.byteLength;
      if (size > MAX_ADVISOR_REQUEST_BYTES) {
        await reader.cancel();
        return { status: "too-large" };
      }
      chunks.push(part.value);
    }
  } catch {
    return { status: "invalid" };
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  try {
    return { status: "ok", text: new TextDecoder("utf-8", { fatal: true }).decode(bytes) };
  } catch {
    return { status: "invalid" };
  }
}

function statusFor(errorClass: AdvisorErrorClass): number {
  switch (errorClass) {
    case "rate-limit": return 429;
    case "timeout": return 504;
    case "invalid-request": return 400;
    case "unsupported-action":
    case "grounding-failed": return 422;
    case "stale-revision": return 409;
    case "unavailable": return 503;
  }
}

function errorResponse(errorClass: AdvisorErrorClass, retryAfter?: number): Response {
  const state = advisorRiderState(errorClass);
  return Response.json(
    { error: { class: state.errorClass, message: state.message } },
    {
      status: statusFor(errorClass),
      headers: {
        "cache-control": "private, no-store",
        ...(retryAfter === undefined ? {} : { "retry-after": String(retryAfter) }),
      },
    },
  );
}

function parseJson(text: string): unknown {
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return undefined;
  }
}

/** Handles one bounded advisor proposal request; it never logs rider text or provider failures. */
export async function handleAdvisorRequest(
  request: Request,
  dependencies: AdvisorHandlerDependencies,
): Promise<Response> {
  const retryAfter = dependencies.limiter.check(request);
  if (retryAfter !== null) return errorResponse("rate-limit", retryAfter);

  const body = await readBoundedBody(request);
  if (body.status === "too-large") return errorResponse("invalid-request");
  if (body.status !== "ok") return errorResponse("invalid-request");
  const advisorRequest = parseAdvisorRequest(parseJson(body.text));
  if (advisorRequest === null) return errorResponse("invalid-request");
  const transport = dependencies.transport;
  if (transport === null) return errorResponse("unavailable");
  const capRetry = dependencies.dailyCap?.take() ?? null;
  if (capRetry !== null) return errorResponse("rate-limit", capRetry);

  try {
    const result = await requestAdvisorDraft(
      advisorRequest,
      { transport, places: dependencies.places },
      request.signal,
    );
    if (!result.ok) return errorResponse(result.errorClass);
    return Response.json(
      { draft: result.draft },
      { headers: { "cache-control": "private, no-store" } },
    );
  } catch {
    if (request.signal.aborted) return new Response(null, { status: 499 });
    return errorResponse("unavailable");
  }
}
