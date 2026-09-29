import { handleRegionManifest } from "@/server/offline/handler";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

interface RouteContext {
  readonly params: Promise<{ regionId: string }>;
}

export async function GET(request: Request, context: RouteContext): Promise<Response> {
  const { regionId } = await context.params;
  return handleRegionManifest(request, regionId);
}
