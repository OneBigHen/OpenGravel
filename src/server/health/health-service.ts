/**
 * Health report for `/api/health` (23-API-CONTRACTS §12, §15).
 *
 * "Healthy" has two parts and they are reported separately: the app is up (it
 * answered at all) and the routing engine is reachable. A router outage
 * degrades the report rather than failing the endpoint, because the app can
 * still serve a shell and a rider needs to know *which* part is missing.
 *
 * The probe is bounded (default 1.5 s) and its failure reasons are machine
 * tokens (`router-unreachable`, `router-unhealthy`): no router address, error
 * text or stack ever enters the report.
 */

/** GraphHopper's liveness path, pinned by the live-router suite as well. */
export const HEALTH_PATH = "/health";

/** Bounded probe budget: an unreachable router must not hang the endpoint. */
export const DEFAULT_HEALTH_TIMEOUT_MS = 1_500;

/** The deployment's router, overridable for any non-default host. */
export const DEFAULT_GRAPHHOPPER_URL = "http://127.0.0.1:8989";

/** The environment keys this report reads; nothing else is consulted. */
export interface HealthEnv {
  readonly GRAPHHOPPER_URL?: string | undefined;
  readonly OGV_BUILD_ID?: string | undefined;
  readonly OGV_POLICY_VERSION?: string | undefined;
  readonly OGV_GRAPH_VERSION?: string | undefined;
}

export interface HealthDeps {
  readonly fetcher?: typeof fetch;
  readonly env?: HealthEnv;
  readonly now?: () => string;
  readonly timeoutMs?: number;
}

export interface RouterHealth {
  readonly status: "available" | "unavailable";
  /** Machine token, or `null` when the router answered. */
  readonly reason: "router-unreachable" | "router-unhealthy" | null;
}

export interface HealthReport {
  readonly buildId: string;
  readonly status: "ok" | "degraded";
  readonly router: RouterHealth;
  readonly graphVersion: string;
  readonly policyVersion: string;
  readonly checkedAt: string;
}

/** Defaults are explicit so a report always states a version, never a blank. */
export const DEFAULT_BUILD_ID = "dev";
export const DEFAULT_POLICY_VERSION = "VNEXT_STUB_0";
export const DEFAULT_GRAPH_VERSION = "unknown";

function envOf(deps: HealthDeps): HealthEnv {
  if (deps.env !== undefined) return deps.env;
  const env = process.env;
  return {
    GRAPHHOPPER_URL: env["GRAPHHOPPER_URL"],
    OGV_BUILD_ID: env["OGV_BUILD_ID"],
    OGV_POLICY_VERSION: env["OGV_POLICY_VERSION"],
    OGV_GRAPH_VERSION: env["OGV_GRAPH_VERSION"],
  };
}

/**
 * One bounded reachability probe. Any thrown error (DNS, refused connection,
 * timeout) is `router-unreachable`; a non-2xx answer is `router-unhealthy`.
 * The distinction is what a deploy check needs to tell "absent" from "broken".
 */
async function probeRouter(
  baseUrl: string,
  fetcher: typeof fetch,
  timeoutMs: number,
): Promise<RouterHealth> {
  try {
    const response = await fetcher(`${baseUrl.replace(/\/+$/, "")}${HEALTH_PATH}`, {
      method: "GET",
      signal: AbortSignal.timeout(timeoutMs),
    });
    return response.ok
      ? { status: "available", reason: null }
      : { status: "unavailable", reason: "router-unhealthy" };
  } catch {
    return { status: "unavailable", reason: "router-unreachable" };
  }
}

/**
 * Builds the report. Never throws: a probe failure is data, not an error.
 */
export async function checkHealth(deps: HealthDeps = {}): Promise<HealthReport> {
  const env = envOf(deps);
  const fetcher = deps.fetcher ?? fetch;
  const router = await probeRouter(
    env.GRAPHHOPPER_URL ?? DEFAULT_GRAPHHOPPER_URL,
    fetcher,
    deps.timeoutMs ?? DEFAULT_HEALTH_TIMEOUT_MS,
  );
  return {
    buildId: env.OGV_BUILD_ID ?? DEFAULT_BUILD_ID,
    status: router.status === "available" ? "ok" : "degraded",
    router,
    graphVersion: env.OGV_GRAPH_VERSION ?? DEFAULT_GRAPH_VERSION,
    policyVersion: env.OGV_POLICY_VERSION ?? DEFAULT_POLICY_VERSION,
    checkedAt: (deps.now ?? ((): string => new Date().toISOString()))(),
  };
}
