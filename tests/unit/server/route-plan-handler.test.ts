/**
 * The `/api/route-plan` handler (23-API-CONTRACTS §2–§3, §15).
 *
 * The handler is the HTTP half of the endpoint: validate the body, call the
 * service, map failures onto status codes, and always answer with
 * `private, no-store` — a personal route is never cacheable.
 */

import { describe, expect, it } from "vitest";

import type {
  RoutePlanSuccessBody,
} from "@/application/planner/ports/route-plan-contract";
import { asRouteCandidateId } from "@/domain/route/ids";
import type { PlanRideInput, PlanServiceResult } from "@/server/planning/plan-service";
import {
  ROUTE_PLAN_RESPONSE_HEADERS,
  handleRoutePlanRequest,
  httpStatusForPlanErrorCode,
  type RoutePlanHandlerDeps,
} from "@/server/planning/route-handler";

function required<T>(value: T | undefined): T {
  if (value === undefined) throw new Error("the test expected a defined value");
  return value;
}

function validBody(): Record<string, unknown> {
  return {
    identity: { rideId: "ride_test", rideRevision: 2, planningGeneration: 3 },
    request: {
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
        noveltyPreference: "prefer-new-to-me",
        vehicle: "motorcycle",
      },
    },
  };
}

function successResult(): PlanServiceResult {
  const selectedRouteId = asRouteCandidateId("route_one");
  const body: RoutePlanSuccessBody = {
    identity: { rideId: "ride_test", rideRevision: 2, planningGeneration: 3 },
    bundle: {
      policyVersion: "VNEXT_STUB_0",
      graphVersion: "unknown",
      evidenceVersion: "unknown",
      candidates: [],
      roles: {
        "best-ride": selectedRouteId,
        fastest: null,
        "fast-and-fun": null,
        "more-twisties": null,
        "more-dirt": null,
        "lower-workload": null,
      },
      selectedRouteId,
      selectionSource: "automatic",
    },
    diagnostics: { optionalProvidersUnavailable: [] },
  };
  return { ok: true, ...body };
}

function errorResult(code: string, recoverable = false): PlanServiceResult {
  return {
    ok: false,
    error: { code, message: "OpenGravel copy.", recoverable },
  };
}

interface RecordingDeps extends RoutePlanHandlerDeps {
  calls: number;
  lastInput: PlanRideInput | null;
}

function deps(result: PlanServiceResult): RecordingDeps {
  const recording: RecordingDeps = {
    calls: 0,
    lastInput: null,
    plan: async (input: PlanRideInput): Promise<PlanServiceResult> => {
      recording.calls += 1;
      recording.lastInput = input;
      return result;
    },
  };
  return recording;
}

describe("handleRoutePlanRequest — validation before provider work", () => {
  it("rejects an invalid body with 400 and the issue list", async () => {
    const plan = deps(successResult());

    const result = await handleRoutePlanRequest({ nonsense: true }, plan);

    expect(result.status).toBe(400);
    expect(plan.calls).toBe(0);
    if (!("error" in result.body)) throw new Error("expected an error body");
    expect(result.body.error.recoverable).toBe(false);
    expect(result.body.error.details?.["issues"]).toBeDefined();
  });

  it("rejects an invalid novelty preference before planning", async () => {
    const plan = deps(successResult());
    const body = validBody();
    const request = body["request"] as Record<string, unknown>;
    const options = request["options"] as Record<string, unknown>;
    options["noveltyPreference"] = "collect-every-road";

    const result = await handleRoutePlanRequest(body, plan);

    expect(result.status).toBe(400);
    expect(plan.calls).toBe(0);
  });

  it("rejects a non-object body", async () => {
    const plan = deps(successResult());

    const result = await handleRoutePlanRequest("not json", plan);

    expect(result.status).toBe(400);
    expect(plan.calls).toBe(0);
  });

  it("always answers with private, no-store", async () => {
    const plan = deps(successResult());

    const result = await handleRoutePlanRequest(validBody(), plan);

    expect(result.headers).toEqual(ROUTE_PLAN_RESPONSE_HEADERS);
    expect(required(result.headers["cache-control"])).toBe("private, no-store");
  });
});

describe("handleRoutePlanRequest — success path", () => {
  it("calls the service with the parsed body and answers 200", async () => {
    const plan = deps(successResult());

    const result = await handleRoutePlanRequest(validBody(), plan);

    expect(result.status).toBe(200);
    expect(plan.calls).toBe(1);
    expect(plan.lastInput?.identity).toEqual({
      rideId: "ride_test",
      rideRevision: 2,
      planningGeneration: 3,
    });
    expect(plan.lastInput?.request.profile).toBe("motorcycle_fastest");
    expect(plan.lastInput?.request.options.noveltyPreference).toBe("prefer-new-to-me");
    if (!("identity" in result.body)) throw new Error("expected a success body");
    expect(result.body.identity.rideId).toBe("ride_test");
  });
});

describe("httpStatusForPlanErrorCode", () => {
  const cases: readonly (readonly [string, number])[] = [
    ["validation", 400],
    ["missing-input", 400],
    ["no-route", 422],
    ["outside-coverage", 422],
    ["constraint-conflict", 409],
    ["provider-timeout", 504],
    ["provider-unavailable", 502],
    ["network", 502],
    ["cancelled", 499],
    ["something-new", 500],
  ];

  it.each(cases)("maps %s to %i", (code, status) => {
    expect(httpStatusForPlanErrorCode(code)).toBe(status);
  });

  it("uses the mapped status for a service failure", async () => {
    const result = await handleRoutePlanRequest(
      validBody(),
      deps(errorResult("no-route")),
    );

    expect(result.status).toBe(422);
    if (!("error" in result.body)) throw new Error("expected an error body");
    expect(result.body.error.code).toBe("no-route");
    expect(result.body.error.message).toBe("OpenGravel copy.");
  });

  it("does not add provider internals to the error body", async () => {
    const result = await handleRoutePlanRequest(
      validBody(),
      deps(errorResult("provider-unavailable", true)),
    );

    expect(JSON.stringify(result.body)).not.toMatch(/stack|ECONNREFUSED|8989/);
  });
});
