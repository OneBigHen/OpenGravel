import { listHikes } from "@/server/hikes/catalog";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request): Promise<Response> {
  const result = await listHikes(new URL(request.url), process.env.OGV_HIKES_PATH);
  return Response.json(result.body, { status: result.status });
}
