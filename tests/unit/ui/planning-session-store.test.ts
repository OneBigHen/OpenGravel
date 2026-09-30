/**
 * The planning-session container (02-ARCHITECTURE-CONTRACT §8–§9, §13, §17;
 * 06 §4–§5, §28–§29).
 *
 * The container exists so surfaces see one immutable snapshot and one selection
 * API. These tests drive it end to end through the real client composition root
 * (controller + api bridge + geometry store) against a fake `/api/route-plan`,
 * because that is the path a browser actually takes — and the place where the
 * ownership identity, the profile mapping and the geometry cache can silently
 * drift apart.
 */

import { describe, expect, it } from "vitest";

import { createClientPlanningService } from "@/application/planner/client-planning-service";
import type { RoutePlanIdentityWire } from "@/application/planner/ports/route-plan-contract";
import { defaultRideIntent } from "@/domain/ride/create";
import { asGeometryRef, newRideId, type PointId, type RideId } from "@/domain/ride/ids";
import { SCHEMA_VERSION, type Coordinate, type RideDocument, type RideIntent, type RidePoint } from "@/domain/ride/types";
import { asRouteCandidateId } from "@/domain/route/ids";
import { knownEvidence } from "@/domain/evidence/types";
import { PA_NJ_ROUTE_POLICY_VNEXT_1 } from "@/domain/route/policy";
import { scoreCandidate } from "@/domain/route/scoring";
import type { RouteScoreComponents } from "@/domain/route/types";
import type { GeometryPayload } from "@/domain/geometry/types";
import { createPlanningSessionStore } from "@/ui/stores/planning-session-store";

const FIXED = "2026-09-17T00:00:00.000Z";
const now = (): string => FIXED;
const RIDE_ID: RideId = newRideId();

const ORIGIN: Coordinate = { lon: -75.2, lat: 39.95 };
const DESTINATION: Coordinate = { lon: -74.8, lat: 40.2 };
const MIDPOINT: Coordinate = { lon: -75.0, lat: 40.05 };

function endpoint(id: string, kind: "start" | "finish", coordinate: Coordinate): RidePoint {
  return { id: id as PointId, kind, coordinate, provenance: { type: "map", selectedAt: FIXED } };
}

function plannedIntent(): RideIntent {
  return {
    ...defaultRideIntent(),
    start: endpoint("pt_start", "start", ORIGIN),
    finish: endpoint("pt_finish", "finish", DESTINATION),
  };
}

function unscoredScore(): { policyVersion: string; total: number; components: RouteScoreComponents } {
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

function wireCandidate(id: string, durationSeconds: number, fingerprint: string) {
  return {
    id: asRouteCandidateId(id),
    provider: { providerId: "graphhopper", profile: "motorcycle_adventure" },
    geometry: [ORIGIN, MIDPOINT, DESTINATION],
    distanceMeters: 120_000,
    durationSeconds,
    eligibility: { eligible: true, failures: [] },
    evidence: {},
    score: unscoredScore(),
    warnings: [],
    fingerprint,
  };
}

const BEST_ID = asRouteCandidateId("route_best");
const FAST_ID = asRouteCandidateId("route_fast");

function successBody(identity: RoutePlanIdentityWire) {
  return {
    identity,
    bundle: {
      policyVersion: "VNEXT_STUB_0",
      graphVersion: "unknown",
      evidenceVersion: "unknown",
      candidates: [
        wireCandidate(BEST_ID, 6_480, "fp_best"),
        wireCandidate(FAST_ID, 5_760, "fp_fast"),
      ],
      roles: {
        "best-ride": BEST_ID,
        fastest: FAST_ID,
        "fast-and-fun": null,
        "more-twisties": null,
        "more-dirt": null,
        "lower-workload": null,
      },
      selectedRouteId: BEST_ID,
    },
    diagnostics: { optionalProvidersUnavailable: [] },
  };
}

function personalizedSuccessBody(identity: RoutePlanIdentityWire) {
  const routeA = [ORIGIN, MIDPOINT, DESTINATION];
  const routeB = [ORIGIN, { lon: -75.10, lat: 40.12 }, DESTINATION];
  const source = { id: "server", label: "server", category: "derived" } as const;
  const score = (geometry: readonly Coordinate[], durationSeconds: number, novelty: number) =>
    scoreCandidate({
      candidate: { geometry, distanceMeters: 120_000, durationSeconds },
      intent: { roadCharacter: "balanced", noveltyPreference: "prefer-new-to-me" },
      policy: PA_NJ_ROUTE_POLICY_VNEXT_1,
      baselineDurationSeconds: 600,
      evidence: { novelty: knownEvidence(novelty, source) },
    });
  return {
    identity,
    bundle: {
      policyVersion: PA_NJ_ROUTE_POLICY_VNEXT_1.version,
      graphVersion: "gh-nj-2026-04",
      evidenceVersion: "road-intel-3",
      candidates: [
        {
          ...wireCandidate(asRouteCandidateId("server_a"), 600, "fp_a"),
          geometry: routeA,
          evidence: { novelty: knownEvidence(0.1, source) },
          score: score(routeA, 600, 0.1),
        },
        {
          ...wireCandidate(asRouteCandidateId("server_b"), 900, "fp_b"),
          geometry: routeB,
          evidence: { novelty: knownEvidence(0.2, source) },
          score: score(routeB, 900, 0.2),
        },
      ],
      roles: {
        "best-ride": asRouteCandidateId("server_a"),
        fastest: asRouteCandidateId("server_a"),
        "fast-and-fun": null,
        "more-twisties": null,
        "more-dirt": null,
        "lower-workload": null,
      },
      selectedRouteId: asRouteCandidateId("server_a"),
    },
    diagnostics: { optionalProvidersUnavailable: [] },
  };
}

interface FakeResponse {
  readonly ok: boolean;
  readonly status: number;
  json(): Promise<unknown>;
}

function jsonResponse(ok: boolean, status: number, body: unknown): Response {
  const fake: FakeResponse = { ok, status, json: async (): Promise<unknown> => body };
  return fake as unknown as Response;
}

interface Post {
  readonly url: string;
  readonly body: { identity: RoutePlanIdentityWire; request: { profile: string; origin: Coordinate; options: { surfacePreference?: string } } };
}

function successFetcher(): { readonly fetcher: typeof fetch; readonly posts: Post[]; readonly signals: AbortSignal[] } {
  const posts: Post[] = [];
  const signals: AbortSignal[] = [];
  const fetcher = (async (
    input: RequestInfo | URL,
    init?: RequestInit,
  ): Promise<Response> => {
    const body = JSON.parse(String(init?.body)) as Post["body"];
    posts.push({ url: String(input), body });
    if (init?.signal instanceof AbortSignal) signals.push(init.signal);
    return jsonResponse(true, 200, successBody(body.identity));
  }) as typeof fetch;
  return { fetcher, posts, signals };
}

function hangingFetcher(): { readonly fetcher: typeof fetch; readonly calls: () => number } {
  let calls = 0;
  const fetcher = (async (): Promise<Response> => {
    calls += 1;
    return new Promise<Response>(() => {
      // Deliberately ignores the abort signal: the worst case the controller's
      // fence must survive.
    });
  }) as typeof fetch;
  return { fetcher, calls: () => calls };
}

async function flush(): Promise<void> {
  await new Promise<void>((resolve) => {
    setTimeout(resolve, 0);
  });
}

/** A minimal document fixture: only the identity and intent matter here. */
function documentFor(intent: RideIntent): RideDocument {
  return {
    schemaVersion: SCHEMA_VERSION,
    rideId: RIDE_ID,
    revision: 5,
    createdAt: FIXED,
    updatedAt: FIXED,
    title: null,
    provenance: { type: "new" },
    intent,
    history: { entries: [], cursor: -1, baseIntent: intent, appliedProposalIds: [] },
  };
}

describe("createPlanningSessionStore — one attempt through the real client path", () => {
  it("plans through the api bridge and caches candidate geometry", async () => {
    const { fetcher, posts } = successFetcher();
    const service = createClientPlanningService({ fetcher, now });
    const store = createPlanningSessionStore({ service });

    await store.getState().begin({
      rideId: RIDE_ID,
      rideRevision: 5,
      intent: plannedIntent(),
    });

    expect(posts).toHaveLength(1);
    expect(posts[0]?.url).toBe("/api/route-plan");
    expect(posts[0]?.body.identity).toEqual({
      rideId: RIDE_ID,
      rideRevision: 5,
      planningGeneration: 1,
    });
    // The deployment's rider-intent → engine-profile mapping is injected by the
    // composition root: a default (balanced, `mixed` surface) ride resolves to
    // the fastest model, and the surface envelope travels as an option
    // (OGV-D-262).
    expect(posts[0]?.body.request.profile).toBe("motorcycle_fastest");
    expect(posts[0]?.body.request.options.surfacePreference).toBe("mixed");
    expect(posts[0]?.body.request.origin).toEqual(ORIGIN);

    const snapshot = store.getState().snapshot;
    expect(snapshot.phase).toBe("ready");
    const bundle = snapshot.committedBundle;
    expect(bundle?.candidates).toHaveLength(2);
    // The client's candidate identities are minted by its own pipeline: the wire
    // ids are server-side handles and deliberately do not travel (OGV-D-181).
    const selected = bundle?.candidates.find(
      (candidate) => candidate.id === snapshot.selectedRouteId,
    );
    expect(selected?.fingerprint).toBe("fp_best");
    expect(snapshot.selectionSource).toBe("automatic");
    expect(snapshot.selectedRouteId).not.toBe(BEST_ID);

    await flush();
    const geometry = store.getState().geometry;
    const refs = Object.keys(geometry);
    expect(refs).toHaveLength(2);
    const payload: GeometryPayload | undefined = geometry[refs[0] ?? ""];
    expect(payload?.kind).toBe("line");
    expect(payload?.kind === "line" ? payload.coordinates : []).toHaveLength(3);
  });

  it("uses local recorded history for novelty while retaining stored components and provider wire shape", async () => {
    const { posts } = successFetcher();
    let historyReads = 0;
    const service = createClientPlanningService({
      now,
      fetcher: (async (
        input: RequestInfo | URL,
        init?: RequestInit,
      ): Promise<Response> => {
        const body = JSON.parse(String(init?.body)) as Post["body"];
        posts.push({ url: String(input), body });
        return jsonResponse(true, 200, personalizedSuccessBody(body.identity));
      }) as typeof fetch,
      localHistoryReader: async () => {
        historyReads += 1;
        return [{ geometry: [ORIGIN, MIDPOINT, DESTINATION], riddenAt: "2026-07-01T12:00:00.000Z" }];
      },
    });

    await service.begin({
      rideId: RIDE_ID,
      rideRevision: 5,
      intent: { ...plannedIntent(), noveltyPreference: "prefer-new-to-me" },
    });

    expect(historyReads).toBe(1);
    expect(posts[0]?.body.request).not.toHaveProperty("history");
    const snapshot = service.snapshot();
    const bundle = snapshot.committedBundle;
    expect(bundle).not.toBeNull();
    const routeA = bundle?.candidates.find((candidate) => candidate.fingerprint === "fp_a");
    const routeB = bundle?.candidates.find((candidate) => candidate.fingerprint === "fp_b");
    const candidateA = routeA;
    const candidateB = routeB;
    if (candidateA === undefined || candidateB === undefined) {
      throw new Error("the test expected both personalized candidates");
    }
    expect(candidateA.evidence.novelty?.status).toBe("estimated");
    expect(candidateB.evidence.novelty?.status).toBe("estimated");
    expect(candidateA.score.components.novelty.input).toBe(0);
    expect(candidateB.score.components.novelty.input).toBe(1);
    expect(candidateA.score.components.timeCost).toEqual(
      personalizedSuccessBody({} as RoutePlanIdentityWire).bundle.candidates[0]?.score.components.timeCost,
    );
    expect(candidateA.score.components.traffic).toEqual(
      personalizedSuccessBody({} as RoutePlanIdentityWire).bundle.candidates[0]?.score.components.traffic,
    );
    expect(bundle?.roles["best-ride"]).toBe(candidateB.id);
    expect(bundle?.roles.fastest).toBe(candidateA.id);
    expect(bundle?.selectedRouteId).toBe(candidateB.id);
  });

  it("locks a rider selection inside one generation", async () => {
    const { fetcher } = successFetcher();
    const service = createClientPlanningService({ fetcher, now });
    const store = createPlanningSessionStore({ service });

    await store.getState().begin({
      rideId: RIDE_ID,
      rideRevision: 5,
      intent: plannedIntent(),
    });
    const chosen = store.getState().snapshot.committedBundle?.candidates[1];
    if (chosen === undefined) throw new Error("expected a second candidate");
    store.getState().selectRoute(chosen.id);

    expect(store.getState().snapshot.selectionSource).toBe("rider");
    expect(store.getState().snapshot.selectedRouteId).toBe(chosen.id);
  });

  it("keeps the selection inside the bundle it can see after a replan", async () => {
    const { fetcher } = successFetcher();
    const service = createClientPlanningService({ fetcher, now });
    const store = createPlanningSessionStore({ service });

    await store.getState().begin({
      rideId: RIDE_ID,
      rideRevision: 5,
      intent: plannedIntent(),
    });
    const chosen = store.getState().snapshot.committedBundle?.candidates[1];
    if (chosen === undefined) throw new Error("expected a second candidate");
    store.getState().selectRoute(chosen.id);

    await store.getState().begin({
      rideId: RIDE_ID,
      rideRevision: 6,
      intent: plannedIntent(),
    });

    // Known limitation, recorded as OGV-D-182: the placeholder pipeline mints a
    // fresh candidate id per generation, so a reference to a candidate that is
    // really the same route does not survive a replan and the automatic rule
    // takes over. What must hold regardless is that a bundle only ever selects a
    // route it contains (OGV-D-148/OGV-D-171) — Wave 3's real pipeline derives a
    // stable candidate identity from the provider fingerprint.
    const snapshot = store.getState().snapshot;
    expect(snapshot.identity.planningGeneration).toBe(2);
    expect(snapshot.selectionSource).toBe("automatic");
    expect(
      snapshot.committedBundle?.candidates.some(
        (candidate) => candidate.id === snapshot.selectedRouteId,
      ),
    ).toBe(true);
  });

  it("reports a provider answer the engine refused as a session error", async () => {
    const fetcher = (async (): Promise<Response> =>
      jsonResponse(false, 422, {
        error: {
          code: "no-route",
          message: "No route was found for this ride.",
          recoverable: false,
        },
      })) as typeof fetch;
    const service = createClientPlanningService({ fetcher, now });
    const store = createPlanningSessionStore({ service });

    await store.getState().begin({
      rideId: RIDE_ID,
      rideRevision: 5,
      intent: plannedIntent(),
    });

    const snapshot = store.getState().snapshot;
    expect(snapshot.phase).toBe("failed");
    expect(snapshot.error?.code).toBe("no-route");
    expect(snapshot.committedBundle).toBeNull();
  });

  it("cancelling resolves the attempt without inventing a failure", async () => {
    const { fetcher } = hangingFetcher();
    const service = createClientPlanningService({ fetcher, now });
    const store = createPlanningSessionStore({ service });

    const pending = store.getState().begin({
      rideId: RIDE_ID,
      rideRevision: 5,
      intent: plannedIntent(),
    });
    store.getState().cancel();
    await pending;

    const snapshot = store.getState().snapshot;
    expect(snapshot.phase).toBe("cancelled");
    expect(snapshot.error).toBeNull();
    expect(snapshot.settledAt).toBe(FIXED);
  });

  it("never stores a fabricated geometry handle", () => {
    const service = createClientPlanningService({ fetcher: hangingFetcher().fetcher, now });
    const store = createPlanningSessionStore({ service });

    expect(store.getState().geometry).toEqual({});
    expect(store.getState().snapshot.phase).toBe("idle");
  });

  it("keeps the document fixture's intent untouched", () => {
    const intent = plannedIntent();
    const document = documentFor(intent);

    expect(document.intent).toBe(intent);
    expect(asGeometryRef("geo_x")).toBe("geo_x");
  });
});
