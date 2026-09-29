import { createHash, timingSafeEqual } from "node:crypto";

import {
  CONTRIBUTION_RESPONSE_HEADERS,
  handleContributionModerationDecide,
  handleContributionModerationGet,
  type ContributionHandlerResult,
} from "./handler";
import {
  DEFAULT_CONTRIBUTION_DATABASE_PATH,
  SQLiteContributionStore,
  type ContributionStore,
} from "./store";

export const MAX_CONTRIBUTION_BODY_BYTES = 32 * 1024;
const MODERATION_ACCESS_HEADERS = { "cache-control": "private, no-store" } as const;

let defaultStore: SQLiteContributionStore | undefined;

/** The single shared store instance for the HTTP surface. */
export function sharedContributionStore(): SQLiteContributionStore {
  return defaultStore ??= new SQLiteContributionStore(DEFAULT_CONTRIBUTION_DATABASE_PATH);
}

export function contributionJsonResponse(result: ContributionHandlerResult): Response {
  return Response.json(result.body, {
    status: result.status,
    headers: { ...result.headers },
  });
}

export async function readBoundedJson(request: Request): Promise<
  | { readonly kind: "ok"; readonly body: unknown }
  | { readonly kind: "too-large" }
  | { readonly kind: "invalid" }
> {
  if (request.body === null) return { kind: "invalid" };
  const reader = request.body.getReader();
  const decoder = new TextDecoder();
  let byteCount = 0;
  let text = "";
  try {
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) break;
      byteCount += chunk.value.byteLength;
      if (byteCount > MAX_CONTRIBUTION_BODY_BYTES) {
        await reader.cancel();
        return { kind: "too-large" };
      }
      text += decoder.decode(chunk.value, { stream: true });
    }
    text += decoder.decode();
    return { kind: "ok", body: JSON.parse(text) as unknown };
  } catch {
    return { kind: "invalid" };
  }
}

export function tooLargeResponse(): Response {
  return Response.json({
    error: { code: "abuse", message: "The contribution body is too large.", details: { reason: "payload-too-large" } },
  }, {
    status: 413,
    headers: { ...CONTRIBUTION_RESPONSE_HEADERS },
  });
}

export async function handleContributionModerationGetRequest(
  request: Request,
  store: ContributionStore,
  moderationToken = process.env.OGV_MODERATION_TOKEN,
): Promise<Response> {
  const accessFailure = moderationAccessFailure(request, moderationToken);
  if (accessFailure !== null) return accessFailure;
  const url = new URL(request.url);
  return contributionJsonResponse(await handleContributionModerationGet({
    limit: url.searchParams.get("limit") ?? undefined,
  }, { store }));
}

export async function handleContributionModerationDecideRequest(
  request: Request,
  store: ContributionStore,
  moderationToken = process.env.OGV_MODERATION_TOKEN,
): Promise<Response> {
  const accessFailure = moderationAccessFailure(request, moderationToken);
  if (accessFailure !== null) return accessFailure;
  const declaredLength = request.headers.get("content-length");
  if (declaredLength !== null && Number(declaredLength) > MAX_CONTRIBUTION_BODY_BYTES) {
    return tooLargeResponse();
  }
  const parsed = await readBoundedJson(request);
  if (parsed.kind === "too-large") return tooLargeResponse();
  if (parsed.kind === "invalid") {
    return contributionJsonResponse({
      status: 400,
      body: {
        error: {
          code: "validation",
          message: "The moderation decision body must be valid JSON.",
          details: { reason: "invalid-body" },
        },
      },
      headers: { ...CONTRIBUTION_RESPONSE_HEADERS },
    });
  }
  return contributionJsonResponse(await handleContributionModerationDecide(parsed.body, { store }));
}

function moderationAccessFailure(request: Request, moderationToken: string | undefined): Response | null {
  const headers = { ...CONTRIBUTION_RESPONSE_HEADERS, ...MODERATION_ACCESS_HEADERS };
  if (moderationToken === undefined || moderationToken.length === 0) {
    return Response.json({ error: { code: "unavailable", message: "Moderation is not configured." } }, {
      status: 503,
      headers,
    });
  }
  const candidate = /^Bearer ([^\s]+)$/i.exec(request.headers.get("authorization") ?? "")?.[1] ?? "";
  const expectedDigest = createHash("sha256").update(moderationToken).digest();
  const candidateDigest = createHash("sha256").update(candidate).digest();
  if (candidate.length === 0 || !timingSafeEqual(candidateDigest, expectedDigest)) {
    return Response.json({ error: { code: "unauthorized", message: "Moderation authorization is required." } }, {
      status: 401,
      headers,
    });
  }
  return null;
}
