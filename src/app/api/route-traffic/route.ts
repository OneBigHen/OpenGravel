import { handleRouteTrafficRequest } from "@/server/traffic/route-handler";

export async function POST(request: Request): Promise<Response> {
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
