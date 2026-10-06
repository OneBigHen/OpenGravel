import { liveCatalogEntries } from "@/server/community-routes/live-catalog";
import { handleCatalogList } from "@/server/explore/catalog-http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export function GET(request: Request): Response {
  const result = handleCatalogList(new URL(request.url), liveCatalogEntries());
  return Response.json(result.body, { status: result.status, headers: result.headers });
}
