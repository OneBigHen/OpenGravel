import { createAddressRateLimiter } from "@/server/rate-limit";
import {
  handleContributionGet,
  handleContributionPost,
  type ContributionErrorBody,
} from "@/server/contributions/handler";
import {
  MAX_CONTRIBUTION_BODY_BYTES,
  contributionJsonResponse,
  readBoundedJson,
  sharedContributionStore,
  tooLargeResponse,
} from "@/server/contributions/http";
import type { SQLiteContributionStore } from "@/server/contributions/store";

export { MAX_CONTRIBUTION_BODY_BYTES };

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * The queue and per-reporter bounds only know a pseudonym the client mints, so
 * one script with a fresh id per request could fill the 250-slot moderation
 * queue and close it for every rider. This budget is keyed on the address the
 * reverse proxy reports instead, and stays well under the shared queue size.
 */
const limiter = createAddressRateLimiter({ windowMs: 60 * 60_000, max: 10 });

function budgetResponse(retryAfterSeconds: number): Response {
  const body: ContributionErrorBody = {
    error: {
      code: "abuse",
      message: "You have sent several notes from this connection in the last hour. Try again later.",
      details: { reason: "address-rate-limited" },
    },
  };
  return Response.json(body, {
    status: 429,
    headers: { "cache-control": "private, no-store", "retry-after": String(retryAfterSeconds) },
  });
}

export async function handleContributionPostRequest(
  request: Request,
  contributionStore: SQLiteContributionStore,
): Promise<Response> {
  const wait = limiter.check(request);
  if (wait !== null) return budgetResponse(wait);
  const declaredLength = request.headers.get("content-length");
  if (declaredLength !== null && Number(declaredLength) > MAX_CONTRIBUTION_BODY_BYTES) {
    return tooLargeResponse();
  }

  const parsed = await readBoundedJson(request);
  if (parsed.kind === "too-large") return tooLargeResponse();
  return contributionJsonResponse(await handleContributionPost(
    parsed.kind === "ok" ? parsed.body : undefined,
    { store: contributionStore },
  ));
}

export async function handleContributionGetRequest(
  request: Request,
  contributionStore: SQLiteContributionStore,
): Promise<Response> {
  const url = new URL(request.url);
  return contributionJsonResponse(await handleContributionGet({
    roadRef: url.searchParams.get("roadRef") ?? undefined,
    limit: url.searchParams.get("limit") ?? undefined,
  }, { store: contributionStore }));
}

export async function POST(request: Request): Promise<Response> {
  return handleContributionPostRequest(request, sharedContributionStore());
}

export async function GET(request: Request): Promise<Response> {
  return handleContributionGetRequest(request, sharedContributionStore());
}
