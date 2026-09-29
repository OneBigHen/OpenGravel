/**
 * `/api/health` (02-ARCHITECTURE-CONTRACT §11, 23-API-CONTRACTS §12, §15).
 *
 * A thin adapter over `checkHealth`: the report is secrets-free by construction
 * (build id, one bounded router probe, declared policy/graph versions), and it
 * is never cached — a stale health answer is worse than none.
 */

import { checkHealth } from "@/server/health/health-service";

export async function GET(): Promise<Response> {
  const report = await checkHealth();
  return Response.json(report, {
    status: 200,
    headers: { "cache-control": "no-store" },
  });
}
