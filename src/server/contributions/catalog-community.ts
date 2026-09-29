import type { SQLiteCatalogCommunityStore, CatalogCommunityStoreOptions } from "./catalog-community-store";
import type { ContributionStore } from "./store";
import { asRoadEntityId, asRoadSpanId } from "@/domain/ride/ids";
import { isIP } from "node:net";

export const CATALOG_COMMUNITY_RESPONSE_HEADERS = { "cache-control": "private, no-store" };
export const UNKNOWN_CLIENT_IP = "unknown-client";

export function clientIpFromForwardedFor(value: string | null): string {
  const firstHop = value?.split(",", 1)[0]?.trim();
  return firstHop !== undefined && isIP(firstHop) !== 0 ? firstHop : UNKNOWN_CLIENT_IP;
}

export interface CatalogCommunityHandlerResult {
  readonly status: number;
  readonly body: Readonly<Record<string, unknown>>;
  readonly headers: Readonly<Record<string, string>>;
}

interface CommunityDependencies extends CatalogCommunityStoreOptions {
  readonly store: SQLiteCatalogCommunityStore;
  readonly contributions: ContributionStore;
  readonly clientIp?: string;
}

function response(status: number, body: Readonly<Record<string, unknown>>): CatalogCommunityHandlerResult {
  return { status, body, headers: CATALOG_COMMUNITY_RESPONSE_HEADERS };
}

function validRouteId(value: string): boolean {
  return /^[A-Za-z0-9_-]{1,120}$/.test(value);
}

function validDeviceId(value: unknown): value is string {
  return typeof value === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

export async function handleCatalogCommunityGet(routeId: string, dependencies: CommunityDependencies): Promise<CatalogCommunityHandlerResult> {
  if (!validRouteId(routeId)) return response(400, { error: "Invalid route id." });
  const rating = dependencies.store.ratingSummary(routeId);
  const roadRef = { roadId: asRoadEntityId(`road_${routeId}`), spanId: asRoadSpanId(`span_${routeId}`) };
  const comments = dependencies.contributions.list(roadRef, 100)
    .filter((record) => record.state === "accepted"
      && record.envelope.kind === "condition"
      && record.envelope.value.tag === "comment"
      && typeof record.envelope.value.note === "string")
    .map((record) => ({
      id: record.id,
      text: record.envelope.kind === "condition" ? record.envelope.value.note ?? "" : "",
      postedAt: record.receivedAt,
      authorLabel: "Anonymous rider" as const,
    }));
  return response(200, {
    ratingAverage: rating.average,
    ratingCount: rating.count,
    comments,
  });
}

export async function handleCatalogCommunityPost(routeId: string, body: unknown, dependencies: CommunityDependencies): Promise<CatalogCommunityHandlerResult> {
  if (!validRouteId(routeId)) return response(400, { error: "Invalid route id." });
  if (typeof body !== "object" || body === null || Array.isArray(body)) return response(400, { error: "A community submission is required." });
  const input = body as Record<string, unknown>;
  if (!validDeviceId(input.deviceId)) return response(400, { error: "A valid device id is required." });
  if (input.kind === "rating") {
    if (!Number.isInteger(input.rating) || Number(input.rating) < 1 || Number(input.rating) > 5) return response(400, { error: "Rating must be an integer from 1 to 5." });
    const rating = dependencies.store.recordRating(routeId, input.deviceId, Number(input.rating), dependencies.clientIp ?? UNKNOWN_CLIENT_IP);
    return rating === null ? response(429, { error: "Too many community submissions. Try again later." }) : response(201, { ratingAverage: rating.average, ratingCount: rating.count });
  }
  return response(400, { error: "Only ratings are accepted here. Comments and road reports use contribution moderation." });
}
