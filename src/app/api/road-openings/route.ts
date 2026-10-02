import { handleRoadOpeningsRequest } from "@/server/road-openings/openings-handler";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request: Request): Promise<Response> {
  return handleRoadOpeningsRequest(request);
}
