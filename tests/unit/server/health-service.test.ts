/**
 * `/api/health` (23-API-CONTRACTS §12, §15).
 *
 * The report is deliberately small and secret-free: a build id, one router
 * reachability probe with a bounded timeout, and the policy/graph version
 * strings the deployment declares. A router that is down degrades the report;
 * it never leaks the router's address, its error text or its stack.
 */

import { describe, expect, it } from "vitest";

import {
  DEFAULT_HEALTH_TIMEOUT_MS,
  DEFAULT_GRAPHHOPPER_URL,
  checkHealth,
} from "@/server/health/health-service";

const FIXED = "2026-09-17T00:00:00.000Z";

interface Probe {
  urls: string[];
}

function okFetcher(probe: Probe): typeof fetch {
  return (async (input: RequestInfo | URL): Promise<Response> => {
    probe.urls.push(String(input));
    return new Response("OK", { status: 200 });
  }) as typeof fetch;
}

function failingFetcher(probe: Probe, error: unknown): typeof fetch {
  return (async (input: RequestInfo | URL): Promise<Response> => {
    probe.urls.push(String(input));
    throw error;
  }) as typeof fetch;
}

function statusFetcher(probe: Probe, status: number): typeof fetch {
  return (async (input: RequestInfo | URL): Promise<Response> => {
    probe.urls.push(String(input));
    return new Response("nope", { status });
  }) as typeof fetch;
}

const ENV = {
  GRAPHHOPPER_URL: "http://router.internal:8989",
  OGV_BUILD_ID: "build_42",
  OGV_GRAPH_VERSION: "gh-pa-nj-2026-09",
};

describe("checkHealth", () => {
  it("reports a reachable router and the declared versions", async () => {
    const probe: Probe = { urls: [] };

    const report = await checkHealth({
      fetcher: okFetcher(probe),
      env: ENV,
      now: () => FIXED,
    });

    expect(report.status).toBe("ok");
    expect(report.router).toEqual({ status: "available", reason: null });
    expect(report.buildId).toBe("build_42");
    expect(report.policyVersion).toBe("PA_NJ_ROUTE_POLICY_VNEXT_1");
    expect(report.graphVersion).toBe("gh-pa-nj-2026-09");
    expect(report.checkedAt).toBe(FIXED);
    expect(probe.urls).toEqual(["http://router.internal:8989/health"]);
  });

  it("degrades when the router cannot be reached", async () => {
    const probe: Probe = { urls: [] };

    const report = await checkHealth({
      fetcher: failingFetcher(probe, new Error("ECONNREFUSED 127.0.0.1:8989")),
      env: ENV,
      now: () => FIXED,
    });

    expect(report.status).toBe("degraded");
    expect(report.router).toEqual({
      status: "unavailable",
      reason: "router-unreachable",
    });
    // The router's own error text and address never travel in the report.
    expect(JSON.stringify(report)).not.toMatch(/ECONNREFUSED|127\.0\.0\.1|8989/);
  });

  it("degrades when the router answers with a failure status", async () => {
    const probe: Probe = { urls: [] };

    const report = await checkHealth({
      fetcher: statusFetcher(probe, 503),
      env: ENV,
    });

    expect(report.status).toBe("degraded");
    expect(report.router.reason).toBe("router-unhealthy");
  });

  it("falls back to the real code policy and documented runtime defaults with no environment", async () => {
    const probe: Probe = { urls: [] };

    const report = await checkHealth({ fetcher: okFetcher(probe), env: {} });

    expect(report.buildId).toBe("dev");
    expect(report.policyVersion).toBe("PA_NJ_ROUTE_POLICY_VNEXT_1");
    expect(report.graphVersion).toBe("unknown");
    expect(probe.urls).toEqual([`${DEFAULT_GRAPHHOPPER_URL}/health`]);
  });

  it("probes with a bounded timeout", async () => {
    expect(DEFAULT_HEALTH_TIMEOUT_MS).toBe(1500);
    let seen: AbortSignal | null | undefined;
    const fetcher = (async (
      _input: RequestInfo | URL,
      init?: RequestInit,
    ): Promise<Response> => {
      seen = init?.signal;
      return new Response("OK", { status: 200 });
    }) as typeof fetch;

    await checkHealth({ fetcher, env: {}, timeoutMs: 25 });

    expect(seen).toBeInstanceOf(AbortSignal);
  });
});
