import { clientIpFromForwardedFor, handleCatalogCommunityGet, handleCatalogCommunityPost } from "@/server/contributions/catalog-community";
import { SQLiteCatalogCommunityStore } from "@/server/contributions/catalog-community-store";
import { sharedContributionStore } from "@/server/contributions/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

let store: SQLiteCatalogCommunityStore | undefined;
function sharedStore(): SQLiteCatalogCommunityStore { return store ??= new SQLiteCatalogCommunityStore(); }

function json(result: { readonly status: number; readonly body: Readonly<Record<string, unknown>>; readonly headers: Readonly<Record<string, string>> }): Response {
  return Response.json(result.body, { status: result.status, headers: result.headers });
}

export async function GET(_request: Request, context: { readonly params: Promise<{ readonly id: string }> }): Promise<Response> {
  const { id } = await context.params;
  return json(await handleCatalogCommunityGet(id, { store: sharedStore(), contributions: sharedContributionStore() }));
}

export async function POST(request: Request, context: { readonly params: Promise<{ readonly id: string }> }): Promise<Response> {
  const { id } = await context.params;
  const length = Number(request.headers.get("content-length") ?? "0");
  if (length > 4_096) return json({ status: 413, body: { error: "Submission is too large." }, headers: { "cache-control": "private, no-store" } });
  try {
    const body = await request.json() as unknown;
    if (new TextEncoder().encode(JSON.stringify(body)).byteLength > 4_096) return json({ status: 413, body: { error: "Submission is too large." }, headers: { "cache-control": "private, no-store" } });
    return json(await handleCatalogCommunityPost(id, body, {
      store: sharedStore(),
      contributions: sharedContributionStore(),
      clientIp: clientIpFromForwardedFor(request.headers.get("x-forwarded-for")),
    }));
  } catch {
    return json({ status: 400, body: { error: "Submission must be valid JSON." }, headers: { "cache-control": "private, no-store" } });
  }
}
