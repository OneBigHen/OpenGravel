import { liveCatalogEntries } from "@/server/community-routes/live-catalog";
import { handleCatalogDetail } from "@/server/explore/catalog-http";
import { libraryRideAsCatalogEntry } from "@/server/route-library/as-catalog-entry";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(_request: Request, context: { readonly params: Promise<{ readonly id: string }> }): Promise<Response> {
  const { id } = await context.params;
  let result = handleCatalogDetail(id, liveCatalogEntries());
  if (result.status === 404) {
    // Not a curated or shared ride: it may be one of the national library's.
    const libraryRide = libraryRideAsCatalogEntry(id);
    // A merged-away id answers with the card it became (its `id` is the new one).
    if (libraryRide !== null) result = handleCatalogDetail(libraryRide.id, [libraryRide]);
  }
  return Response.json(result.body, { status: result.status, headers: result.headers });
}
