import { linesResponse } from "@/server/route-library/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** `/api/route-library/<version>/lines/PA.json` arrives here with `state` = `PA.json`. */
export async function GET(
  request: Request,
  context: { readonly params: Promise<{ readonly version: string; readonly state: string }> },
): Promise<Response> {
  const { version, state } = await context.params;
  return linesResponse(request, version, state);
}
