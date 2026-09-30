import { publicShareStore } from "@/server/sharing/public-share-store";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function GET(_request: Request, context: { params: Promise<{ token: string }> }): Promise<Response> {
  const result = publicShareStore().resolve((await context.params).token);
  const headers = { "cache-control": "no-store", "referrer-policy": "no-referrer", "x-robots-tag": "noindex, nofollow" };
  return result.state === "active"
    ? new Response(result.output, { headers: { ...headers, "content-type": "application/json" } })
    : Response.json({ state: result.state }, { status: result.state === "revoked" ? 410 : 404, headers });
}
