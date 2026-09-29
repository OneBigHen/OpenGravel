import { handleBasemapArchive } from "@/server/offline/handler";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

interface RouteContext {
  readonly params: Promise<{ regionId: string }>;
}

async function serve(request: Request, context: RouteContext): Promise<Response> {
  const { regionId } = await context.params;
  return handleBasemapArchive(request, regionId);
}

export const GET = serve;
export const HEAD = serve;
