import { createHash } from 'node:crypto';

/** The value recorded when GraphHopper's `/info` does not say. Never guessed. */
export const UNKNOWN = 'unknown';

export interface RouterProvenance {
  /** GraphHopper's `import_date` for the graph that answered. */
  graphBuildDate: string;
  /** Deterministic hash of the profiles `/info` advertises, so a profile change is visible. */
  profileHash: string;
}

/** Stable JSON: object keys sorted at every depth, so two equal profile maps hash the same. */
export function canonicalJson(value: unknown): string {
  if (value === undefined) return 'null';
  if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'null';
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  const object = value as Record<string, unknown>;
  return `{${Object.keys(object).sort().map(key => `${JSON.stringify(key)}:${canonicalJson(object[key])}`).join(',')}}`;
}

function buildDate(value: unknown): string {
  if (typeof value === 'string' && value.trim() !== '') return value.trim();
  if (typeof value === 'number' && Number.isFinite(value)) {
    // GraphHopper writes epoch seconds; accept milliseconds too if a deployment sends them.
    return new Date(value > 1e12 ? value : value * 1000).toISOString();
  }
  return UNKNOWN;
}

/** Reads the graph build date and profile hash out of a GraphHopper `/info` body. */
export function parseRouterInfo(body: unknown): RouterProvenance {
  if (body === null || typeof body !== 'object') return { graphBuildDate: UNKNOWN, profileHash: UNKNOWN };
  const info = body as Record<string, unknown>;
  const profiles = info.profiles;
  return {
    graphBuildDate: buildDate(info.import_date ?? info.date),
    profileHash: profiles !== null && typeof profiles === 'object'
      ? `sha256:${createHash('sha256').update(canonicalJson(profiles)).digest('hex')}`
      : UNKNOWN,
  };
}

/** Asks the router once. Any failure is "unknown": provenance must never break a scorecard run. */
export async function readRouterProvenance(
  baseUrl: string,
  options: { fetcher?: typeof fetch; timeoutMs?: number } = {},
): Promise<RouterProvenance> {
  const fetcher = options.fetcher ?? fetch;
  try {
    const response = await fetcher(`${baseUrl.replace(/\/+$/, '')}/info`, { signal: AbortSignal.timeout(options.timeoutMs ?? 5_000) });
    if (!response.ok) return { graphBuildDate: UNKNOWN, profileHash: UNKNOWN };
    return parseRouterInfo(await response.json());
  } catch {
    return { graphBuildDate: UNKNOWN, profileHash: UNKNOWN };
  }
}
