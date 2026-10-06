import { PUBLIC_RIDE_MAX_NAME, PUBLIC_RIDE_MAX_NOTES, PUBLIC_RIDE_MAX_POINTS, PUBLIC_RIDE_MIN_METERS } from "@/application/community/public-ride";
import { randomBytes } from "node:crypto";

import { boundsForGeometry } from "@/application/explore/catalog";
import { haversine } from "@/domain/geometry/analysis";
import type { Coordinate } from "@/domain/ride/types";

export const MAX_SHARED_POINTS = PUBLIC_RIDE_MAX_POINTS;
export const MAX_SHARED_NAME = PUBLIC_RIDE_MAX_NAME;
export const MAX_SHARED_REASON = 500;
const PREVIEW_POINTS = 80;

export type ShareValidation =
  | { readonly ok: true; readonly id: string; readonly raw: Record<string, unknown> }
  | { readonly ok: false; readonly message: string };

function coordinates(value: unknown): Coordinate[] | null {
  if (!Array.isArray(value) || value.length > MAX_SHARED_POINTS) return null;
  const out: Coordinate[] = [];
  for (const pair of value) {
    if (!Array.isArray(pair) || pair.length !== 2) return null;
    const lon = pair[0];
    const lat = pair[1];
    if (typeof lon !== "number" || typeof lat !== "number" || !Number.isFinite(lon) || !Number.isFinite(lat)) return null;
    if (lon < -180 || lon > 180 || lat < -90 || lat > 90) return null;
    out.push({ lon: Math.round(lon * 1e6) / 1e6, lat: Math.round(lat * 1e6) / 1e6 });
  }
  return out;
}

function thin(line: readonly Coordinate[], count: number): Coordinate[] {
  if (line.length <= count) return [...line];
  const out: Coordinate[] = [];
  for (let index = 0; index < count; index += 1) out.push(line[Math.round((index * (line.length - 1)) / (count - 1))]!);
  return out;
}

function lengthKm(line: readonly Coordinate[]): number {
  let meters = 0;
  for (let index = 1; index < line.length; index += 1) meters += haversine(line[index - 1]!, line[index]!);
  return meters / 1000;
}

/** Turns a rider's share request into a catalog entry, or says why not. */
export function buildSharedRoute(body: unknown, now: Date): ShareValidation {
  if (typeof body !== "object" || body === null || Array.isArray(body)) return { ok: false, message: "Send a route to share." };
  const input = body as Record<string, unknown>;
  const rawName = input["name"];
  if (typeof rawName !== "string" || /[<>\u0000-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069]/u.test(rawName)) {
    return { ok: false, message: "Use a plain-text route name without markup or control characters." };
  }
  const name = typeof input["name"] === "string" ? input["name"].trim().replace(/\s+/g, " ") : "";
  if (name.length === 0 || name.length > MAX_SHARED_NAME) return { ok: false, message: `Give the route a name of up to ${MAX_SHARED_NAME} characters.` };
  const description = input["description"];
  if (description !== undefined && (typeof description !== "string" || description.length > PUBLIC_RIDE_MAX_NOTES || /[<>\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069]/u.test(description))) {
    return { ok: false, message: "Use plain-text ride notes of up to 2,000 characters." };
  }
  const line = coordinates(input["geometry"]);
  if (line === null) return { ok: false, message: "The route line could not be read." };
  if (line.length < 2) return { ok: false, message: "A route needs at least two points." };
  if (line.length > MAX_SHARED_POINTS) return { ok: false, message: "That route is too detailed to share." };
  const distanceKm = lengthKm(line);
  if (distanceKm * 1000 < PUBLIC_RIDE_MIN_METERS) return { ok: false, message: "That route is too short to share." };
  if (distanceKm > 3000) return { ok: false, message: "That route is too long to share." };
  const id = `community_${randomBytes(9).toString("base64url")}`;
  return {
    ok: true,
    id,
    raw: {
      id,
      name,
      region: "Shared by riders",
      summary: `A ${Math.round(distanceKm * 0.621371)} mile route shared by a rider.`,
      distanceKm: Math.round(distanceKm * 10) / 10,
      bounds: boundsForGeometry(line),
      geometry: line,
      previewGeometry: thin(line, PREVIEW_POINTS),
      story: {
        source: { name: "OpenGravel riders", kind: "Rider upload" },
        sharedAt: now.toISOString(),
        ...(typeof description === "string" && description.trim() ? { description: description.trim() } : {}),
        comments: [], photos: [], stops: [],
      },
      provenance: `Shared by a rider on ${now.toISOString().slice(0, 10)}. Not checked by OpenGravel.`,
    },
  };
}

/** A removal reason, trimmed to what is kept. */
export function cleanReason(value: unknown): string {
  return typeof value === "string" ? value.trim().slice(0, MAX_SHARED_REASON) : "";
}
