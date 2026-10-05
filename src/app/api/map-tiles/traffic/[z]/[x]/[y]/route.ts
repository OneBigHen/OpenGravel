import { createDailyCap, createRateLimiter } from "@/server/rate-limit";
import { trafficTileUpstream } from "@/server/map-layers/handler";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// A map view asks for a dozen tiles, so the per-client budget is generous; the daily
// cap protects TomTom's free quota for everyone. Override with TOMTOM_TILE_DAILY_CAP.
const limiter = createRateLimiter({ windowMs: 60_000, max: 600 });
const dailyCap = createDailyCap(Number(process.env.TOMTOM_TILE_DAILY_CAP) || 30_000);

/** An empty 1×1 PNG: a missing tile draws nothing instead of a broken image. */
const EMPTY_PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=",
  "base64",
);

function empty(): Response {
  return new Response(EMPTY_PNG, { headers: { "content-type": "image/png", "cache-control": "public, max-age=60" } });
}

/**
 * TomTom's live traffic-flow raster, proxied so the key never reaches the
 * browser. Tiles are cached briefly: flow changes by the minute.
 */
export async function GET(
  request: Request,
  context: { params: Promise<{ z: string; x: string; y: string }> },
): Promise<Response> {
  const { z, x, y } = await context.params;
  const upstream = trafficTileUpstream(Number(z), Number(x), Number(y.replace(/\.png$/, "")));
  if (upstream === null) return empty();
  // Over budget draws no traffic layer rather than failing the map.
  if (limiter.check(request) !== null || dailyCap.take() !== null) return empty();
  try {
    const response = await fetch(upstream, { signal: AbortSignal.timeout(8_000) });
    if (!response.ok) return empty();
    return new Response(await response.arrayBuffer(), {
      headers: { "content-type": "image/png", "cache-control": "public, max-age=90" },
    });
  } catch {
    return empty();
  }
}
