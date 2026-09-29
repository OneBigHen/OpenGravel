import { handleMapLayersRequest } from "@/server/map-layers/handler";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request: Request): Promise<Response> {
  let url: URL;
  try {
    url = new URL(request.url);
  } catch {
    return Response.json({ error: { code: "validation", message: "Malformed query." } }, { status: 400 });
  }
  const result = await handleMapLayersRequest(url, {}, request.signal);
  return Response.json(result.body, {
    status: result.status,
    headers: { "cache-control": "private, max-age=60" },
  });
}
