// One-off: time the owner's Hatboro loop (2026-11-13 "STUCK") against a running server's /api/route-plan.
import { buildProviderRequest } from "@/application/planner/build-plan-request";
import { defaultRideIntent } from "@/domain/ride/create";
import type { PointId, RideIntent } from "@/domain/ride/types";

const base = process.env.BASE ?? "http://127.0.0.1:3331";
const intent: RideIntent = {
  ...defaultRideIntent(),
  shape: "loop",
  start: { id: "pt_hatboro" as PointId, kind: "start", coordinate: { lat: 40.1790, lon: -75.1077 }, provenance: { type: "map", selectedAt: "2026-11-13T15:58:00.000Z" } },
} as RideIntent;
for (const includeAlternatives of [false, true]) {
  const built = await buildProviderRequest(intent, { resolveGeometry: () => null, includeAlternatives });
  if (!built.ok) { console.log("not buildable", built.issues); process.exit(1); }
  const t0 = Date.now();
  const response = await fetch(`${base}/api/route-plan`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ identity: { rideId: "ride_hatboro", rideRevision: 1, planningGeneration: 1 }, request: built.request, options: { includeAlternatives } }),
    signal: AbortSignal.timeout(120_000),
  }).catch((e) => e as Error);
  const seconds = ((Date.now() - t0) / 1000).toFixed(1);
  if (response instanceof Error) { console.log(JSON.stringify({ includeAlternatives, seconds, error: response.message })); continue; }
  const body = await response.json();
  const cands = body.bundle?.candidates ?? [];
  console.log(JSON.stringify({ includeAlternatives, seconds, status: response.status, error: body.error?.message ?? null, routes: cands.map((c: { distanceMeters: number; durationSeconds: number }) => `${(c.distanceMeters / 1609.344).toFixed(1)} mi / ${Math.round(c.durationSeconds / 60)} min`) }));
}
