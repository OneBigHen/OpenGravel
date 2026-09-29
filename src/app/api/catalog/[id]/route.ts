import { serverCatalogEntries } from "@/server/explore/catalog-data";
import { handleCatalogDetail } from "@/server/explore/catalog-http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(_request: Request, context: { readonly params: Promise<{ readonly id: string }> }): Promise<Response> {
  const { id } = await context.params;
  const result = handleCatalogDetail(id, serverCatalogEntries);
  return Response.json(result.body, { status: result.status, headers: result.headers });
}
