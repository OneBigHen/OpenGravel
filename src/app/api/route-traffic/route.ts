import { createApiGuard, guarded } from "@/server/api-guard";
import { handleRouteTrafficRequest } from "@/server/traffic/route-handler";

const guard = createApiGuard({ perMinute: 30, maxConcurrent: 4 });

export async function POST(request: Request): Promise<Response> {
  return guarded(guard, request, () => traffic(request));
}

async function traffic(request: Request): Promise<Response> {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    body = undefined;
  }
  const result = await handleRouteTrafficRequest(body, {}, request.signal);
  return Response.json(result.body, {
    status: result.status,
    headers: { "cache-control": "no-store" },
  });
}
