import { createApiGuard, guarded } from "@/server/api-guard";
import { handlePlacesAlongRequest } from "@/server/places/handler";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const guard = createApiGuard({ perMinute: 30, maxConcurrent: 4 });

export async function POST(request: Request): Promise<Response> {
  return guarded(guard, request, () => along(request));
}

async function along(request: Request): Promise<Response> {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    body = undefined;
  }
  const result = await handlePlacesAlongRequest(body, {}, request.signal);
  return Response.json(result.body, {
    status: result.status,
    headers: { "cache-control": "no-store" },
  });
}
