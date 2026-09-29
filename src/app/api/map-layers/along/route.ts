import { handleStopsAlong } from "@/server/map-layers/along";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(request: Request): Promise<Response> {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: { code: "validation", message: "Body must be JSON." } }, { status: 400 });
  }
  const result = await handleStopsAlong(body, {}, request.signal);
  return Response.json(result.body, { status: result.status, headers: { "cache-control": "no-store" } });
}
