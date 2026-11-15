import { liveCatalogEntries } from "@/server/community-routes/live-catalog";
import { handleCatalogDetail } from "@/server/explore/catalog-http";
import { libraryRideAsCatalogEntry } from "@/server/route-library/as-catalog-entry";
import { removedRideResponse } from "@/server/route-library/http";
import { packTombstone } from "@/server/route-library/pack";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(_request: Request, context: { readonly params: Promise<{ readonly id: string }> }): Promise<Response> {
  const { id } = await context.params;
  let result = handleCatalogDetail(id, liveCatalogEntries());
  if (result.status === 404) {
    // Not a curated or shared ride: it may be one of the national library's.
    const libraryRide = libraryRideAsCatalogEntry(id);
    // Order: a live card, then an alias (a merged-away id answers with the card it became), then a tombstone.
    if (libraryRide !== null) result = handleCatalogDetail(libraryRide.id, [libraryRide]);
    else {
      const tombstone = packTombstone(id);
      if (tombstone !== null) return removedRideResponse(tombstone);
    }
  }
  return Response.json(result.body, { status: result.status, headers: result.headers });
}
