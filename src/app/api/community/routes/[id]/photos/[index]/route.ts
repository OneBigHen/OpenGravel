import { sharedCommunityRouteStore } from "@/server/community-routes/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const HEADERS = { "cache-control": "private, no-store", "x-content-type-options": "nosniff" };

/** Serves only a normalized image of a currently visible route. */
export async function GET(_request: Request, context: { readonly params: Promise<{ readonly id: string; readonly index: string }> }): Promise<Response> {
  const { id, index } = await context.params;
  if (!/^community_[A-Za-z0-9_-]{1,40}$/.test(id) || !/^[0-2]$/.test(index)) return new Response(null, { status: 404, headers: HEADERS });
  const photo = sharedCommunityRouteStore().photo(id, Number(index));
  if (photo === null) return new Response(null, { status: 404, headers: HEADERS });
  return new Response(new Uint8Array(photo.bytes), { headers: { ...HEADERS, "content-type": "image/webp", "content-disposition": 'inline; filename="ride-photo.webp"', "content-security-policy": "default-src 'none'; sandbox" } });
}
