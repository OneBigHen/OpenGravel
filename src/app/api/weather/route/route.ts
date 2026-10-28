import { createApiGuard, guarded } from "@/server/api-guard";
import { handleRouteWeatherRequest } from "@/server/weather/route-weather";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// Weather along the route asks the same free agency as the point forecast, but
// once per cell along a whole ride, so the budget is tighter than `/api/weather`.
const guard = createApiGuard({ perMinute: 30, maxConcurrent: 4 });

export async function POST(request: Request): Promise<Response> {
  return guarded(guard, request, () => handleRouteWeatherRequest(request));
}
