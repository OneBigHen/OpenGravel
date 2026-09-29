import { handleElevationRequest } from "@/server/elevation/handler";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(request: Request): Promise<Response> {
  return handleElevationRequest(request);
}
