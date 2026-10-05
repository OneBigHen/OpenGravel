/**
 * Shared abuse guard for the public API routes: a per-client sliding window plus
 * an optional global cap on simultaneous expensive requests. The routing,
 * road-matching, places and traffic routes sit in front of a single-box router
 * and free-tier upstreams, so an unthrottled client could starve everyone.
 */

import { createConcurrencyGate, createRateLimiter, type ConcurrencyGate, type RateLimiter } from "@/server/rate-limit";

export interface ApiGuard {
  readonly limiter: RateLimiter;
  readonly gate?: ConcurrencyGate;
}

export interface ApiGuardOptions {
  readonly perMinute: number;
  /** Simultaneous in-flight requests across all clients; omit for no cap. */
  readonly maxConcurrent?: number;
}

export function createApiGuard(options: ApiGuardOptions): ApiGuard {
  return {
    limiter: createRateLimiter({ windowMs: 60_000, max: options.perMinute }),
    ...(options.maxConcurrent === undefined ? {} : { gate: createConcurrencyGate(options.maxConcurrent) }),
  };
}

function busy(retryAfterSeconds: number, message: string): Response {
  return Response.json(
    { error: { code: "rate-limit", message } },
    { status: 429, headers: { "cache-control": "no-store", "retry-after": String(retryAfterSeconds) } },
  );
}

/** Runs `run` when the client is within budget; otherwise answers 429 with `Retry-After`. */
export async function guarded(
  guard: ApiGuard,
  request: Request,
  run: () => Promise<Response>,
): Promise<Response> {
  const retryAfter = guard.limiter.check(request);
  if (retryAfter !== null) return busy(retryAfter, "Too many requests. Wait a moment and try again.");
  const release = guard.gate?.acquire() ?? null;
  if (guard.gate !== undefined && release === null) {
    return busy(2, "The service is busy right now. Try again in a moment.");
  }
  try {
    return await run();
  } finally {
    release?.();
  }
}
