import type { InfoFeature, MapLayerId, TerrainGrid } from "@/application/map-layers";

/** One short-lived worker per refreshed view; cancellation releases its memory. */
export function deriveTerrain(grid: TerrainGrid, layers: readonly MapLayerId[], signal?: AbortSignal): Promise<readonly InfoFeature[]> {
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL("./terrain.worker.ts", import.meta.url), { type: "module" });
    const finish = (): void => { clearTimeout(timer); signal?.removeEventListener("abort", abort); worker.terminate(); };
    const abort = (): void => { finish(); reject(new Error("Terrain calculation cancelled")); };
    const timer = setTimeout(abort, 15_000);
    worker.onmessage = (event: MessageEvent<{ readonly features?: readonly InfoFeature[] }>): void => {
      finish();
      if (event.data.features === undefined) reject(new Error("Terrain calculation unavailable"));
      else resolve(event.data.features);
    };
    worker.onerror = abort;
    signal?.addEventListener("abort", abort, { once: true });
    if (signal?.aborted === true) { abort(); return; }
    worker.postMessage({ grid, layers });
  });
}
