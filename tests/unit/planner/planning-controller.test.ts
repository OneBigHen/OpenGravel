/**
 * The PlanningSession controller (02-ARCHITECTURE-CONTRACT §2.2/§9/§13,
 * 06-ROUTING-AND-DECISION-ENGINE §4–§5/§28–§29, 21-RED-TEAM-AND-FAILURE-MODES
 * §7–§8).
 *
 * The controller is authority #2: one session answers one RideDocument
 * revision, and every commit is fenced by `(rideId, rideRevision,
 * planningGeneration)`. The tests below are the regression suite for the three
 * ways that fence is usually broken:
 *
 * 1. ownership — a new `begin` takes the generation *before* it aborts the
 *    previous attempt, so a late result from the old generation can never
 *    commit a bundle, move a selection, change a phase or post a diagnostic;
 * 2. cancellation — an aborted attempt is `cancelled`, never a failure and
 *    never a success, and late work after it is a no-op;
 * 3. selection — the rider's pick locks, while automatic selection stays
 *    replaceable until the rider picks.
 *
 * Providers are fake and manually controlled (the deferred pattern) so a test
 * can resolve an *older* generation after a newer one started — the exact race
 * the fence exists for. Resolutions are deliberately not abort-aware: a
 * provider that ignores its signal is the worst case, not a special case.
 */

import { describe, expect, it } from "vitest";

import type { GeometryStore } from "@/application/geometry/geometry-store";
import { createMemoryGeometryStore } from "@/application/geometry/memory-geometry-store";
import type {
  PlanRequestContext,
  PlanRequestVersions,
} from "@/application/planner/build-plan-request";
import type {
  CandidatePipeline,
  CandidatePipelineInput,
  CandidatePipelineRoleInput,
  PlanningController,
} from "@/application/planner/planning-controller";
import { createPlanningController } from "@/application/planner/planning-controller";
import type {
  ProviderCandidate,
  ProviderCandidateSet,
  ProviderCapabilities,
  ProviderRouteRequest,
  RouteCandidateProvider,
} from "@/application/planner/route-provider";
import {
  emptyPlanningSession,
  type PlanningPhase,
  type PlanningSessionSnapshot,
  type ProviderDiagnostic,
} from "@/application/planner/planning-session";
import {
  asGeometryRef,
  newRideId,
  type AvoidAreaId,
  type PointId,
  type RideId,
} from "@/domain/ride/ids";
import { defaultRideIntent } from "@/domain/ride/create";
import type { Coordinate, RideIntent, RidePoint } from "@/domain/ride/types";
import { asRouteCandidateId } from "@/domain/route/ids";
import type {
  RouteCandidate,
  RouteEvidence,
  RouteRoles,
  RouteScore,
  RouteScoreComponents,
} from "@/domain/route/types";

/* -------------------------------------------------------------------------
 * Fixtures and fakes
 * ---------------------------------------------------------------------- */

const RIDE_ID: RideId = newRideId();
const OTHER_RIDE_ID: RideId = newRideId();

const VERSIONS: PlanRequestVersions = {
  routePolicy: "PA_NJ_ROUTE_POLICY_VNEXT_1",
  graph: "gh-nj-2026-04",
  evidence: "road-intel-3",
};

const ORIGIN: Coordinate = { lon: -75.1652, lat: 39.9526 };
const DESTINATION: Coordinate = { lon: -75.5012, lat: 40.1203 };
const CANDIDATE_GEOMETRY: readonly Coordinate[] = [
  ORIGIN,
  { lon: -75.31, lat: 40.02 },
  DESTINATION,
];

const FIXED_CLOCK = (): string => "2026-09-17T00:00:00.000Z";

function endpoint(id: string, kind: "start" | "finish", coordinate: Coordinate): RidePoint {
  return {
    id: id as PointId,
    kind,
    coordinate,
    provenance: { type: "map", selectedAt: "2026-09-17T00:00:00.000Z" },
  };
}

/** A valid `destination` ride: one start, one finish (the default fixture). */
function plannedIntent(overrides: Partial<RideIntent> = {}): RideIntent {
  return {
    ...defaultRideIntent(),
    start: endpoint("pt_start", "start", ORIGIN),
    finish: endpoint("pt_finish", "finish", DESTINATION),
    ...overrides,
  };
}

/** Raises a clear failure instead of `!` at a lookup that must succeed. */
function required<T>(value: T | undefined): T {
  if (value === undefined) {
    throw new Error("the test expected a defined value");
  }
  return value;
}

/** Flushes pending microtasks and the macrotask queue. */
async function flush(): Promise<void> {
  await new Promise((resolve) => {
    setTimeout(resolve, 0);
  });
}

interface Deferred<T> {
  readonly promise: Promise<T>;
  resolve(value: T): void;
  reject(reason: unknown): void;
}

function deferred<T>(): Deferred<T> {
  let resolve: (value: T) => void = () => undefined;
  let reject: (reason: unknown) => void = () => undefined;
  const promise = new Promise<T>((onResolve, onReject) => {
    resolve = onResolve;
    reject = onReject;
  });
  return { promise, resolve, reject };
}

interface ProviderCall {
  readonly request: ProviderRouteRequest;
  readonly signal: AbortSignal;
}

interface FakeProvider {
  readonly provider: RouteCandidateProvider;
  readonly calls: ProviderCall[];
  settle(index: number, candidates: readonly ProviderCandidate[]): void;
  fail(index: number, error: unknown): void;
}

function fakeProvider(
  id: string,
  options: { readonly onCall?: () => void } = {},
): FakeProvider {
  const calls: ProviderCall[] = [];
  const pending: Deferred<ProviderCandidateSet>[] = [];
  const provider: RouteCandidateProvider = {
    id,
    capabilities(): ProviderCapabilities {
      return {
        profiles: ["motorcycle_fastest"],
        supportsAlternatives: true,
        supportsAvoidPolygons: true,
      };
    },
    candidates(
      request: ProviderRouteRequest,
      signal: AbortSignal,
    ): Promise<ProviderCandidateSet> {
      calls.push({ request, signal });
      options.onCall?.();
      const answer = deferred<ProviderCandidateSet>();
      pending.push(answer);
      // Deliberately ignores `signal`: the test owns when this settles, so a
      // late resolution can be delivered after a newer generation started.
      return answer.promise;
    },
  };
  return {
    provider,
    calls,
    settle(index, candidates) {
      required(pending[index]).resolve({ candidates: [...candidates] });
    },
    fail(index, error) {
      required(pending[index]).reject(error);
    },
  };
}

function callAt(fake: FakeProvider, index: number): ProviderCall {
  return required(fake.calls[index]);
}

function rawCandidate(
  providerId: string,
  overrides: Partial<ProviderCandidate> = {},
): ProviderCandidate {
  return {
    providerId,
    profile: "motorcycle_fastest",
    geometry: CANDIDATE_GEOMETRY.map((coordinate) => ({ ...coordinate })),
    distanceMeters: 48_000,
    durationSeconds: 3_600,
    ...overrides,
  };
}

function unscoredScore(): RouteScore {
  const component = (key: string): RouteScore["components"]["curvature"] => ({
    input: null,
    weight: 0,
    contribution: 0,
    explanationKey: `test.${key}`,
    evidenceStatus: "unknown",
  });
  const components: RouteScoreComponents = {
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
  };
  return { policyVersion: "test-policy", total: 0, components };
}

function routeCandidate(
  id: string,
  providerId: string,
  options: { readonly failures?: readonly string[] } = {},
): RouteCandidate {
  const failures = (options.failures ?? []).map((code) => ({
    code,
    message: `${code} failed`,
  }));
  const evidence: RouteEvidence = {};
  return {
    id: asRouteCandidateId(id),
    provider: { providerId, profile: "motorcycle_fastest" },
    geometryRef: asGeometryRef(`geo_${id}`),
    distanceMeters: 48_000,
    durationSeconds: 3_600,
    eligibility: { eligible: failures.length === 0, failures },
    evidence,
    score: unscoredScore(),
    warnings: [],
    fingerprint: `fp-${id}`,
  };
}

interface MappingPipeline {
  readonly pipeline: CandidatePipeline;
  readonly calls: CandidatePipelineInput[];
}

/**
 * The Wave-3 seam, faked: every test states exactly how a provider candidate
 * becomes a bundle candidate, so no test depends on the placeholder pipeline.
 */
function mappingPipeline(
  map: (input: CandidatePipelineInput) => readonly RouteCandidate[],
): MappingPipeline {
  const calls: CandidatePipelineInput[] = [];
  return {
    calls,
    pipeline: {
      normalize(input: CandidatePipelineInput): readonly RouteCandidate[] {
        calls.push(input);
        return map(input);
      },
    },
  };
}

/** Provider-priority ids: `<providerId>-<index>`, stable inside a test. */
function identityPipeline(): MappingPipeline {
  return mappingPipeline(({ providerId, candidates }) =>
    candidates.map((_candidate, index) => routeCandidate(`${providerId}-${index}`, providerId)),
  );
}

interface ControllerOptions {
  readonly providers: readonly RouteCandidateProvider[];
  readonly pipeline?: CandidatePipeline;
  readonly geometryStore?: GeometryStore;
  readonly resolveGeometry?: PlanRequestContext["resolveGeometry"];
  readonly profileFor?: (intent: RideIntent) => string;
  readonly includeAlternatives?: boolean;
  readonly now?: () => string;
  readonly onUpdate?: (snapshot: PlanningSessionSnapshot) => void;
  readonly rideId?: RideId;
}

function buildController(options: ControllerOptions): PlanningController {
  const requestContext = {
    resolveGeometry: options.resolveGeometry ?? ((): null => null),
    profileFor: options.profileFor ?? ((): string => "motorcycle_fastest"),
    ...(options.includeAlternatives === undefined
      ? {}
      : { includeAlternatives: options.includeAlternatives }),
  };
  const shared = {
    providers: options.providers,
    requestContext,
    ...(options.now === undefined ? {} : { now: options.now }),
    ...(options.onUpdate === undefined ? {} : { onUpdate: options.onUpdate }),
  };
  return options.pipeline === undefined
    ? createPlanningController({
        ...shared,
        geometryStore: options.geometryStore ?? createMemoryGeometryStore(),
      })
    : createPlanningController({ ...shared, pipeline: options.pipeline });
}

function begin(
  controller: PlanningController,
  rideRevision: number,
  intent: RideIntent = plannedIntent(),
  rideId: RideId = RIDE_ID,
): Promise<void> {
  return controller.begin({ rideId, rideRevision, intent, versions: VERSIONS });
}

function diagnosticFor(
  snapshot: PlanningSessionSnapshot,
  providerId: string,
): ProviderDiagnostic {
  return required(snapshot.diagnostics.find((entry) => entry.providerId === providerId));
}

function candidateIds(snapshot: PlanningSessionSnapshot): readonly string[] {
  return (snapshot.committedBundle?.candidates ?? []).map((candidate) => candidate.id);
}

/**
 * The phase *changes* in an update log. A subscriber is notified on every
 * state change (candidates growing inside a phase included), so a phase log is
 * the collapsed sequence, not every delivery.
 */
function phaseChanges(snapshotPhases: readonly PlanningPhase[]): PlanningPhase[] {
  const changes: PlanningPhase[] = [];
  for (const phase of snapshotPhases) {
    if (changes[changes.length - 1] !== phase) changes.push(phase);
  }
  return changes;
}

/* -------------------------------------------------------------------------
 * The empty session and the snapshot surface
 * ---------------------------------------------------------------------- */

describe("PlanningSession snapshot", () => {
  it("reports an idle attempt with no ride identity before begin", () => {
    const empty = emptyPlanningSession(null);

    expect(empty.identity).toEqual({
      rideId: null,
      rideRevision: 0,
      planningGeneration: 0,
    });
    expect(empty.phase).toBe("idle");
    expect(empty.committedBundle).toBeNull();
    expect(empty.lastGoodBundle).toBeNull();
    expect(empty.selectedRouteId).toBeNull();
    expect(empty.selectionSource).toBe("automatic");
    expect(empty.error).toBeNull();
    expect(empty.diagnostics).toEqual([]);
    expect(empty.settledAt).toBeNull();
    expect(typeof empty.startedAt).toBe("string");
  });

  it("keeps a supplied ride identity in the empty session", () => {
    expect(emptyPlanningSession(RIDE_ID).identity.rideId).toBe(RIDE_ID);
  });

  it("starts a controller idle on the same shape", () => {
    const controller = buildController({ providers: [] });

    expect(controller.snapshot().phase).toBe("idle");
    expect(controller.snapshot().identity).toEqual({
      rideId: null,
      rideRevision: 0,
      planningGeneration: 0,
    });
  });
});

/* -------------------------------------------------------------------------
 * Generation ownership (21 §7, 02 §9)
 * ---------------------------------------------------------------------- */

describe("generation ownership", () => {
  it("takes the new generation before aborting the previous attempt", async () => {
    const log: string[] = [];
    const alpha = fakeProvider("alpha", { onCall: () => log.push("provider-call") });
    const controller = buildController({ providers: [alpha.provider], now: FIXED_CLOCK });

    void begin(controller, 1);
    await flush();
    expect(alpha.calls).toHaveLength(1);

    callAt(alpha, 0).signal.addEventListener("abort", () => {
      log.push(`abort:generation=${controller.snapshot().identity.planningGeneration}`);
    });

    void begin(controller, 2);
    await flush();

    // (a) ownership moves, then (b) the old work is aborted, then (d) new work.
    expect(log).toEqual(["provider-call", "abort:generation=2", "provider-call"]);
    expect(controller.snapshot().identity.planningGeneration).toBe(2);
    expect(controller.snapshot().identity.rideRevision).toBe(2);
  });

  it("ignores a late primary result from a superseded generation", async () => {
    const alpha = fakeProvider("alpha");
    const pipeline = identityPipeline();
    const updates: PlanningSessionSnapshot[] = [];
    const controller = buildController({
      providers: [alpha.provider],
      pipeline: pipeline.pipeline,
      now: FIXED_CLOCK,
      onUpdate: (snapshot) => updates.push(snapshot),
    });

    void begin(controller, 1);
    await flush();
    void begin(controller, 2);
    await flush();

    const before = controller.snapshot();
    const updatesBefore = updates.length;
    expect(before.phase).toBe("routing-primary");

    alpha.settle(0, [rawCandidate("alpha")]);
    await flush();

    // No bundle, no selection, no phase change, no diagnostic, no update.
    expect(controller.snapshot()).toEqual(before);
    expect(controller.snapshot().committedBundle).toBeNull();
    expect(controller.snapshot().selectedRouteId).toBeNull();
    expect(updates).toHaveLength(updatesBefore);
  });

  it("ignores a late alternative from a superseded generation", async () => {
    const alpha = fakeProvider("alpha");
    const beta = fakeProvider("beta");
    const pipeline = identityPipeline();
    const controller = buildController({
      providers: [alpha.provider, beta.provider],
      pipeline: pipeline.pipeline,
      now: FIXED_CLOCK,
    });

    void begin(controller, 1);
    await flush();
    void begin(controller, 2);
    await flush();

    alpha.settle(1, [rawCandidate("alpha")]);
    await flush();
    const afterPrimary = controller.snapshot();
    expect(afterPrimary.phase).toBe("alternatives-loading");

    beta.settle(0, [rawCandidate("beta")]);
    await flush();

    // Beta's answer belongs to generation 1: it may not touch generation 2.
    expect(controller.snapshot()).toEqual(afterPrimary);
  });

  it("resolves begin when its attempt settles", async () => {
    const alpha = fakeProvider("alpha");
    const controller = buildController({
      providers: [alpha.provider],
      pipeline: identityPipeline().pipeline,
      now: FIXED_CLOCK,
    });

    const settled = begin(controller, 1);
    await flush();
    alpha.settle(0, [rawCandidate("alpha")]);

    await expect(settled).resolves.toBeUndefined();
    expect(controller.snapshot().phase).toBe("ready");
  });

  it("resolves a superseded begin instead of leaving it pending", async () => {
    const alpha = fakeProvider("alpha");
    const controller = buildController({
      providers: [alpha.provider],
      pipeline: identityPipeline().pipeline,
      now: FIXED_CLOCK,
    });

    const first = begin(controller, 1);
    await flush();
    const second = begin(controller, 2);
    await flush();

    await expect(first).resolves.toBeUndefined();

    alpha.settle(1, [rawCandidate("alpha")]);
    await expect(second).resolves.toBeUndefined();
  });

  it("does not compare revisions: the newest begin owns the session", async () => {
    const alpha = fakeProvider("alpha");
    const pipeline = identityPipeline();
    const controller = buildController({
      providers: [alpha.provider],
      pipeline: pipeline.pipeline,
      now: FIXED_CLOCK,
    });

    void begin(controller, 7);
    await flush();
    void begin(controller, 3);
    await flush();

    alpha.settle(1, [rawCandidate("alpha")]);
    await flush();

    // The new generation owns the answer; the RideDocument authority, not the
    // planner, is what rejects an out-of-order revision.
    expect(controller.snapshot().identity.rideRevision).toBe(3);
    expect(controller.snapshot().phase).toBe("ready");
    expect(controller.snapshot().committedBundle?.rideRevision).toBe(3);
  });
});

/* -------------------------------------------------------------------------
 * Progressive phases (06 §4–§5)
 * ---------------------------------------------------------------------- */

describe("progressive phases", () => {
  it("walks validating → routing-primary → primary-ready → alternatives-loading → ready", async () => {
    const alpha = fakeProvider("alpha");
    const beta = fakeProvider("beta");
    const phases: PlanningPhase[] = [];
    const controller = buildController({
      providers: [alpha.provider, beta.provider],
      pipeline: identityPipeline().pipeline,
      now: FIXED_CLOCK,
      onUpdate: (snapshot) => phases.push(snapshot.phase),
    });

    void begin(controller, 1);
    await flush();
    alpha.settle(0, [rawCandidate("alpha")]);
    await flush();
    beta.settle(0, [rawCandidate("beta")]);
    await flush();

    expect(phaseChanges(phases)).toEqual([
      "validating",
      "routing-primary",
      "primary-ready",
      "alternatives-loading",
      "ready",
    ]);
  });

  it("commits the primary bundle from the first usable set that arrives", async () => {
    const alpha = fakeProvider("alpha");
    const beta = fakeProvider("beta");
    const controller = buildController({
      providers: [alpha.provider, beta.provider],
      pipeline: identityPipeline().pipeline,
      now: FIXED_CLOCK,
    });

    void begin(controller, 1);
    await flush();

    beta.settle(0, [rawCandidate("beta")]);
    await flush();

    const primary = controller.snapshot();
    expect(primary.phase).toBe("alternatives-loading");
    expect(candidateIds(primary)).toEqual(["beta-0"]);
    expect(primary.committedBundle?.selectionSource).toBe("automatic");
    expect(primary.committedBundle?.planningGeneration).toBe(1);
    expect(primary.committedBundle?.policyVersion).toBe(VERSIONS.routePolicy);
    expect(primary.committedBundle?.graphVersion).toBe(VERSIONS.graph);
    expect(primary.committedBundle?.evidenceVersion).toBe(VERSIONS.evidence);
    expect(primary.committedBundle?.rideId).toBe(RIDE_ID);
    expect(primary.settledAt).toBeNull();
  });

  it("adds later candidates to the committed bundle", async () => {
    const alpha = fakeProvider("alpha");
    const beta = fakeProvider("beta");
    const controller = buildController({
      providers: [alpha.provider, beta.provider],
      pipeline: identityPipeline().pipeline,
      now: FIXED_CLOCK,
    });

    void begin(controller, 1);
    await flush();
    beta.settle(0, [rawCandidate("beta")]);
    await flush();
    alpha.settle(0, [rawCandidate("alpha")]);
    await flush();

    expect(controller.snapshot().phase).toBe("ready");
    expect(candidateIds(controller.snapshot())).toEqual(["beta-0", "alpha-0"]);
  });

  it("goes straight to ready when the only provider settles", async () => {
    const alpha = fakeProvider("alpha");
    const phases: PlanningPhase[] = [];
    const controller = buildController({
      providers: [alpha.provider],
      pipeline: identityPipeline().pipeline,
      now: FIXED_CLOCK,
      onUpdate: (snapshot) => phases.push(snapshot.phase),
    });

    void begin(controller, 1);
    await flush();
    alpha.settle(0, [rawCandidate("alpha")]);
    await flush();

    expect(phaseChanges(phases)).toEqual([
      "validating",
      "routing-primary",
      "primary-ready",
      "ready",
    ]);
    expect(controller.snapshot().settledAt).not.toBeNull();
  });

  it("notifies subscribers when candidates grow inside a phase", async () => {
    const alpha = fakeProvider("alpha");
    const beta = fakeProvider("beta");
    const gamma = fakeProvider("gamma");
    const deliveries: { phase: PlanningPhase; candidates: readonly string[] }[] = [];
    const controller = buildController({
      providers: [alpha.provider, beta.provider, gamma.provider],
      pipeline: identityPipeline().pipeline,
      now: FIXED_CLOCK,
      onUpdate: (snapshot) => {
        deliveries.push({ phase: snapshot.phase, candidates: candidateIds(snapshot) });
      },
    });

    void begin(controller, 1);
    await flush();
    alpha.settle(0, [rawCandidate("alpha")]);
    await flush();

    const loadingSets = [
      ...new Set(
        deliveries
          .filter((delivery) => delivery.phase === "alternatives-loading")
          .map((delivery) => delivery.candidates.join(",")),
      ),
    ];
    expect(loadingSets).toEqual(["alpha-0"]);

    beta.settle(0, [rawCandidate("beta")]);
    await flush();

    // Still loading (gamma is out), but the grown candidate set was delivered:
    // a surface never has to poll for alternatives.
    const grownSets = [
      ...new Set(
        deliveries
          .filter((delivery) => delivery.phase === "alternatives-loading")
          .map((delivery) => delivery.candidates.join(",")),
      ),
    ];
    expect(grownSets).toEqual(["alpha-0", "alpha-0,beta-0"]);
  });

  it("hands every provider the same canonical request", async () => {
    const alpha = fakeProvider("alpha");
    const beta = fakeProvider("beta");
    const controller = buildController({
      providers: [alpha.provider, beta.provider],
      pipeline: identityPipeline().pipeline,
      profileFor: () => "motorcycle_twisty",
      now: FIXED_CLOCK,
    });

    void begin(controller, 1);
    await flush();

    const first = callAt(alpha, 0).request;
    expect(callAt(beta, 0).request).toBe(first);
    expect(first.profile).toBe("motorcycle_twisty");
    expect(first.options.vehicle).toBe("motorcycle");
    expect(first.options.includeAlternatives).toBe(true);
    expect(first.origin).toEqual(ORIGIN);
    expect(first.destination).toEqual(DESTINATION);
  });

  it("honours an explicit alternatives policy", async () => {
    const alpha = fakeProvider("alpha");
    const controller = buildController({
      providers: [alpha.provider],
      pipeline: identityPipeline().pipeline,
      includeAlternatives: false,
      now: FIXED_CLOCK,
    });

    void begin(controller, 1);
    await flush();

    expect(callAt(alpha, 0).request.options.includeAlternatives).toBe(false);
  });
});

/* -------------------------------------------------------------------------
 * Selection (03 §15, 06 §15)
 * ---------------------------------------------------------------------- */

describe("selection", () => {
  it("auto-selects the first eligible candidate of the highest-priority provider", async () => {
    const alpha = fakeProvider("alpha");
    const beta = fakeProvider("beta");
    const controller = buildController({
      providers: [alpha.provider, beta.provider],
      pipeline: identityPipeline().pipeline,
      now: FIXED_CLOCK,
    });

    void begin(controller, 1);
    await flush();

    beta.settle(0, [rawCandidate("beta")]);
    await flush();
    expect(controller.snapshot().selectedRouteId).toBe("beta-0");

    alpha.settle(0, [rawCandidate("alpha"), rawCandidate("alpha")]);
    await flush();

    // Priority order, not arrival order; automatic selection stays replaceable.
    expect(controller.snapshot().selectedRouteId).toBe("alpha-0");
    expect(controller.snapshot().selectionSource).toBe("automatic");
  });

  it("never auto-selects an ineligible candidate", async () => {
    const alpha = fakeProvider("alpha");
    const beta = fakeProvider("beta");
    const pipeline = mappingPipeline(({ providerId, candidates }) =>
      candidates.map((_candidate, index) =>
        routeCandidate(`${providerId}-${index}`, providerId, {
          failures: providerId === "alpha" ? ["active-avoid-area"] : [],
        }),
      ),
    );
    const controller = buildController({
      providers: [alpha.provider, beta.provider],
      pipeline: pipeline.pipeline,
      now: FIXED_CLOCK,
    });

    void begin(controller, 1);
    await flush();

    alpha.settle(0, [rawCandidate("alpha")]);
    await flush();
    // Alpha's only candidate is ineligible: no usable set yet, so no commit.
    expect(controller.snapshot().phase).toBe("routing-primary");
    expect(controller.snapshot().committedBundle).toBeNull();

    beta.settle(0, [rawCandidate("beta")]);
    await flush();

    expect(controller.snapshot().phase).toBe("ready");
    expect(controller.snapshot().selectedRouteId).toBe("beta-0");
    // The ineligible candidate is still recorded: it explains itself.
    expect(candidateIds(controller.snapshot())).toEqual(["alpha-0", "beta-0"]);
  });

  it("locks a rider selection against later alternatives", async () => {
    const alpha = fakeProvider("alpha");
    const beta = fakeProvider("beta");
    const controller = buildController({
      providers: [alpha.provider, beta.provider],
      pipeline: identityPipeline().pipeline,
      now: FIXED_CLOCK,
    });

    void begin(controller, 1);
    await flush();
    beta.settle(0, [rawCandidate("beta")]);
    await flush();
    controller.selectRoute(asRouteCandidateId("beta-0"));

    alpha.settle(0, [rawCandidate("alpha")]);
    await flush();

    expect(controller.snapshot().phase).toBe("ready");
    expect(candidateIds(controller.snapshot())).toEqual(["beta-0", "alpha-0"]);
    expect(controller.snapshot().selectedRouteId).toBe("beta-0");
    expect(controller.snapshot().selectionSource).toBe("rider");
    expect(controller.snapshot().committedBundle?.selectedRouteId).toBe("beta-0");
  });

  it("rewrites the committed bundle when the rider selects a route", async () => {
    const alpha = fakeProvider("alpha");
    const controller = buildController({
      providers: [alpha.provider],
      pipeline: identityPipeline().pipeline,
      now: FIXED_CLOCK,
    });

    void begin(controller, 1);
    await flush();
    alpha.settle(0, [rawCandidate("alpha"), rawCandidate("alpha")]);
    await flush();
    expect(controller.snapshot().selectedRouteId).toBe("alpha-0");

    controller.selectRoute(asRouteCandidateId("alpha-1"));

    const snapshot = controller.snapshot();
    expect(snapshot.selectionSource).toBe("rider");
    expect(snapshot.selectedRouteId).toBe("alpha-1");
    expect(snapshot.committedBundle?.selectedRouteId).toBe("alpha-1");
    expect(snapshot.committedBundle?.selectionSource).toBe("rider");
    expect(snapshot.lastGoodBundle?.selectedRouteId).toBe("alpha-1");
    expect(snapshot.phase).toBe("ready");
  });

  it("ignores a selection for a candidate the bundle does not contain", async () => {
    const alpha = fakeProvider("alpha");
    const controller = buildController({
      providers: [alpha.provider],
      pipeline: identityPipeline().pipeline,
      now: FIXED_CLOCK,
    });

    void begin(controller, 1);
    await flush();
    alpha.settle(0, [rawCandidate("alpha")]);
    await flush();

    controller.selectRoute(asRouteCandidateId("route_not_there"));

    expect(controller.snapshot().selectedRouteId).toBe("alpha-0");
    expect(controller.snapshot().selectionSource).toBe("automatic");
  });

  it("falls back to automatic when a new revision lacks the rider's route", async () => {
    const alpha = fakeProvider("alpha");
    const pipeline = mappingPipeline(({ identity, providerId, candidates }) =>
      candidates.map((_candidate, index) =>
        routeCandidate(`g${identity.planningGeneration}-${providerId}-${index}`, providerId),
      ),
    );
    const controller = buildController({
      providers: [alpha.provider],
      pipeline: pipeline.pipeline,
      now: FIXED_CLOCK,
    });

    void begin(controller, 1);
    await flush();
    alpha.settle(0, [rawCandidate("alpha")]);
    await flush();
    controller.selectRoute(asRouteCandidateId("g1-alpha-0"));
    expect(controller.snapshot().selectionSource).toBe("rider");

    const settled = begin(controller, 2);
    await flush();
    alpha.settle(1, [rawCandidate("alpha")]);
    await flush();

    // The rider's route is gone from this revision, so the bundle must select
    // a route it contains — and says so.
    expect(controller.snapshot().selectedRouteId).toBe("g2-alpha-0");
    expect(controller.snapshot().selectionSource).toBe("automatic");
    await expect(settled).resolves.toBeUndefined();
  });
});

/* -------------------------------------------------------------------------
 * Cancellation (06 §28, 21 §8)
 * ---------------------------------------------------------------------- */

describe("cancellation", () => {
  it("retains the last-good bundle and selection, and cancels in-flight work", async () => {
    const alpha = fakeProvider("alpha");
    const beta = fakeProvider("beta");
    const controller = buildController({
      providers: [alpha.provider, beta.provider],
      pipeline: identityPipeline().pipeline,
      now: FIXED_CLOCK,
    });

    void begin(controller, 1);
    await flush();
    beta.settle(0, [rawCandidate("beta")]);
    await flush();

    const lastGood = controller.snapshot().lastGoodBundle;
    expect(lastGood).not.toBeNull();
    expect(controller.snapshot().selectedRouteId).toBe("beta-0");

    const second = begin(controller, 2);
    await flush();
    expect(controller.snapshot().phase).toBe("routing-primary");
    expect(controller.snapshot().committedBundle).toBeNull();
    expect(controller.snapshot().lastGoodBundle).toBe(lastGood);
    expect(controller.snapshot().selectedRouteId).toBe("beta-0");

    controller.cancel();

    const cancelled = controller.snapshot();
    expect(cancelled.phase).toBe("cancelled");
    expect(cancelled.settledAt).not.toBeNull();
    expect(cancelled.error).toBeNull();
    expect(cancelled.lastGoodBundle).toBe(lastGood);
    expect(cancelled.selectedRouteId).toBe("beta-0");
    expect(cancelled.committedBundle).toBeNull();
    await expect(second).resolves.toBeUndefined();

    alpha.settle(1, [rawCandidate("alpha")]);
    beta.settle(1, [rawCandidate("beta")]);
    await flush();

    expect(controller.snapshot()).toEqual(cancelled);
  });

  it("reports cancelled only for the providers that had not settled", async () => {
    const alpha = fakeProvider("alpha");
    const beta = fakeProvider("beta");
    const controller = buildController({
      providers: [alpha.provider, beta.provider],
      pipeline: identityPipeline().pipeline,
      now: FIXED_CLOCK,
    });

    void begin(controller, 1);
    await flush();
    alpha.settle(0, [rawCandidate("alpha")]);
    await flush();

    controller.cancel();

    expect(controller.snapshot().diagnostics).toEqual([
      { providerId: "alpha", outcome: "ok", candidateCount: 1 },
      { providerId: "beta", outcome: "cancelled", candidateCount: 0 },
    ]);
    expect(callAt(beta, 0).signal.aborted).toBe(true);
  });

  it("keeps an abort-shaped rejection after cancel as cancellation, never failure", async () => {
    const alpha = fakeProvider("alpha");
    const controller = buildController({
      providers: [alpha.provider],
      pipeline: identityPipeline().pipeline,
      now: FIXED_CLOCK,
    });

    void begin(controller, 1);
    await flush();
    controller.cancel();

    const afterCancel = controller.snapshot();
    expect(afterCancel.phase).toBe("cancelled");
    expect(diagnosticFor(afterCancel, "alpha")).toEqual({
      providerId: "alpha",
      outcome: "cancelled",
      candidateCount: 0,
    });

    alpha.fail(0, new DOMException("aborted", "AbortError"));
    await flush();

    expect(controller.snapshot()).toEqual(afterCancel);
    expect(controller.snapshot().error).toBeNull();
    expect(controller.snapshot().diagnostics).toEqual(afterCancel.diagnostics);
  });

  it("is a no-op once the attempt has settled", async () => {
    const alpha = fakeProvider("alpha");
    const controller = buildController({
      providers: [alpha.provider],
      pipeline: identityPipeline().pipeline,
      now: FIXED_CLOCK,
    });

    void begin(controller, 1);
    await flush();
    alpha.settle(0, [rawCandidate("alpha")]);
    await flush();
    const ready = controller.snapshot();

    controller.cancel();

    expect(controller.snapshot()).toEqual(ready);
  });
});

/* -------------------------------------------------------------------------
 * Failure semantics (06 §29)
 * ---------------------------------------------------------------------- */

describe("failure semantics", () => {
  it("fails with no-route when every provider answers without a usable candidate", async () => {
    const alpha = fakeProvider("alpha");
    const beta = fakeProvider("beta");
    const controller = buildController({
      providers: [alpha.provider, beta.provider],
      pipeline: identityPipeline().pipeline,
      now: FIXED_CLOCK,
    });

    void begin(controller, 1);
    await flush();
    alpha.settle(0, []);
    beta.settle(0, []);
    await flush();

    const failed = controller.snapshot();
    expect(failed.phase).toBe("failed");
    expect(failed.error).toEqual({
      code: "no-route",
      message: expect.any(String),
      recoverable: false,
    });
    expect(failed.committedBundle).toBeNull();
    expect(failed.diagnostics).toEqual([
      { providerId: "alpha", outcome: "ok", candidateCount: 0 },
      { providerId: "beta", outcome: "ok", candidateCount: 0 },
    ]);
  });

  it("fails with provider-unavailable when no provider answered", async () => {
    const alpha = fakeProvider("alpha");
    const beta = fakeProvider("beta");
    const controller = buildController({
      providers: [alpha.provider, beta.provider],
      pipeline: identityPipeline().pipeline,
      now: FIXED_CLOCK,
    });

    void begin(controller, 1);
    await flush();
    alpha.fail(0, new Error("socket closed"));
    beta.fail(0, new Error("socket closed"));
    await flush();

    expect(controller.snapshot().phase).toBe("failed");
    expect(controller.snapshot().error).toEqual({
      code: "provider-unavailable",
      message: expect.any(String),
      recoverable: true,
    });
  });

  it("treats an answered no-route rejection as an answer, not an outage", async () => {
    const alpha = fakeProvider("alpha");
    const controller = buildController({
      providers: [alpha.provider],
      pipeline: identityPipeline().pipeline,
      now: FIXED_CLOCK,
    });

    void begin(controller, 1);
    await flush();
    alpha.fail(0, Object.assign(new Error("no route"), { code: "no-route" }));
    await flush();

    expect(controller.snapshot().error?.code).toBe("no-route");
    expect(controller.snapshot().error?.recoverable).toBe(false);
    expect(diagnosticFor(controller.snapshot(), "alpha")).toEqual({
      providerId: "alpha",
      outcome: "failed",
      candidateCount: 0,
      note: "rejection:no-route",
    });
  });

  it("surfaces a provider's answered constraint-conflict instead of flattening it into no-route", async () => {
    // 04 §18 / 06 §29: a constraint the rider can relax must not reach them as
    // "there is no legal route here", which reads as a fact about the world
    // rather than about their own avoid areas and points (OGV-D-235). The server
    // answers exactly this code when an avoid ring fences every candidate.
    const alpha = fakeProvider("alpha");
    const controller = buildController({
      providers: [alpha.provider],
      pipeline: identityPipeline().pipeline,
      now: FIXED_CLOCK,
    });

    void begin(controller, 1);
    await flush();
    alpha.fail(
      0,
      Object.assign(new Error("Your constraints leave no eligible route."), {
        code: "constraint-conflict",
      }),
    );
    await flush();

    expect(controller.snapshot().phase).toBe("failed");
    expect(controller.snapshot().error?.code).toBe("constraint-conflict");
    expect(controller.snapshot().error?.recoverable).toBe(true);
    // The provider's own code is still on its diagnostic: choosing one surfaced
    // code loses nothing about what each provider said.
    expect(diagnosticFor(controller.snapshot(), "alpha")).toEqual({
      providerId: "alpha",
      outcome: "failed",
      candidateCount: 0,
      note: "rejection:constraint-conflict",
    });
  });

  it("records a timeout outcome for an engine timeout", async () => {
    const alpha = fakeProvider("alpha");
    const controller = buildController({
      providers: [alpha.provider],
      pipeline: identityPipeline().pipeline,
      now: FIXED_CLOCK,
    });

    void begin(controller, 1);
    await flush();
    alpha.fail(0, Object.assign(new Error("timed out"), { code: "provider-timeout" }));
    await flush();

    expect(diagnosticFor(controller.snapshot(), "alpha")).toEqual({
      providerId: "alpha",
      outcome: "timeout",
      candidateCount: 0,
      note: "rejection:provider-timeout",
    });
    expect(controller.snapshot().error?.code).toBe("provider-unavailable");
  });

  it("fails with constraint-conflict when every candidate is ineligible", async () => {
    const alpha = fakeProvider("alpha");
    const pipeline = mappingPipeline(({ providerId, candidates }) =>
      candidates.map((_candidate, index) =>
        routeCandidate(`${providerId}-${index}`, providerId, {
          failures: ["active-avoid-area", "closure-blocking"],
        }),
      ),
    );
    const controller = buildController({
      providers: [alpha.provider],
      pipeline: pipeline.pipeline,
      now: FIXED_CLOCK,
    });

    void begin(controller, 1);
    await flush();
    alpha.settle(0, [rawCandidate("alpha")]);
    await flush();

    const failed = controller.snapshot();
    expect(failed.phase).toBe("failed");
    expect(failed.error?.code).toBe("constraint-conflict");
    expect(failed.error?.recoverable).toBe(true);
    expect(failed.error?.message).toContain("active-avoid-area");
    expect(failed.error?.message).toContain("closure-blocking");
    expect(failed.committedBundle).toBeNull();
  });

  it("loses only the failing provider's candidates and still reaches ready", async () => {
    const alpha = fakeProvider("alpha");
    const beta = fakeProvider("beta");
    const controller = buildController({
      providers: [alpha.provider, beta.provider],
      pipeline: identityPipeline().pipeline,
      now: FIXED_CLOCK,
    });

    void begin(controller, 1);
    await flush();
    alpha.settle(0, [rawCandidate("alpha")]);
    await flush();
    beta.fail(0, new Error("optional provider down"));
    await flush();

    const ready = controller.snapshot();
    expect(ready.phase).toBe("ready");
    expect(ready.error).toBeNull();
    expect(ready.selectedRouteId).toBe("alpha-0");
    expect(ready.diagnostics).toEqual([
      { providerId: "alpha", outcome: "ok", candidateCount: 1 },
      {
        providerId: "beta",
        outcome: "failed",
        candidateCount: 0,
        note: "rejection:unknown",
      },
    ]);
  });

  it("fails before querying any provider when the intent cannot form a request", async () => {
    const alpha = fakeProvider("alpha");
    const controller = buildController({
      providers: [alpha.provider],
      pipeline: identityPipeline().pipeline,
      now: FIXED_CLOCK,
    });

    const settled = begin(controller, 1, plannedIntent({ finish: null }));
    await flush();

    expect(controller.snapshot().phase).toBe("failed");
    expect(controller.snapshot().error?.code).toBe("constraint-conflict");
    expect(controller.snapshot().error?.recoverable).toBe(true);
    expect(controller.snapshot().error?.message).toContain("missing-finish");
    expect(alpha.calls).toEqual([]);
    await expect(settled).resolves.toBeUndefined();
  });

  it("keeps last-good across a failed revision", async () => {
    const alpha = fakeProvider("alpha");
    const controller = buildController({
      providers: [alpha.provider],
      pipeline: identityPipeline().pipeline,
      now: FIXED_CLOCK,
    });

    void begin(controller, 1);
    await flush();
    alpha.settle(0, [rawCandidate("alpha")]);
    await flush();
    const lastGood = controller.snapshot().lastGoodBundle;

    void begin(controller, 2);
    await flush();
    alpha.settle(1, []);
    await flush();

    const failed = controller.snapshot();
    expect(failed.phase).toBe("failed");
    expect(failed.committedBundle).toBeNull();
    expect(failed.lastGoodBundle).toBe(lastGood);
    expect(failed.selectedRouteId).toBe("alpha-0");
  });

  it("reports a normalization failure as a candidate loss, not a plan failure", async () => {
    const alpha = fakeProvider("alpha");
    const beta = fakeProvider("beta");
    let calls = 0;
    const pipeline: CandidatePipeline = {
      normalize({ providerId, candidates }): readonly RouteCandidate[] {
        calls += 1;
        if (providerId === "alpha") throw new Error("pipeline exploded");
        return candidates.map((_candidate, index) =>
          routeCandidate(`${providerId}-${index}`, providerId),
        );
      },
    };
    const controller = buildController({
      providers: [alpha.provider, beta.provider],
      pipeline,
      now: FIXED_CLOCK,
    });

    void begin(controller, 1);
    await flush();
    alpha.settle(0, [rawCandidate("alpha")]);
    beta.settle(0, [rawCandidate("beta")]);
    await flush();

    expect(calls).toBe(2);
    expect(controller.snapshot().phase).toBe("ready");
    expect(diagnosticFor(controller.snapshot(), "alpha")).toEqual({
      providerId: "alpha",
      outcome: "failed",
      candidateCount: 0,
      note: "normalization-failed",
    });
    expect(candidateIds(controller.snapshot())).toEqual(["beta-0"]);
  });
});

/* -------------------------------------------------------------------------
 * Diagnostics, request context and timing
 * ---------------------------------------------------------------------- */

describe("diagnostics", () => {
  it("keeps provider order and resets for a new attempt", async () => {
    const beta = fakeProvider("beta");
    const alpha = fakeProvider("alpha");
    const controller = buildController({
      providers: [beta.provider, alpha.provider],
      pipeline: identityPipeline().pipeline,
      now: FIXED_CLOCK,
    });

    void begin(controller, 1);
    await flush();
    alpha.fail(0, new Error("down"));
    beta.fail(0, new Error("down"));
    await flush();

    expect(controller.snapshot().diagnostics.map((entry) => entry.providerId)).toEqual([
      "beta",
      "alpha",
    ]);

    void begin(controller, 2);
    await flush();
    expect(controller.snapshot().diagnostics).toEqual([]);
  });

  it("notes unresolved avoid areas as a stable token and passes them to the pipeline", async () => {
    const alpha = fakeProvider("alpha");
    const avoidRef = asGeometryRef("geo_avoid_backroad");
    const pipeline = identityPipeline();
    const intent = plannedIntent({
      avoidAreas: [
        {
          id: "avoid_1" as AvoidAreaId,
          name: null,
          geometryRef: avoidRef,
          enabled: true,
          createdBy: "rider",
        },
      ],
    });
    const controller = buildController({
      providers: [alpha.provider],
      pipeline: pipeline.pipeline,
      resolveGeometry: () => null,
      now: FIXED_CLOCK,
    });

    void begin(controller, 1, intent);
    await flush();
    alpha.settle(0, [rawCandidate("alpha")]);
    await flush();

    expect(required(pipeline.calls[0]).unresolvedRefs).toEqual([avoidRef]);
    expect(required(pipeline.calls[0]).request.avoidPolygons).toEqual([]);
    expect(diagnosticFor(controller.snapshot(), "alpha").note).toBe("unresolved-avoid-areas");
  });

  it("records the planning identity on every pipeline call", async () => {
    const alpha = fakeProvider("alpha");
    const pipeline = identityPipeline();
    const controller = buildController({
      providers: [alpha.provider],
      pipeline: pipeline.pipeline,
      now: FIXED_CLOCK,
    });

    void begin(controller, 4);
    await flush();
    alpha.settle(0, [rawCandidate("alpha")]);
    await flush();

    const call = required(pipeline.calls[0]);
    expect(call.identity).toEqual({
      rideId: RIDE_ID,
      rideRevision: 4,
      planningGeneration: 1,
    });
    expect(call.versions).toEqual(VERSIONS);
    expect(call.providerId).toBe("alpha");
  });

  it("carries another ride's identity without sharing this session's state", async () => {
    const alpha = fakeProvider("alpha");
    const controller = buildController({
      providers: [alpha.provider],
      pipeline: identityPipeline().pipeline,
      now: FIXED_CLOCK,
    });

    void begin(controller, 1, plannedIntent(), OTHER_RIDE_ID);
    await flush();
    alpha.settle(0, [rawCandidate("alpha")]);
    await flush();

    expect(controller.snapshot().identity.rideId).toBe(OTHER_RIDE_ID);
    expect(controller.snapshot().committedBundle?.rideId).toBe(OTHER_RIDE_ID);
  });
});

describe("timing", () => {
  it("stamps startedAt on begin and settledAt on the terminal phase", async () => {
    const alpha = fakeProvider("alpha");
    const stamps = ["2026-09-17T00:00:00.000Z", "2026-09-17T00:00:01.000Z"];
    let index = 0;
    const controller = buildController({
      providers: [alpha.provider],
      pipeline: identityPipeline().pipeline,
      now: () => required(stamps[Math.min(index++, stamps.length - 1)]),
    });

    void begin(controller, 1);
    await flush();
    expect(controller.snapshot().startedAt).toBe(stamps[0]);
    expect(controller.snapshot().settledAt).toBeNull();

    alpha.settle(0, [rawCandidate("alpha")]);
    await flush();

    expect(controller.snapshot().settledAt).toBe(stamps[stamps.length - 1]);
  });
});

/* -------------------------------------------------------------------------
 * The placeholder pipeline (Wave 3 replaces it)
 * ---------------------------------------------------------------------- */

describe("stub pipeline", () => {
  it("lets a typed pipeline role seam override provider hints", async () => {
    const alpha = fakeProvider("alpha");
    let roleInput: CandidatePipelineRoleInput | null = null;
    const pipeline: CandidatePipeline = {
      normalize({ providerId, candidates }) {
        return candidates.map((_candidate, index) => routeCandidate(`${providerId}-${index}`, providerId));
      },
      assignRoles(input): RouteRoles {
        roleInput = input;
        const first = required(input.candidates[0]).id;
        const second = required(input.candidates[1]).id;
        return {
          "best-ride": second,
          fastest: first,
          "fast-and-fun": null,
          "more-twisties": null,
          "more-dirt": null,
          "lower-workload": null,
        };
      },
    };
    const controller = buildController({
      providers: [alpha.provider],
      pipeline,
      now: FIXED_CLOCK,
    });

    void begin(controller, 1);
    await flush();
    alpha.settle(0, [
      rawCandidate("alpha", { providerMetadata: { bestRide: true } }),
      rawCandidate("alpha", { providerMetadata: { fingerprint: "fp-second" } }),
    ]);
    await flush();

    const bundle = controller.snapshot().committedBundle;
    if (bundle === null) throw new Error("the test expected a committed bundle");
    if (roleInput === null) throw new Error("the test expected a role assignment");
    const seenRoleInput = roleInput as CandidatePipelineRoleInput;
    expect(bundle.roles["best-ride"]).toBe(bundle.candidates[1]?.id);
    expect(bundle.selectedRouteId).toBe(bundle.candidates[1]?.id);
    expect(seenRoleInput.identity.planningGeneration).toBe(1);
  });

  it("stores candidate geometry and marks eligibility and score as placeholders", async () => {
    const alpha = fakeProvider("alpha");
    const store = createMemoryGeometryStore();
    const controller = buildController({
      providers: [alpha.provider],
      geometryStore: store,
      now: FIXED_CLOCK,
    });

    void begin(controller, 1);
    await flush();
    alpha.settle(0, [
      rawCandidate("alpha", {
        providerMetadata: { fingerprint: "gh-1-fp" },
        instructions: [{
          text: "Turn left onto Ridge Pike",
          distanceMeters: 420,
          durationSeconds: 62,
          type: "turn",
          maneuver: "left",
          roadName: "Ridge Pike",
          geometryIndex: 1,
        }],
      }),
    ]);
    await flush();

    const bundle = controller.snapshot().committedBundle;
    const candidate = required(bundle?.candidates[0]);
    expect(candidate.fingerprint).toBe("gh-1-fp");
    expect(candidate.eligibility).toEqual({ eligible: true, failures: [] });
    expect(candidate.evidence).toEqual({});
    expect(candidate.score.policyVersion).toBe("unscored-stub");
    expect(candidate.instructionsRef).toBeUndefined();
    expect(candidate.instructions?.[0]).toMatchObject({ maneuver: "left", roadName: "Ridge Pike" });
    // No provider hint names a best ride; the one eligible candidate is fastest.
    expect(bundle?.roles).toEqual({
      "best-ride": null,
      fastest: candidate.id,
      "fast-and-fun": null,
      "more-twisties": null,
      "more-dirt": null,
      "lower-workload": null,
    });

    const record = await store.get(candidate.geometryRef);
    expect(record?.kind).toBe("route");
    expect(record?.payload).toEqual({
      kind: "line",
      coordinates: CANDIDATE_GEOMETRY,
    });
  });

  it("falls back to a deterministic fingerprint when the provider has none", async () => {
    const alpha = fakeProvider("alpha");
    const controller = buildController({
      providers: [alpha.provider],
      geometryStore: createMemoryGeometryStore(),
      now: FIXED_CLOCK,
    });

    void begin(controller, 1);
    await flush();
    alpha.settle(0, [rawCandidate("alpha")]);
    await flush();

    const candidate = required(
      controller.snapshot().committedBundle?.candidates[0],
    );
    expect(candidate.fingerprint).toBe("alpha:motorcycle_fastest:0:3:48000");
    expect(candidate.geometryRef).toMatch(/^geo_/);
    expect(candidate.id).toMatch(/^route_/);
    expect(candidate.provider).toEqual({
      providerId: "alpha",
      profile: "motorcycle_fastest",
    });
  });
});

/* -------------------------------------------------------------------------
 * Disposal
 * ---------------------------------------------------------------------- */

describe("dispose", () => {
  it("aborts in-flight work and refuses further commands", async () => {
    const alpha = fakeProvider("alpha");
    const updates: PlanningSessionSnapshot[] = [];
    const controller = buildController({
      providers: [alpha.provider],
      pipeline: identityPipeline().pipeline,
      now: FIXED_CLOCK,
      onUpdate: (snapshot) => updates.push(snapshot),
    });

    const settled = begin(controller, 1);
    await flush();
    const updatesBefore = updates.length;

    controller.dispose();

    expect(callAt(alpha, 0).signal.aborted).toBe(true);
    await expect(settled).resolves.toBeUndefined();

    const disposed = controller.snapshot();
    expect(disposed.phase).toBe("routing-primary");
    expect(updates).toHaveLength(updatesBefore);

    alpha.settle(0, [rawCandidate("alpha")]);
    await flush();
    expect(controller.snapshot()).toEqual(disposed);

    void begin(controller, 2);
    await flush();
    expect(alpha.calls).toHaveLength(1);
    expect(controller.snapshot()).toEqual(disposed);

    controller.cancel();
    controller.selectRoute(asRouteCandidateId("alpha-0"));
    expect(controller.snapshot()).toEqual(disposed);
  });

  it("is idempotent", async () => {
    const alpha = fakeProvider("alpha");
    const controller = buildController({
      providers: [alpha.provider],
      pipeline: identityPipeline().pipeline,
      now: FIXED_CLOCK,
    });

    void begin(controller, 1);
    await flush();

    controller.dispose();
    const disposed = controller.snapshot();
    controller.dispose();

    expect(controller.snapshot()).toEqual(disposed);
  });
});
