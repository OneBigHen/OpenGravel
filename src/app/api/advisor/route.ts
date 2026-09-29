import type { PlaceSearchPort } from "@/application/geocoding/place-search";
import { advisorTransportFromEnv } from "@/infrastructure/advisor/advisor-transport";
import { geocodeDependencies } from "@/app/api/geocode/geocoder";
import { createRateLimiter } from "@/server/rate-limit";
import { handleAdvisorRequest } from "@/server/advisor/handler";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const limiter = createRateLimiter({ windowMs: 60_000, max: 8 });

const places: PlaceSearchPort = {
  async search(query, options = {}) {
    try {
      const matches = await geocodeDependencies.search(
        query,
        options.bias ?? geocodeDependencies.defaultBias,
        options.signal ?? new AbortController().signal,
      );
      return { status: "ok", places: matches };
    } catch {
      return { status: "unavailable", reason: "Place search is unavailable right now." };
    }
  },
  async reverse(coordinate, options = {}) {
    try {
      return await geocodeDependencies.reverse(coordinate, options.signal ?? new AbortController().signal);
    } catch {
      return null;
    }
  },
};

export async function POST(request: Request): Promise<Response> {
  return handleAdvisorRequest(request, {
    transport: advisorTransportFromEnv(),
    places,
    limiter,
  });
}
