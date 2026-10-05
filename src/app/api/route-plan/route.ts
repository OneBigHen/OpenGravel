/**
 * The `/api/route-plan` route file (02-ARCHITECTURE-CONTRACT §11;
 * 23-API-CONTRACTS §2–§3, §15).
 *
 * A thin adapter: it reads the JSON body, delegates to the testable handler, and
 * maps the handler's status/headers onto a `Response`. All validation, service
 * wiring and status mapping live in `src/server/**`, so the endpoint stays
 * covered by unit tests instead of only by a running server.
 */

import { createApiGuard, guarded } from "@/server/api-guard";
import { handleRoutePlanRequest } from "@/server/planning/route-handler";

const guard = createApiGuard({ perMinute: 20, maxConcurrent: 6 });

export async function POST(request: Request): Promise<Response> {
  return guarded(guard, request, () => plan(request));
}

async function plan(request: Request): Promise<Response> {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    // An unreadable body is malformed input, reported by the same authority as
    // every other validation failure.
    body = undefined;
  }

  const result = await handleRoutePlanRequest(body, {}, request.signal);
  return Response.json(result.body, {
    status: result.status,
    headers: { ...result.headers },
  });
}
