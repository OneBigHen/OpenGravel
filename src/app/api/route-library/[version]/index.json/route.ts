import { indexResponse } from "@/server/route-library/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request, context: { readonly params: Promise<{ readonly version: string }> }): Promise<Response> {
  const { version } = await context.params;
  return indexResponse(request, version);
}
