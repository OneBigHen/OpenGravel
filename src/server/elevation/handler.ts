/**
 * `POST /api/elevation`: elevations for a sampled route line (UX rework phase 3).
 *
 * The body is `{ "points": [[lon, lat], …] }` with at most
 * {@link MAX_ELEVATION_POINTS} points; the answer is an `ElevationResult`.
 * `OGV_ELEVATION_FIXTURE=1` answers a deterministic rolling profile for CI and
 * the browser gates (no tile traffic), the way the other fixtures work.
 */

import type { ElevationResult, ElevationSource } from "@/application/elevation/profile";
import type { Coordinate } from "@/domain/ride/types";
import { createTerrariumElevationSource } from "@/infrastructure/elevation/terrarium-source";
import { createRateLimiter, type RateLimiter } from "@/server/rate-limit";

export const MAX_ELEVATION_POINTS = 400;

export interface ElevationHandlerDeps {
  readonly source: ElevationSource;
  readonly limiter: RateLimiter;
  readonly fixture: boolean;
}

let defaults: ElevationHandlerDeps | null = null;

export function defaultElevationDeps(): ElevationHandlerDeps {
  defaults ??= {
    source: createTerrariumElevationSource(),
    limiter: createRateLimiter({ windowMs: 60_000, max: 60 }),
    fixture: process.env.OGV_ELEVATION_FIXTURE === "1",
  };
  return defaults;
}

function parsePoints(body: unknown): readonly Coordinate[] | null {
  if (typeof body !== "object" || body === null) return null;
  const raw = (body as { points?: unknown }).points;
  if (!Array.isArray(raw) || raw.length < 2 || raw.length > MAX_ELEVATION_POINTS) return null;
  const points: Coordinate[] = [];
  for (const entry of raw) {
    if (!Array.isArray(entry) || entry.length !== 2) return null;
    const [lon, lat] = entry as unknown[];
    if (typeof lon !== "number" || typeof lat !== "number") return null;
    if (!Number.isFinite(lon) || !Number.isFinite(lat) || Math.abs(lon) > 180 || Math.abs(lat) > 85) return null;
    points.push({ lon, lat });
  }
  return points;
}

/** A gentle, deterministic ridge-and-valley line keyed on position (tests only). */
function fixtureElevations(points: readonly Coordinate[]): ElevationResult {
  return {
    availability: "available",
    elevationsMeters: points.map((point, index) =>
      Math.round((180 + 90 * Math.sin(index / 14) + 40 * Math.sin(point.lon * 40)) * 10) / 10,
    ),
  };
}

export async function handleElevationRequest(
  request: Request,
  deps: ElevationHandlerDeps = defaultElevationDeps(),
): Promise<Response> {
  const retryAfter = deps.limiter.check(request);
  if (retryAfter !== null) {
    return Response.json(
      { availability: "unavailable", reason: "Too many elevation requests; try again shortly." },
      { status: 429, headers: { "retry-after": String(retryAfter) } },
    );
  }
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: { code: "validation", message: "Malformed body." } }, { status: 400 });
  }
  const points = parsePoints(body);
  if (points === null) {
    return Response.json(
      { error: { code: "validation", message: `points must be 2–${MAX_ELEVATION_POINTS} [lon, lat] pairs.` } },
      { status: 400 },
    );
  }
  const result = deps.fixture ? fixtureElevations(points) : await deps.source.elevations(points, request.signal);
  return Response.json(result, { headers: { "cache-control": "private, max-age=300" } });
}
