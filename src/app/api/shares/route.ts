import { createAddressRateLimiter } from "@/server/rate-limit";
import { handlePublishShare } from "@/server/sharing/public-share-handler";
import { publicShareStore, type SQLitePublicShareStore } from "@/server/sharing/public-share-store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Link creation is cheap for us but permanent for the shared store, and the
 * same-origin check is no obstacle to a script. One address gets ten links an
 * hour; the store keeps its own per-browser hour and the disk budget, so a
 * single page cannot spend either for everyone.
 */
const limiter = createAddressRateLimiter({ windowMs: 60 * 60_000, max: 10 });
const LIMIT_HEADERS = {
  "cache-control": "no-store",
  "referrer-policy": "no-referrer",
  "x-robots-tag": "noindex, nofollow",
} as const;

export async function handlePublishShareRequest(
  request: Request,
  store: SQLitePublicShareStore,
): Promise<Response> {
  const wait = limiter.check(request);
  if (wait !== null) {
    return Response.json(
      { message: "You have created too many share links in the last hour. Try again later." },
      { status: 429, headers: { ...LIMIT_HEADERS, "retry-after": String(wait) } },
    );
  }
  return handlePublishShare(request, store);
}

export async function POST(request: Request): Promise<Response> {
  return handlePublishShareRequest(request, publicShareStore());
}
