/**
 * In-memory sliding-window rate limiter for public API routes (ported from
 * SwitchBack `src/lib/server/rate-limiter.ts`).
 *
 * Keyed by the client address the reverse proxy sets (`x-real-ip`, then the
 * first `x-forwarded-for` hop); `cf-connecting-ip` only when
 * `TRUST_CF_CONNECTING_IP=1`, because it is spoofable on an origin that is not
 * firewalled to Cloudflare. Single-process only, which is what `ogv.service` is.
 */

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

export function createRateLimiter(options: RateLimitOptions): RateLimiter {
  const now = options.now ?? Date.now;
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
      const key = clientKey(request, options.env);
      const hits = (hitsByKey.get(key) ?? []).filter((hit) => hit > cutoff);
      if (hits.length >= options.max) {
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
