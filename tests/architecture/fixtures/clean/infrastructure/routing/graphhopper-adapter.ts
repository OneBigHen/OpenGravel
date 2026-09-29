import type { RouteProviderPort } from "./route-provider-port";

export function createGraphHopperAdapter(baseUrl: string): RouteProviderPort {
  return {
    providerId: "graphhopper",
    fetchRoute: async (requestId: string) => `${baseUrl}/${requestId}`,
  };
}
