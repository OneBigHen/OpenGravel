import type { ProviderCandidate, RouteCandidateProvider } from '../../src/application/planner/route-provider';
import type { Row } from './types';

/** Nearest-rank percentile (p in 0..1). Null for nothing, never a made-up zero. */
export function percentile(values: readonly number[], p: number): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.max(0, Math.ceil(p * sorted.length) - 1))]!;
}

export interface RouterLoadSummary {
  rides: number;
  callsP75: number | null;
  callsMax: number | null;
  /** The plan's cap: no plan should make more than this many router calls. */
  ridesOverCallCap: number;
  firstRouteSecondsP75: number | null;
  firstRouteSecondsMax: number | null;
}
export const ROUTER_CALL_CAP = 6;

export function routerLoad(rows: readonly Pick<Row, 'routerUse'>[]): RouterLoadSummary {
  const used = rows.flatMap(row => row.routerUse ? [row.routerUse] : []);
  const calls = used.map(u => u.calls);
  const first = used.flatMap(u => u.firstRouteSeconds === null ? [] : [u.firstRouteSeconds]);
  return {
    rides: used.length,
    callsP75: percentile(calls, 0.75), callsMax: calls.length ? Math.max(...calls) : null,
    ridesOverCallCap: calls.filter(c => c > ROUTER_CALL_CAP).length,
    firstRouteSecondsP75: percentile(first, 0.75), firstRouteSecondsMax: first.length ? Math.max(...first) : null,
  };
}

export function loadLine(load: RouterLoadSummary): string {
  const fmt = (n: number | null, digits = 1) => n === null ? 'unknown' : n.toFixed(digits);
  return `Router calls per plan: 75th percentile ${fmt(load.callsP75, 0)}, most ${fmt(load.callsMax, 0)}, ${load.ridesOverCallCap} of ${load.rides} over the cap of ${ROUTER_CALL_CAP}. `
    + `First-route seconds: 75th percentile ${fmt(load.firstRouteSecondsP75)}, slowest ${fmt(load.firstRouteSecondsMax)}.`;
}

/**
 * One request at a time to the router, every request counted. The count lives here,
 * outside src/, so the planner and provider are measured exactly as they ship.
 * A failed response body is handed to `onFailure` so it can be kept for inspection.
 */
export interface RouterMeter {
  readonly fetcher: typeof fetch;
  /** Requests started so far. */
  count(): number;
  /** Resolves once everything queued so far has finished. */
  idle(): Promise<void>;
}
export function createRouterMeter(base: typeof fetch = fetch, onFailure: (call: number, body: ArrayBuffer) => Promise<void> | void = () => undefined): RouterMeter {
  let tail: Promise<unknown> = Promise.resolve();
  let calls = 0;
  const fetcher: typeof fetch = (input, init) => {
    const next = tail.then(async () => {
      calls++;
      const call = calls;
      const response = await base(input, init);
      const body = await response.arrayBuffer();
      if (!response.ok) await onFailure(call, body);
      return new Response(body, { status: response.status, statusText: response.statusText, headers: response.headers });
    });
    tail = next.catch(() => undefined);
    return next;
  };
  return { fetcher, count: () => calls, idle: async () => { await tail; } };
}

/**
 * Wraps a provider to remember what it answered, how many answers are still pending,
 * and when the first answer that carried a route came back (the earliest a rider could see any route).
 */
export interface InstrumentedProvider {
  readonly provider: RouteCandidateProvider;
  readonly seen: ProviderCandidate[];
  pending(): number;
  /** Starts the clock; call just before planning. */
  start(): void;
  firstRouteSeconds(): number | null;
}
export function instrumentProvider(inner: RouteCandidateProvider, now: () => number = () => performance.now()): InstrumentedProvider {
  const seen: ProviderCandidate[] = [];
  let pending = 0;
  let startedAt = now();
  let firstAt: number | null = null;
  const provider: RouteCandidateProvider = {
    id: inner.id,
    capabilities: () => inner.capabilities(),
    async candidates(request, signal) {
      pending++;
      try {
        const result = await inner.candidates(request, signal);
        if (firstAt === null && result.candidates.length > 0) firstAt = now();
        seen.push(...result.candidates);
        return result;
      } finally { pending--; }
    },
  };
  return { provider, seen, pending: () => pending, start() { startedAt = now(); firstAt = null; }, firstRouteSeconds: () => firstAt === null ? null : (firstAt - startedAt) / 1000 };
}
