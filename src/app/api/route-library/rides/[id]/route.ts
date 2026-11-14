import { rideResponse } from "@/server/route-library/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request, context: { readonly params: Promise<{ readonly id: string }> }): Promise<Response> {
  const { id } = await context.params;
  return rideResponse(request, decodeURIComponent(id));
}
