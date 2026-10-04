import { createTomTomTrafficProvider } from "@/infrastructure/traffic/tomtom";
import type { RiderFlowSegment } from "@/application/planner/rider-live-traffic";
import type { ProviderCandidate } from "@/application/planner/route-provider";

const cache = new Map<string, { expires: number; response: Response }>();

/** Eight sampled points, a three-second deadline, and one minute of flow cache. */
export function riderTrafficSampler(env: Readonly<Record<string, string | undefined>>) {
  const provider = createTomTomTrafficProvider({
    env,
    fetcher: async (url, init) => {
      const key = String(url);
      const existing = cache.get(key);
      if (existing !== undefined && existing.expires > Date.now()) return existing.response.clone();
      const response = await fetch(url, { ...init, signal: AbortSignal.any([...(init?.signal == null ? [] : [init.signal]), AbortSignal.timeout(1000)]) });
      if (response.ok) {
        if (cache.size >= 256) cache.delete(cache.keys().next().value!);
        cache.set(key, { expires: Date.now() + 60_000, response: response.clone() });
      }
      return response;
    },
  });
  return async (candidate: ProviderCandidate, signal: AbortSignal): Promise<readonly RiderFlowSegment[]> => {
    const last = candidate.geometry.length - 1;
    if (last < 1) return [];
    const count = Math.min(8, candidate.geometry.length);
    const waypoints = Array.from({ length: count }, (_, index) => candidate.geometry[Math.round(index * last / (count - 1))]!);
    const sampleSignal = AbortSignal.any([signal, AbortSignal.timeout(3000)]);
    const responses = await Promise.allSettled(waypoints.map(point => provider.getTraffic({ corridor: candidate.geometry, waypoints: [point], departureTime: new Date().toISOString(), signal: sampleSignal })));
    const segments = responses.flatMap(result => result.status === "fulfilled" && result.value.availability === "available" && result.value.freshness.status === "fresh" && result.value.departureApplicability === "current" ? result.value.segments : []);
    return [...new Map(segments.map(segment => [segment.id, segment])).values()];
  };
}
