import type { RouteCandidateProvider } from "@/application/planner/route-provider";

/**
 * Shared by every server plan, including first-route and full-route requests.
 * An A-to-B plan sends its whole wave (up to five single-route calls) at once,
 * so wave requests may use eight slots. Loop requests (those with a discovery
 * window) keep main's three: their search is timing-sensitive and must run as
 * it did before RM-4.
 */
export const MAX_ROUTING_SEARCHES = 8;
export const MAX_LOOP_SEARCHES = 3;
let active = 0;
const waiting: Array<{ readonly limit: number; readonly start: () => void }> = [];

function drain(): void {
  for (let at = 0; at < waiting.length && active < MAX_ROUTING_SEARCHES;) {
    const next = waiting[at]!;
    if (active < next.limit) { waiting.splice(at, 1); next.start(); } else at += 1;
  }
}

function acquire(signal: AbortSignal, limit: number): Promise<() => void> {
  return new Promise((resolve, reject) => {
    const start = (): void => {
      signal.removeEventListener("abort", cancel);
      active += 1;
      resolve(() => {
        active -= 1;
        drain();
      });
    };
    const entry = { limit, start };
    const cancel = (): void => {
      const index = waiting.indexOf(entry);
      if (index >= 0) waiting.splice(index, 1);
      reject(signal.reason);
    };
    if (signal.aborted) { reject(signal.reason); return; }
    if (active < limit) start();
    else {
      waiting.push(entry);
      signal.addEventListener("abort", cancel, { once: true });
    }
  });
}

/** Queue individual searches, rather than multiplying the HTTP concurrency cap. */
export function boundedRouteProvider(provider: RouteCandidateProvider): RouteCandidateProvider {
  return {
    id: provider.id,
    capabilities: () => provider.capabilities(),
    // Reading the graph's description is not a route search; it is not queued.
    ...(provider.graph === undefined ? {} : { graph: (signal: AbortSignal) => provider.graph!(signal) }),
    async candidates(request, signal) {
      const release = await acquire(signal, request.discovery === undefined ? MAX_ROUTING_SEARCHES : MAX_LOOP_SEARCHES);
      try {
        if (signal.aborted) throw signal.reason;
        return await provider.candidates(request, signal);
      } finally { release(); }
    },
  };
}
