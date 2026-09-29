import {
  handleContributionGet,
  handleContributionPost,
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

export async function handleContributionPostRequest(
  request: Request,
  contributionStore: SQLiteContributionStore,
): Promise<Response> {
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
