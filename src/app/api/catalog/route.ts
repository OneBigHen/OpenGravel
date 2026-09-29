import { serverCatalogEntries } from "@/server/explore/catalog-data";
import { handleCatalogList } from "@/server/explore/catalog-http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export function GET(request: Request): Response {
  const result = handleCatalogList(new URL(request.url), serverCatalogEntries);
  return Response.json(result.body, { status: result.status, headers: result.headers });
}
