import { createApiGuard, guarded } from "@/server/api-guard";
import { handleDiscoverCorridor, handleDiscoverNear } from "@/server/discover/handler";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const guard = createApiGuard({ perMinute: 30, maxConcurrent: 4 });

export async function GET(request: Request): Promise<Response> {
  return guarded(guard, request, () => near(request));
}

async function near(request: Request): Promise<Response> {
  let url: URL;
  try {
    url = new URL(request.url);
  } catch {
    return Response.json({ error: { code: "validation", message: "Malformed query." } }, { status: 400 });
  }
  const result = await handleDiscoverNear(url, {}, request.signal);
  return Response.json(result.body, { status: result.status, headers: { "cache-control": "private, max-age=60" } });
}

export async function POST(request: Request): Promise<Response> {
  return guarded(guard, request, () => corridor(request));
}

async function corridor(request: Request): Promise<Response> {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: { code: "validation", message: "A JSON body is required." } }, { status: 400 });
  }
  const result = await handleDiscoverCorridor(body, {}, request.signal);
  return Response.json(result.body, { status: result.status, headers: { "cache-control": "private, max-age=60" } });
}
