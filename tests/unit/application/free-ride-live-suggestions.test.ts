import { describe, expect, it, vi } from "vitest";
import { deriveLiveSuggestionWorkload, evaluateLiveSuggestion, type LiveSuggestionCandidate } from "@/application/free-ride/live-suggestions";
import { knownEvidence, unknownEvidence } from "@/domain/evidence/types";
import type { SessionNavigationState } from "@/domain/ride-session/navigation";
import { asRouteCandidateId } from "@/domain/route/ids";

const navigation = (overrides: Partial<SessionNavigationState> = {}): SessionNavigationState => ({
  sessionId: "session_test" as SessionNavigationState["sessionId"], activity: "free", resumeActivity: null,
  startedAt: "2026-09-22T12:00:00Z", endedAt: null, endReason: null,
  plan: { rideId: "ride_test" as SessionNavigationState["plan"]["rideId"], rideRevision: 1, route: null },
  recordingId: null, aheadGuidanceSuspended: false, instruction: null, offRouteState: null,
  nextStopId: null, completedStopIds: [], remainingStopIds: [],
  position: { coordinate: { lon: -77, lat: 40 }, observedAt: "2026-09-22T12:00:09Z", ageMs: 1000,
    accuracyMeters: 8, headingDegrees: 20, speedMps: 12, quality: "fresh-good" }, ...overrides,
});
const candidate = (id: string, headingDeltaDegrees = 20, requiresUTurn = false): LiveSuggestionCandidate =>
  ({ id, label: "Suggested road", distanceToDecisionMeters: 500, distanceMeters: 1_200, headingDeltaDegrees, requiresUTurn, entry: { lon: -77.01, lat: 40.01 }, route: {
    planningGeneration: 1, routeId: asRouteCandidateId(`route_${id}`),
  } });
const deps = (items: readonly LiveSuggestionCandidate[]) => ({
  port: { propose: vi.fn(async () => items) },
  evidence: { assess: vi.fn(async (item: LiveSuggestionCandidate) => ({
    roadCharacterFit: knownEvidence(Number(item.id === "alpha" || item.id === "beta" ? 0.8 : 0.4), { id: "roads", label: "Road fit", category: "derived" }),
    surfaceFit: unknownEvidence<number>("not measured"), novelty: unknownEvidence<number>("not measured"),
  })) },
  policy: { minimumMovingSpeedMps: 2, maximumAheadDeltaDegrees: 75, cooldownMs: 120_000 },
});
const workload = knownEvidence("normal" as const, { id: "workload", label: "Workload", category: "derived" });

describe("evaluateLiveSuggestion", () => {
  it("derives usable workload only from a fresh GPS speed band", () => {
    expect(deriveLiveSuggestionWorkload(navigation()).value).toBe("normal");
    expect(deriveLiveSuggestionWorkload(navigation({ position: { ...navigation().position, speedMps: 25 } })).value).toBe("high");
    expect(deriveLiveSuggestionWorkload(navigation({ position: { ...navigation().position, speedMps: null } })).status).toBe("unknown");
  });
  it("stays quiet without fresh-good GPS", async () => {
    const d = deps([candidate("road")]);
    const result = await evaluateLiveSuggestion({ navigation: navigation({ position: { ...navigation().position, quality: "stale", headingDegrees: null, speedMps: null } }), workload, now: "2026-09-22T12:00:10Z", lastSuggestionAt: null }, d, new AbortController().signal);
    expect(result).toEqual({ status: "quiet", reason: "gps" }); expect(d.port.propose).not.toHaveBeenCalled();
  });
  it("treats unknown workload as quiet", async () => {
    const d = deps([candidate("road")]);
    expect(await evaluateLiveSuggestion({ navigation: navigation(), workload: unknownEvidence("not measurable"), now: "2026-09-22T12:00:10Z", lastSuggestionAt: null }, d, new AbortController().signal)).toEqual({ status: "quiet", reason: "workload" });
  });
  it("still suggests at high workload: speed trims the screen, not a short helmet cue (COPILOT §7)", async () => {
    const high = knownEvidence("high" as const, { id: "workload", label: "Workload", category: "derived" });
    const result = await evaluateLiveSuggestion({ navigation: navigation(), workload: high, now: "2026-09-22T12:03:00Z", lastSuggestionAt: null }, deps([candidate("alpha")]), new AbortController().signal);
    expect(result).toMatchObject({ status: "suggestion", suggestion: { id: "alpha" } });
  });
  it("requires actual movement", async () => {
    expect((await evaluateLiveSuggestion({ navigation: navigation({ position: { ...navigation().position, speedMps: 0 } }), workload, now: "2026-09-22T12:00:10Z", lastSuggestionAt: null }, deps([]), new AbortController().signal))).toMatchObject({ reason: "not-moving" });
  });
  it("enforces cooldown before querying", async () => {
    const d = deps([candidate("road")]);
    expect((await evaluateLiveSuggestion({ navigation: navigation(), workload, now: "2026-09-22T12:01:00Z", lastSuggestionAt: "2026-09-22T12:00:00Z" }, d, new AbortController().signal))).toMatchObject({ reason: "cooldown" });
    expect(d.port.propose).not.toHaveBeenCalled();
  });
  it("rejects U-turn and behind candidates and returns one deterministic best", async () => {
    const result = await evaluateLiveSuggestion({ navigation: navigation(), workload, now: "2026-09-22T12:03:00Z", lastSuggestionAt: null }, deps([candidate("uturn", 10, true), candidate("behind", 150), candidate("beta"), candidate("alpha")]), new AbortController().signal);
    expect(result).toMatchObject({ status: "suggestion", suggestion: { id: "alpha" } });
  });
  it("propagates cancellation", async () => {
    const controller = new AbortController(); const reason = new DOMException("stop", "AbortError");
    const port = { propose: vi.fn(async (_input: unknown, signal: AbortSignal) => new Promise<readonly LiveSuggestionCandidate[]>((_, reject) => signal.addEventListener("abort", () => reject(signal.reason), { once: true }))) };
    const pending = evaluateLiveSuggestion({ navigation: navigation(), workload, now: "2026-09-22T12:03:00Z", lastSuggestionAt: null }, { port, evidence: deps([]).evidence, policy: deps([]).policy }, controller.signal);
    controller.abort(reason); await expect(pending).rejects.toBe(reason);
  });
});
