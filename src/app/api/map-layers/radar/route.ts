import { createApiGuard, guarded } from "@/server/api-guard";
import { handleRadarFramesRequest } from "@/server/map-layers/rainviewer";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * The RainViewer frame list for the animated rain layer. Cached on the server for
 * five minutes, so clients share one upstream read; see
 * `src/server/map-layers/rainviewer.ts`.
 */
const guard = createApiGuard({ perMinute: 120, maxConcurrent: 4 });

export async function GET(request: Request): Promise<Response> {
  return guarded(guard, request, () => handleRadarFramesRequest());
}
