import { handleBasemapTile } from "@/server/offline/basemap-tiles";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

interface RouteContext {
  readonly params: Promise<{ z: string; x: string; y: string }>;
}

async function serve(request: Request, context: RouteContext): Promise<Response> {
  return handleBasemapTile(request, await context.params);
}

export const GET = serve;
export const HEAD = serve;
