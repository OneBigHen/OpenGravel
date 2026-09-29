/**
 * Public-origin guard (opened for public testing 2026-09-26).
 *
 * Three jobs, all keyed by the rider's real address (`clientKey`: the
 * Cloudflare tunnel's forwarded client IP):
 * - answer an address on the fail2ban blocklist with 403;
 * - answer a scanner probe (`/.env`, `/wp-login.php`, `*.php`, `/.git`) with 404;
 * - hold each address to a budget on the API routes that cost money or engine
 *   time (planning, advisor, geocoding, layers), answering 429 past it.
 *
 * Probes and floods are logged as one `ogv-security` line each. The fail2ban
 * jail `ogv` (deploy/fail2ban) reads those lines from the journal and writes
 * the blocklist this guard reads back, so a ban needs no Cloudflare token.
 */

import { statSync, readFileSync } from "node:fs";
import { isIP } from "node:net";

import { clientKey, createRateLimiter, type RateLimiter } from "@/server/rate-limit";

export const DEFAULT_BLOCKLIST_PATH = "/var/lib/opengravel/banned-ips.txt";
const BLOCKLIST_RECHECK_MS = 5_000;

/** Paths no OpenGravel page or API has; asking for one is a scanner. */
const PROBE = new RegExp(
  [
    String.raw`\.(?:php\d?|asp|aspx|jsp|cgi|env|ini|bak|sql|sh)(?![a-z0-9])`,
    String.raw`^/\.(?!well-known/)`,
    String.raw`/\.(?:git|svn|hg|env|aws|ssh|docker)(?:$|/)`,
    String.raw`^/(?:wp-|wordpress|xmlrpc|phpmyadmin|pma|cgi-bin|vendor/phpunit|boaform|actuator|HNAP1|owa|solr|druid|console|manager/html|server-status|autodiscover)`,
  ].join("|"),
  "i",
);

/** API routes that spend engine time or paid quota per call. */
const METERED = /^\/api\/(?:route-plan|advisor|geocode|road-match|map-layers|places|weather|route-traffic|contributions|elevation)(?:\/|$)/;

export type GuardVerdict =
  | { readonly action: "pass" }
  | { readonly action: "block"; readonly status: 403 | 404 | 429; readonly log: string | null; readonly retryAfterSeconds?: number };

export function isProbePath(pathname: string): boolean {
  return PROBE.test(pathname);
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

/** Keeps log lines single-line and free of anything a fail2ban regex could trip on. */
function loggable(pathname: string): string {
  return pathname.replace(/[^\w./%-]/g, "_").slice(0, 120);
}

export interface GuardOptions {
  readonly env?: Readonly<Record<string, string | undefined>>;
  readonly now?: () => number;
  /** Reads the blocklist; injected by tests. */
  readonly readBlocklist?: () => ReadonlySet<string>;
  /** Metered API calls allowed per address per minute. */
  readonly meteredPerMinute?: number;
}

export interface Guard {
  inspect(request: Request, pathname: string): GuardVerdict;
}

export function fileBlocklist(path: string, now: () => number = Date.now): () => ReadonlySet<string> {
  let checkedAt = Number.NEGATIVE_INFINITY;
  let modified = -1;
  let addresses: ReadonlySet<string> = new Set();
  return () => {
    const time = now();
    if (time - checkedAt < BLOCKLIST_RECHECK_MS) return addresses;
    checkedAt = time;
    try {
      const stat = statSync(path);
      if (stat.mtimeMs !== modified) {
        modified = stat.mtimeMs;
        addresses = new Set(readFileSync(path, "utf8").split("\n").map((line) => line.trim()).filter((line) => line !== ""));
      }
    } catch {
      modified = -1;
      addresses = new Set();
    }
    return addresses;
  };
}

export function createGuard(options: GuardOptions = {}): Guard {
  const env = options.env ?? process.env;
  const now = options.now ?? Date.now;
  const readBlocklist = options.readBlocklist ?? fileBlocklist(env["OGV_BLOCKLIST_PATH"] ?? DEFAULT_BLOCKLIST_PATH, now);
  const metered: RateLimiter = createRateLimiter({ windowMs: 60_000, max: options.meteredPerMinute ?? 120, now, env });
  /** One flood line per address per minute is enough for fail2ban to count. */
  const floodLoggedAt = new Map<string, number>();

  return {
    inspect(request, pathname) {
      const address = actionableAddress(clientKey(request, env));
      if (address === null) return { action: "pass" };
      if (readBlocklist().has(address)) return { action: "block", status: 403, log: null };
      if (isProbePath(pathname)) {
        return { action: "block", status: 404, log: `ogv-security probe ip=${address} path=${loggable(pathname)}` };
      }
      if (METERED.test(pathname)) {
        const retryAfterSeconds = metered.check(request);
        if (retryAfterSeconds !== null) {
          const time = now();
          const last = floodLoggedAt.get(address) ?? Number.NEGATIVE_INFINITY;
          const log = time - last >= 60_000 ? `ogv-security flood ip=${address} path=${loggable(pathname)}` : null;
          if (log !== null) {
            if (floodLoggedAt.size > 10_000) floodLoggedAt.clear();
            floodLoggedAt.set(address, time);
          }
          return { action: "block", status: 429, log, retryAfterSeconds };
        }
      }
      return { action: "pass" };
    },
  };
}
