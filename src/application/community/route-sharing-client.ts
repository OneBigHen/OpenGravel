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

export interface PublicRideDetails {
  readonly description?: string;
  /** Base64 raster previews; the server independently decodes and strips metadata. */
  readonly photos?: readonly string[];
}

/** A shared route's id and the ownership proof this device must keep to remove it. */
export interface ShareRouteResult {
  readonly id: string;
  /** Proof that this device shared the route; the removal endpoint requires it. */
  readonly removalToken?: string;
}

/** Shares a route line with everyone. Resolves to the new route's id and ownership proof. */
export async function shareRouteWithEveryone(name: string, geometry: readonly Coordinate[], details: PublicRideDetails = {}): Promise<ShareRouteResult> {
  const response = await post("/api/community/routes", { name, geometry: geometry.map((point) => [point.lon, point.lat]), ...(details.description ? { description: details.description } : {}), ...(details.photos?.length ? { photos: details.photos } : {}) });
  if (!response.ok) throw await failure(response, "The route could not be shared.");
  const body = (await response.json()) as { id: string; removalToken?: unknown };
  return typeof body.removalToken === "string"
    ? { id: body.id, removalToken: body.removalToken }
    : { id: body.id };
}

/** Takes down a route this device shared. The owner token is the proof of ownership. */
export async function removeCommunityRoute(routeId: string, reason: string, ownerToken: string): Promise<void> {
  const response = await post(`/api/community/routes/${encodeURIComponent(routeId)}/remove`, { reason, ownerToken });
  if (!response.ok) throw await failure(response, "The route could not be removed.");
}
