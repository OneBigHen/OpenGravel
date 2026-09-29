import { handleRegionTile } from "@/server/offline/handler";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

interface RouteContext {
  readonly params: Promise<{ regionId: string; tileId: string }>;
}

async function serve(request: Request, context: RouteContext): Promise<Response> {
  const { regionId, tileId } = await context.params;
  return handleRegionTile(request, regionId, tileId);
}

export const GET = serve;
export const HEAD = serve;
