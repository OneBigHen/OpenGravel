/**
 * In-memory sliding-window rate limiter for public API routes (ported from
 * SwitchBack `src/lib/server/rate-limiter.ts`).
 *
 * Keyed by the client address the reverse proxy sets (`x-real-ip`, then the
 * first `x-forwarded-for` hop); `cf-connecting-ip` only when
 * `TRUST_CF_CONNECTING_IP=1`, because it is spoofable on an origin that is not
 * firewalled to Cloudflare. Single-process only, which is what `ogv.service` is.
 */

import { isIP } from "node:net";

export interface RateLimiter {
  /** `null` when the request may proceed; otherwise seconds until it may. */
  check(request: Request): number | null;
}

export interface RateLimitOptions {
  readonly windowMs: number;
  readonly max: number;
  readonly now?: () => number;
  readonly env?: Readonly<Record<string, string | undefined>>;
}

const MAX_TRACKED_KEYS = 10_000;
const IP_LIKE = /^[\d.a-fA-F:[\]%]+$/;

/**
 * The browser gate drives one origin from one address and plans many rides per
 * spec, so its own per-client budgets would answer 429 before the workflow it
 * is testing had run. `playwright.config.ts` sets this flag on the server it
 * starts; unset, the configured budgets are exactly what production enforces.
 * It lifts the per-client windows only — the concurrency gates and daily caps
 * still apply, because they bound work, not a single caller.
 */
export const RATE_LIMIT_UNLIMITED_ENV = "OGV_RATE_LIMIT_UNLIMITED";

export function clientKey(request: Request, env: Readonly<Record<string, string | undefined>> = process.env): string {
  if (env.TRUST_CF_CONNECTING_IP === "1") {
    const cf = request.headers.get("cf-connecting-ip")?.trim();
    if (cf && IP_LIKE.test(cf)) return cf;
  }
  const realIp = request.headers.get("x-real-ip")?.trim();
  if (realIp && IP_LIKE.test(realIp)) return realIp;
  const forwarded = request.headers.get("x-forwarded-for")?.split(",", 1)[0]?.trim();
  if (forwarded && IP_LIKE.test(forwarded)) return forwarded;
  return "anonymous";
}

/** A public address we may act on; private, loopback and unknown keys never are. */
export function actionableAddress(key: string): string | null {
  const bare = key.replace(/^\[|\]$/g, "");
  if (isIP(bare) === 0) return null;
  if (bare === "::1" || /^127\./.test(bare) || /^10\./.test(bare) || /^192\.168\./.test(bare) ||
    /^172\.(?:1[6-9]|2\d|3[01])\./.test(bare) || /^(?:fc|fd|fe80)/i.test(bare) || /^100\.(?:6[4-9]|[7-9]\d|1[01]\d|12[0-7])\./.test(bare)) {
    return null;
  }
  return bare;
}

export function createRateLimiter(options: RateLimitOptions): RateLimiter {
  const env = options.env ?? process.env;
  const now = options.now ?? Date.now;
  const max = env[RATE_LIMIT_UNLIMITED_ENV] === "1" ? Number.POSITIVE_INFINITY : options.max;
  const hitsByKey = new Map<string, number[]>();

  return {
    check(request) {
      const time = now();
      const cutoff = time - options.windowMs;
      if (hitsByKey.size > MAX_TRACKED_KEYS) {
        for (const [key, hits] of hitsByKey) {
          if (hits.every((hit) => hit <= cutoff)) hitsByKey.delete(key);
        }
      }
      const key = clientKey(request, env);
      const hits = (hitsByKey.get(key) ?? []).filter((hit) => hit > cutoff);
      if (hits.length >= max) {
        hitsByKey.set(key, hits);
        const oldest = hits[0] ?? time;
        return Math.max(1, Math.ceil((oldest + options.windowMs - time) / 1000));
      }
      hits.push(time);
      hitsByKey.set(key, hits);
      return null;
    },
  };
}

/**
 * A limiter that only meters requests the reverse proxy attributed an address
 * to. A budget keyed on a key the client can choose freely (or omit) is not a
 * budget, so a request with no forwarded address is left to the origin guard,
 * which also declines to act without one.
 */
export function createAddressRateLimiter(options: RateLimitOptions): RateLimiter {
  const limiter = createRateLimiter(options);
  return {
    check(request) {
      return actionableAddress(clientKey(request, options.env)) === null ? null : limiter.check(request);
    },
  };
}

/** Caps how many expensive requests run at once, so a burst queues at the client, not in the router. */
export interface ConcurrencyGate {
  /** A release function when a slot is free, otherwise `null`. Call release exactly once. */
  acquire(): (() => void) | null;
}

export function createConcurrencyGate(max: number): ConcurrencyGate {
  let active = 0;
  return {
    acquire() {
      if (active >= max) return null;
      active += 1;
      let released = false;
      return () => {
        if (released) return;
        released = true;
        active -= 1;
      };
    },
  };
}

/** A process-wide daily budget (UTC day), for free-tier upstreams that must never be exhausted by one crowd. */
export interface DailyCap {
  /** `null` when a unit was taken; otherwise seconds until the budget resets. */
  take(): number | null;
}

export function createDailyCap(max: number, now: () => number = Date.now): DailyCap {
  const DAY_MS = 86_400_000;
  let day = Math.floor(now() / DAY_MS);
  let used = 0;
  return {
    take() {
      const time = now();
      const today = Math.floor(time / DAY_MS);
      if (today !== day) {
        day = today;
        used = 0;
      }
      if (used >= max) return Math.max(1, Math.ceil(((day + 1) * DAY_MS - time) / 1000));
      used += 1;
      return null;
    },
  };
}
