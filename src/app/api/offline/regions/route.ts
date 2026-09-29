import { handleRegionList } from "@/server/offline/handler";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request: Request): Promise<Response> {
  return handleRegionList(request);
}
