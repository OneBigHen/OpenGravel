/**
 * The same-origin planning bridge (23-API-CONTRACTS §2–§3, Rule B).
 *
 * The bridge is the only place a browser-side planner talks HTTP. These tests
 * pin the two halves of that job: what it sends (the contract's payload, with
 * the attempt identity scoped by the composition root) and what it accepts (the
 * port's `ProviderCandidate`, or a typed failure in the §12 taxonomy).
 */

import { describe, expect, it, vi } from "vitest";

import type {
  RoutePlanRequestBody,
  RoutePlanSuccessBody,
} from "@/application/planner/ports/route-plan-contract";
import { ROUTE_PLAN_PATH } from "@/application/planner/ports/route-plan-contract";
import type { ProviderRouteRequest } from "@/application/planner/route-provider";
import { asRouteCandidateId } from "@/domain/route/ids";
import type { RouteScoreComponents } from "@/domain/route/types";
import {
  ApiRouteProviderError,
  API_PROVIDER_ID,
  createApiRouteProvider,
} from "@/infrastructure/routing/api-provider";

const IDENTITY = {
  rideId: "ride_test",
  rideRevision: 12,
  planningGeneration: 8,
} as const;

const REQUEST: ProviderRouteRequest = {
  requestId: "req_test",
  origin: { lon: -75.16, lat: 39.95 },
  destination: { lon: -74.8, lat: 40.2 },
  stops: [],
  shaping: [],
  profile: "motorcycle_fastest",
  avoidPolygons: [],
  options: {
    includeAlternatives: true,
    avoidHighways: false,
    tollPolicy: "avoid",
    vehicle: "motorcycle",
  },
};

function required<T>(value: T | undefined): T {
  if (value === undefined) throw new Error("the test expected a defined value");
  return value;
}

function unscoredScore(): RoutePlanSuccessBody["bundle"]["candidates"][number]["score"] {
  const component = (key: string): RouteScoreComponents["curvature"] => ({
    input: null,
    weight: 0,
    contribution: 0,
    explanationKey: `unscored.${key}`,
    evidenceStatus: "unknown",
  });
  return {
    policyVersion: "VNEXT_STUB_0",
    total: 0,
    components: {
      curvature: component("curvature"),
      backroad: component("backroad"),
      surfaceFit: component("surfaceFit"),
      elevation: component("elevation"),
      traffic: component("traffic"),
      junctionFriction: component("junctionFriction"),
      novelty: component("novelty"),
      closureRisk: component("closureRisk"),
      timeCost: component("timeCost"),
      confidence: component("confidence"),
    },
  };
}

function successBody(): RoutePlanSuccessBody {
  const id = asRouteCandidateId("route_one");
  return {
    identity: { ...IDENTITY },
    bundle: {
      policyVersion: "VNEXT_STUB_0",
      graphVersion: "unknown",
      evidenceVersion: "unknown",
      candidates: [
        {
          id,
          provider: { providerId: "graphhopper", profile: "motorcycle_fastest" },
          geometry: [
            { lon: -75.16, lat: 39.95 },
            { lon: -74.8, lat: 40.2 },
          ],
          distanceMeters: 120_000,
          durationSeconds: 6_000,
          instructions: [{
            text: "Turn left onto Ridge Pike",
            distanceMeters: 420,
            durationSeconds: 62,
            type: "turn",
            maneuver: "left",
            roadName: "Ridge Pike",
            geometryIndex: 1,
          }],
          eligibility: { eligible: true, failures: [] },
          evidence: {},
          score: unscoredScore(),
          warnings: [],
          fingerprint: "fp_one",
        },
      ],
      roles: {
        "best-ride": id,
        fastest: id,
        "fast-and-fun": null,
        "more-twisties": null,
        "more-dirt": null,
        "lower-workload": null,
      },
      selectedRouteId: id,
      selectionSource: "automatic",
    },
    diagnostics: { optionalProvidersUnavailable: [] },
  };
}

interface FakeResponse {
  readonly ok: boolean;
  readonly status: number;
  json(): Promise<unknown>;
}

function response(ok: boolean, status: number, body: unknown): Response {
  const fake: FakeResponse = { ok, status, json: async (): Promise<unknown> => body };
  return fake as unknown as Response;
}

interface Recorded {
  readonly calls: readonly { url: string; init: RequestInit | undefined }[];
}

function recordingFetcher(result: Response | Error): {
  readonly probe: Recorded & { calls: { url: string; init: RequestInit | undefined }[] };
  readonly fetcher: typeof fetch;
} {
  const calls: { url: string; init: RequestInit | undefined }[] = [];
  const fetcher = (async (
    input: RequestInfo | URL,
    init?: RequestInit,
  ): Promise<Response> => {
    calls.push({ url: String(input), init });
    if (result instanceof Error) throw result;
    return result;
  }) as typeof fetch;
  return { probe: { calls }, fetcher };
}

describe("createApiRouteProvider — the request it sends", () => {
  it("POSTs the contract payload with the attempt identity and the caller's signal", async () => {
    const { fetcher, probe } = recordingFetcher(response(true, 200, successBody()));
    const provider = createApiRouteProvider({ fetcher });
    provider.beginAttempt(IDENTITY);
    const controller = new AbortController();

    await provider.candidates(REQUEST, controller.signal);

    const call = required(probe.calls[0]);
    expect(call.url).toBe(ROUTE_PLAN_PATH);
    expect(call.init?.method).toBe("POST");
    expect(call.init?.signal).toBe(controller.signal);
    const body = JSON.parse(String(call.init?.body)) as RoutePlanRequestBody;
    expect(body.identity).toEqual(IDENTITY);
    expect(body.request.origin).toEqual(REQUEST.origin);
    expect(body.request.options).toEqual(REQUEST.options);
  });

  it("forwards only the bounded loop timebox required by route generation", async () => {
    const { fetcher, probe } = recordingFetcher(response(true, 200, successBody()));
    const provider = createApiRouteProvider({ fetcher });
    provider.beginAttempt(IDENTITY);

    await provider.candidates({
      ...REQUEST,
      destination: REQUEST.origin,
      discovery: { targetMinutes: 90, toleranceMinutes: 15 },
    }, new AbortController().signal);

    const body = JSON.parse(String(required(probe.calls[0]).init?.body)) as RoutePlanRequestBody;
    expect(body.request.discovery).toEqual({ targetMinutes: 90, toleranceMinutes: 15 });
  });

  it("is scoped to the attempt the composition root installed last", async () => {
    const { fetcher, probe } = recordingFetcher(response(true, 200, successBody()));
    const provider = createApiRouteProvider({ fetcher });
    provider.beginAttempt(IDENTITY);
    provider.beginAttempt({ rideId: "ride_next", rideRevision: 13, planningGeneration: 9 });

    await provider.candidates(REQUEST, new AbortController().signal);

    const body = JSON.parse(String(required(probe.calls[0]).init?.body)) as RoutePlanRequestBody;
    expect(body.identity.rideId).toBe("ride_next");
    expect(body.identity.planningGeneration).toBe(9);
  });

  it("fails closed when no attempt has been scoped", async () => {
    const { fetcher, probe } = recordingFetcher(response(true, 200, successBody()));
    const provider = createApiRouteProvider({ fetcher });

    await expect(
      provider.candidates(REQUEST, new AbortController().signal),
    ).rejects.toMatchObject({ code: "missing-input" });
    expect(probe.calls).toHaveLength(0);
  });

  it("reports its own identity and never claims engine profiles", () => {
    const provider = createApiRouteProvider({ fetcher: recordingFetcher(response(true, 200, {})).fetcher });

    expect(provider.id).toBe(API_PROVIDER_ID);
    expect(provider.capabilities().profiles).toEqual([]);
    expect(provider.capabilities().supportsAlternatives).toBe(true);
  });
});

describe("createApiRouteProvider — the answer it returns", () => {
  it("converts wire candidates into port candidates with geometry and fingerprint", async () => {
    const { fetcher } = recordingFetcher(response(true, 200, successBody()));
    const provider = createApiRouteProvider({ fetcher });
    provider.beginAttempt(IDENTITY);

    const set = await provider.candidates(REQUEST, new AbortController().signal);

    expect(set.candidates).toHaveLength(1);
    const candidate = required(set.candidates[0]);
    // The port's source is the transport the controller holds; the engine that
    // computed the path travels as diagnostics (OGV-D-181).
    expect(candidate.providerId).toBe(API_PROVIDER_ID);
    expect(candidate.profile).toBe("motorcycle_fastest");
    expect(candidate.geometry).toEqual([
      { lon: -75.16, lat: 39.95 },
      { lon: -74.8, lat: 40.2 },
    ]);
    expect(candidate.distanceMeters).toBe(120_000);
    expect(candidate.durationSeconds).toBe(6_000);
    expect(candidate.instructions).toEqual([{
      text: "Turn left onto Ridge Pike",
      distanceMeters: 420,
      durationSeconds: 62,
      type: "turn",
      maneuver: "left",
      roadName: "Ridge Pike",
      geometryIndex: 1,
    }]);
    expect(candidate.providerMetadata?.["fingerprint"]).toBe("fp_one");
    expect(candidate.providerMetadata?.["upstreamProviderId"]).toBe("graphhopper");
  });

  it("carries planner candidate identity and lower-workload role through the adapter", async () => {
    const body = successBody();
    const { fetcher } = recordingFetcher(response(true, 200, {
      ...body,
      bundle: { ...body.bundle, roles: { ...body.bundle.roles, "lower-workload": body.bundle.selectedRouteId } },
    }));
    const provider = createApiRouteProvider({ fetcher });
    provider.beginAttempt(IDENTITY);
    const set = await provider.candidates(REQUEST, new AbortController().signal);
    expect(required(set.candidates[0]).providerMetadata).toMatchObject({
      candidateId: "route_one", lowerWorkload: true,
    });
  });
});

describe("createApiRouteProvider — failures", () => {
  it("maps an error body into a typed rejection", async () => {
    const errorBody = {
      error: {
        code: "no-route",
        message: "No route was found for this ride.",
        recoverable: false,
      },
    };
    const { fetcher } = recordingFetcher(response(false, 422, errorBody));
    const provider = createApiRouteProvider({ fetcher });
    provider.beginAttempt(IDENTITY);

    const rejection = await provider
      .candidates(REQUEST, new AbortController().signal)
      .catch((error: unknown) => error);

    expect(rejection).toBeInstanceOf(ApiRouteProviderError);
    const error = rejection as ApiRouteProviderError;
    expect(error.code).toBe("no-route");
    expect(error.message).toBe("No route was found for this ride.");
    expect(error.recoverable).toBe(false);
    expect(error.httpStatus).toBe(422);
  });

  it("never forwards a transport error's own text", async () => {
    const { fetcher } = recordingFetcher(new Error("Failed to fetch http://127.0.0.1:8989"));
    const provider = createApiRouteProvider({ fetcher });
    provider.beginAttempt(IDENTITY);

    const rejection = await provider
      .candidates(REQUEST, new AbortController().signal)
      .catch((error: unknown) => error);

    const error = rejection as ApiRouteProviderError;
    expect(error.code).toBe("provider-unavailable");
    expect(error.recoverable).toBe(true);
    expect(error.message).not.toContain("127.0.0.1");
  });

  it("rethrows the caller's own abort reason", async () => {
    const controller = new AbortController();
    controller.abort();
    const { fetcher } = recordingFetcher(new Error("aborted"));
    const provider = createApiRouteProvider({ fetcher });
    provider.beginAttempt(IDENTITY);

    const rejection = await provider
      .candidates(REQUEST, controller.signal)
      .catch((error: unknown) => error);

    expect(rejection).toBe(controller.signal.reason);
  });

  it("rejects an unreadable response without quoting it", async () => {
    const unreadable = {
      ok: true,
      status: 200,
      json: async (): Promise<unknown> => {
        throw new SyntaxError("Unexpected token < in JSON");
      },
    } as unknown as Response;
    const { fetcher } = recordingFetcher(unreadable);
    const provider = createApiRouteProvider({ fetcher });
    provider.beginAttempt(IDENTITY);

    const rejection = await provider
      .candidates(REQUEST, new AbortController().signal)
      .catch((error: unknown) => error);

    const error = rejection as ApiRouteProviderError;
    expect(error.code).toBe("provider-unavailable");
    expect(error.message).not.toContain("Unexpected token");
  });

  it("treats an error object on a 2xx as a failure, not as an answer", async () => {
    const { fetcher } = recordingFetcher(
      response(true, 200, {
        error: { code: "validation", message: "Rejected.", recoverable: false },
      }),
    );
    const provider = createApiRouteProvider({ fetcher });
    provider.beginAttempt(IDENTITY);

    await expect(
      provider.candidates(REQUEST, new AbortController().signal),
    ).rejects.toMatchObject({ code: "validation" });
  });

  it("does not touch the network for a request it has no identity for", async () => {
    const spy = vi.fn();
    const provider = createApiRouteProvider({ fetcher: spy as unknown as typeof fetch });

    await expect(
      provider.candidates(REQUEST, new AbortController().signal),
    ).rejects.toBeInstanceOf(ApiRouteProviderError);
    expect(spy).not.toHaveBeenCalled();
  });
});
