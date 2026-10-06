import type { Coordinate } from "@/domain/ride/types";

/** Thrown with words a rider can read. */
export class CommunityRouteError extends Error {}

async function post(url: string, body: unknown): Promise<Response> {
  try {
    return await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  } catch {
    throw new CommunityRouteError("Could not reach OpenGravel. Check your connection and try again.");
  }
}

async function failure(response: Response, fallback: string): Promise<CommunityRouteError> {
  try {
    const body = (await response.json()) as { error?: unknown };
    return new CommunityRouteError(typeof body.error === "string" ? body.error : fallback);
  } catch {
    return new CommunityRouteError(fallback);
  }
}

/** Shares a route line with everyone. Resolves to the new route's id. */
export async function shareRouteWithEveryone(name: string, geometry: readonly Coordinate[]): Promise<string> {
  const response = await post("/api/community/routes", { name, geometry: geometry.map((point) => [point.lon, point.lat]) });
  if (!response.ok) throw await failure(response, "The route could not be shared.");
  return ((await response.json()) as { id: string }).id;
}

/** Takes a route down for everyone, at once. The owner is told and can restore it. */
export async function removeCommunityRoute(routeId: string, reason: string): Promise<void> {
  const response = await post(`/api/community/routes/${encodeURIComponent(routeId)}/remove`, { reason });
  if (!response.ok) throw await failure(response, "The route could not be removed.");
}
