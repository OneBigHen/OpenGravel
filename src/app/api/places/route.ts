import { createApiGuard, guarded } from "@/server/api-guard";
import { handlePlacesExtentRequest } from "@/server/places/handler";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const guard = createApiGuard({ perMinute: 60, maxConcurrent: 6 });

export async function GET(request: Request): Promise<Response> {
  return guarded(guard, request, () => extent(request));
}

async function extent(request: Request): Promise<Response> {
  let url: URL;
  try {
    url = new URL(request.url);
  } catch {
    return Response.json({ error: { code: "validation", message: "Malformed query." } }, { status: 400 });
  }
  const result = await handlePlacesExtentRequest(url, {}, request.signal);
  return Response.json(result.body, {
    status: result.status,
    headers: { "cache-control": "private, max-age=30" },
  });
}
