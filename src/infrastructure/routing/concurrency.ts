import type { RouteCandidateProvider } from "@/application/planner/route-provider";

/** Shared by every server plan, including first-route and full-route requests. */
export const MAX_ROUTING_SEARCHES = 3;
let active = 0;
const waiting: Array<() => void> = [];

function acquire(signal: AbortSignal): Promise<() => void> {
  return new Promise((resolve, reject) => {
    const start = (): void => {
      signal.removeEventListener("abort", cancel);
      active += 1;
      resolve(() => {
        active -= 1;
        waiting.shift()?.();
      });
    };
    const cancel = (): void => {
      const index = waiting.indexOf(start);
      if (index >= 0) waiting.splice(index, 1);
      reject(signal.reason);
    };
    if (signal.aborted) { reject(signal.reason); return; }
    if (active < MAX_ROUTING_SEARCHES) start();
    else {
      waiting.push(start);
      signal.addEventListener("abort", cancel, { once: true });
    }
  });
}

/** Queue individual searches, rather than multiplying the HTTP concurrency cap. */
export function boundedRouteProvider(provider: RouteCandidateProvider): RouteCandidateProvider {
  return {
    id: provider.id,
    capabilities: () => provider.capabilities(),
    async candidates(request, signal) {
      const release = await acquire(signal);
      try {
        if (signal.aborted) throw signal.reason;
        return await provider.candidates(request, signal);
      } finally { release(); }
    },
  };
}
