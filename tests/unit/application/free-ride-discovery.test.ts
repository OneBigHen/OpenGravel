import { describe, expect, it, vi } from "vitest";

import {
  discoverFreeRideLoops,
  type FreeRideCandidateEvidence,
  type FreeRideDiscoveryDeps,
  type FreeRideDiscoveryInput,
  type FreeRideEvidencePort,
} from "@/application/free-ride/discovery";
import { createMemoryGeometryStore } from "@/application/geometry/memory-geometry-store";
import type {
  ProviderCandidate,
  ProviderRouteRequest,
  RouteCandidateProvider,
} from "@/application/planner/route-provider";
import { knownEvidence, unknownEvidence } from "@/domain/evidence/types";
import type { Coordinate } from "@/domain/ride/types";

const ORIGIN: Coordinate = { lon: -77.1, lat: 40.1 };
const SOURCE = {
  id: "fixture-road-evidence",
  label: "Fixture road evidence",
  category: "derived",
} as const;

const INPUT: FreeRideDiscoveryInput = {
  discoveryId: "discovery-1",
  origin: knownEvidence(ORIGIN, {
    id: "current-position",
    label: "Current reliable position",
    category: "rider",
  }, 0.95),
  timeBudget: { targetMinutes: 60, toleranceMinutes: 5 },
  departure: { kind: "now" },
  roadCharacter: "curvy",
  surface: {
    preference: "mixed",
    unknownSurfacePolicy: "allow-with-warning",
  },
  terrain: { level: "moderate" },
  bike: {
    bikeId: "bike-1",
    category: "adventure",
    fuelRangeMiles: 180,
    reserveMiles: 30,
    maintainedGravel: "allow",
    roughTracks: "avoid",
    unknownSurface: "allow-with-warning",
  },
  noveltyPreference: "prefer-new-to-me",
  weatherPreference: "avoid-adverse",
};

function loop(
  fingerprint: string,
  durationMinutes: number,
  offset: number,
): ProviderCandidate {
  return {
    providerId: "fixture-router",
    profile: "motorcycle_fastest",
    geometry: [
      ORIGIN,
      { lon: ORIGIN.lon + 0.08, lat: ORIGIN.lat + offset },
      { lon: ORIGIN.lon - 0.05, lat: ORIGIN.lat + 0.08 + offset },
      ORIGIN,
    ],
    distanceMeters: 45_000 + offset * 100_000,
    durationSeconds: durationMinutes * 60,
    providerMetadata: { fingerprint },
  };
}

function provider(
  candidates:
    | readonly ProviderCandidate[]
    | ((request: ProviderRouteRequest, signal: AbortSignal) => Promise<readonly ProviderCandidate[]>),
): RouteCandidateProvider {
  return {
    id: "fixture-router",
    capabilities: () => ({
      profiles: ["motorcycle_fastest"],
      supportsAlternatives: true,
      supportsAvoidPolygons: true,
    }),
    candidates: async (request, signal) => ({
      candidates: typeof candidates === "function"
        ? await candidates(request, signal)
        : candidates,
    }),
  };
}

const EMPTY_EVIDENCE: FreeRideEvidencePort = {
  assess: async () => ({}),
};

function discoveryDeps(
  candidateProvider: RouteCandidateProvider,
  evidence: FreeRideEvidencePort = EMPTY_EVIDENCE,
): FreeRideDiscoveryDeps {
  return {
    provider: candidateProvider,
    evidence,
    geometryStore: createMemoryGeometryStore(),
  };
}

function knownCandidateEvidence(
  overrides: Partial<FreeRideCandidateEvidence> = {},
): FreeRideCandidateEvidence {
  return {
    surfaceFit: knownEvidence(0.8, SOURCE, 0.9),
    terrainCompatibility: knownEvidence(true, SOURCE, 0.9),
    bikeCompatibility: knownEvidence(true, SOURCE, 0.9),
    roadCharacterFit: knownEvidence(0.8, SOURCE, 0.9),
    novelty: knownEvidence(0.7, SOURCE, 0.8),
    weatherSuitability: knownEvidence(0.9, SOURCE, 0.75),
    ...overrides,
  };
}

describe("discoverFreeRideLoops", () => {
  it("returns an explicit unknown state without calling a provider when no reliable origin exists", async () => {
    const candidateProvider = provider([loop("unused", 60, 0)]);
    const candidatesSpy = vi.spyOn(candidateProvider, "candidates");

    const result = await discoverFreeRideLoops(
      { ...INPUT, origin: unknownEvidence("GPS is not reliable") },
      discoveryDeps(candidateProvider),
      new AbortController().signal,
    );

    expect(result).toMatchObject({
      status: "origin-unknown",
      proposals: [],
      selectedProposalId: null,
    });
    expect(candidatesSpy).not.toHaveBeenCalled();
  });

  it("returns an explicit empty state when no usable candidate survives", async () => {
    const result = await discoverFreeRideLoops(
      INPUT,
      discoveryDeps(provider([])),
      new AbortController().signal,
    );

    expect(result.status).toBe("empty");
    expect(result.proposals).toEqual([]);
    expect(result.selectedProposalId).toBeNull();
    expect(result.diagnostics.some(
      (entry) => "code" in entry && entry.code === "empty-candidate-set",
    )).toBe(true);
  });

  it("selects a loop inside the timebox when one exists and labels every proposal truthfully", async () => {
    const result = await discoverFreeRideLoops(
      INPUT,
      discoveryDeps(
        provider([loop("mismatch", 82, 0.18), loop("match", 63, 0)]),
        { assess: async () => knownCandidateEvidence() },
      ),
      new AbortController().signal,
    );

    expect(result.status).toBe("ready");
    if (result.status !== "ready") return;
    const selected = result.proposals.find((proposal) => proposal.id === result.selectedProposalId);
    expect(selected?.fingerprint).toBe("match");
    expect(selected?.timebox).toMatchObject({ status: "matched", differenceMinutes: 3 });
    expect(result.proposals.find((proposal) => proposal.fingerprint === "mismatch")?.timebox)
      .toMatchObject({ status: "mismatch", differenceMinutes: 22 });
  });

  it("selects the closest valid loop and labels the mismatch when no loop fits", async () => {
    const result = await discoverFreeRideLoops(
      INPUT,
      discoveryDeps(
        provider([loop("far", 95, 0.18), loop("closest", 72, 0)]),
        { assess: async () => knownCandidateEvidence() },
      ),
      new AbortController().signal,
    );

    expect(result.status).toBe("ready");
    if (result.status !== "ready") return;
    const selected = result.proposals.find((proposal) => proposal.id === result.selectedProposalId);
    expect(selected?.fingerprint).toBe("closest");
    expect(selected?.timebox).toMatchObject({ status: "mismatch", differenceMinutes: 12 });
  });

  it("preserves the only timebox match through the three-result diversity cap", async () => {
    const result = await discoverFreeRideLoops(
      INPUT,
      discoveryDeps(
        provider([
          loop("high-score-1", 90, 0),
          loop("high-score-2", 95, 0.2),
          loop("high-score-3", 100, 0.4),
          loop("only-match", 60, 0.6),
        ]),
        {
          assess: async (candidate) => candidate.providerMetadata?.["fingerprint"] === "only-match"
            ? knownCandidateEvidence({
                surfaceFit: knownEvidence(0, SOURCE, 0.9),
                roadCharacterFit: knownEvidence(0, SOURCE, 0.9),
                novelty: knownEvidence(0, SOURCE, 0.9),
              })
            : knownCandidateEvidence({
                surfaceFit: knownEvidence(1, SOURCE, 0.9),
                roadCharacterFit: knownEvidence(1, SOURCE, 0.9),
                novelty: knownEvidence(1, SOURCE, 0.9),
              }),
        },
      ),
      new AbortController().signal,
    );

    expect(result.proposals).toHaveLength(3);
    expect(result.proposals.find((entry) => entry.id === result.selectedProposalId)?.fingerprint)
      .toBe("only-match");
  });

  it("returns no more than three materially distinct loops", async () => {
    const duplicate = loop("duplicate", 61, 0);
    const result = await discoverFreeRideLoops(
      INPUT,
      discoveryDeps(
        provider([
          loop("one", 60, 0),
          duplicate,
          loop("two", 62, 0.2),
          loop("three", 64, 0.4),
          loop("four", 66, 0.6),
        ]),
        { assess: async () => knownCandidateEvidence() },
      ),
      new AbortController().signal,
    );

    expect(result.proposals).toHaveLength(3);
    expect(result.proposals.map((proposal) => proposal.fingerprint)).not.toContain("duplicate");
  });

  it("stores proposal geometry behind stable handles", async () => {
    const geometryStore = createMemoryGeometryStore();
    const candidate = loop("stored", 60, 0);
    const result = await discoverFreeRideLoops(
      INPUT,
      {
        provider: provider([candidate]),
        evidence: EMPTY_EVIDENCE,
        geometryStore,
      },
      new AbortController().signal,
    );

    const geometryRef = result.proposals[0]?.geometryRef;
    expect(geometryRef).toMatch(/^geo_/);
    if (geometryRef === undefined) return;
    const stored = await geometryStore.get(geometryRef);
    expect(stored?.payload).toEqual({ kind: "line", coordinates: candidate.geometry });
  });

  it("degrades an optional evidence outage without hiding it or failing discovery", async () => {
    const result = await discoverFreeRideLoops(
      INPUT,
      discoveryDeps(provider([loop("route-without-evidence", 60, 0)]), {
        assess: async () => {
          throw new Error("evidence adapter offline");
        },
      }),
      new AbortController().signal,
    );

    expect(result.status).toBe("ready");
    expect(result.proposals[0]?.facts.weatherSuitability.status).toBe("unavailable");
    expect(result.diagnostics).toEqual(expect.arrayContaining([
      expect.objectContaining({ stage: "evidence", code: "evidence-unavailable" }),
    ]));
  });

  it("labels unknown surface as unverifiable under a conservative surface policy", async () => {
    const result = await discoverFreeRideLoops(
      {
        ...INPUT,
        surface: {
          ...INPUT.surface,
          unknownSurfacePolicy: "avoid-when-possible",
          targetUnpavedShare: { target: 0.4 },
        },
      },
      discoveryDeps(provider([loop("unknown-surface", 60, 0)])),
      new AbortController().signal,
    );

    expect(result.proposals[0]?.facts.surfaceFit.status).toBe("unknown");
    expect(result.proposals[0]?.warnings.map((warning) => warning.code))
      .toContain("surface-evidence-unverifiable");
  });

  it("flows surface, bike, road character, terrain, novelty, departure, and weather into eligibility evidence", async () => {
    const seen: unknown[] = [];
    const evidence: FreeRideEvidencePort = {
      assess: async (candidate, context) => {
        seen.push(context);
        return knownCandidateEvidence(
          candidate.providerMetadata?.["fingerprint"] === "bike-incompatible"
            ? { bikeCompatibility: knownEvidence(false, SOURCE, 0.95) }
            : {
                surfaceFit: knownEvidence(0.2, SOURCE, 0.9),
                roadCharacterFit: knownEvidence(0.3, SOURCE, 0.9),
              },
        );
      },
    };

    const result = await discoverFreeRideLoops(
      INPUT,
      discoveryDeps(
        provider([
          loop("bike-incompatible", 60, 0.2),
          loop("eligible-with-warnings", 62, 0),
        ]),
        evidence,
      ),
      new AbortController().signal,
    );

    expect(seen).toHaveLength(2);
    expect(seen[0]).toMatchObject({
      departure: INPUT.departure,
      roadCharacter: INPUT.roadCharacter,
      surface: INPUT.surface,
      terrain: INPUT.terrain,
      bike: INPUT.bike,
      noveltyPreference: INPUT.noveltyPreference,
      weatherPreference: INPUT.weatherPreference,
    });
    expect(result.proposals.map((proposal) => proposal.fingerprint)).toEqual([
      "eligible-with-warnings",
    ]);
    expect(result.proposals[0]?.warnings.map((warning) => warning.code)).toEqual(
      expect.arrayContaining(["surface-preference-mismatch", "road-character-mismatch"]),
    );
    expect(result.diagnostics.some(
      (entry) => "eligibilityCode" in entry && entry.eligibilityCode === "bike-incompatible",
    ))
      .toBe(true);
  });

  it("keeps ordering and best selection deterministic for identical provider answers", async () => {
    const candidates = [loop("alpha", 70, 0.2), loop("beta", 61, 0), loop("gamma", 64, 0.4)];
    const deps = discoveryDeps(
      provider(candidates),
      { assess: async () => knownCandidateEvidence() },
    );

    const first = await discoverFreeRideLoops(INPUT, deps, new AbortController().signal);
    const second = await discoverFreeRideLoops(INPUT, deps, new AbortController().signal);

    expect(second.proposals.map((entry) => entry.fingerprint))
      .toEqual(first.proposals.map((entry) => entry.fingerprint));
    expect(second.selectedProposalId).toBe(first.selectedProposalId);
  });

  it("applies novelty preference only to usable personal-history evidence", async () => {
    const candidates = [loop("unridden", 60, 0), loop("familiar", 60, 0.3)];
    const evidence: FreeRideEvidencePort = {
      assess: async (candidate) => knownCandidateEvidence({
        novelty: knownEvidence(
          candidate.providerMetadata?.["fingerprint"] === "unridden" ? 0.95 : 0.05,
          SOURCE,
          0.9,
        ),
      }),
    };

    const newToMe = await discoverFreeRideLoops(
      INPUT,
      discoveryDeps(provider(candidates), evidence),
      new AbortController().signal,
    );
    const familiar = await discoverFreeRideLoops(
      { ...INPUT, noveltyPreference: "prefer-familiar" },
      discoveryDeps(provider(candidates), evidence),
      new AbortController().signal,
    );

    const newUnridden = newToMe.proposals.find((entry) => entry.fingerprint === "unridden");
    const newFamiliar = newToMe.proposals.find((entry) => entry.fingerprint === "familiar");
    expect(newUnridden?.score.components.novelty.contribution)
      .toBeGreaterThan(newFamiliar?.score.components.novelty.contribution ?? -1);
    const familiarUnridden = familiar.proposals.find((entry) => entry.fingerprint === "unridden");
    const familiarKnown = familiar.proposals.find((entry) => entry.fingerprint === "familiar");
    expect(familiarKnown?.score.components.novelty.contribution)
      .toBeGreaterThan(familiarUnridden?.score.components.novelty.contribution ?? -1);
    expect(familiar.proposals.find((entry) => entry.fingerprint === "familiar")?.evidence.novelty)
      .toMatchObject({ value: 0.05, status: "known" });
  });

  it("keeps missing surface, terrain, bike, road, novelty, and weather evidence unknown", async () => {
    const result = await discoverFreeRideLoops(
      INPUT,
      discoveryDeps(provider([loop("unknown", 60, 0)])),
      new AbortController().signal,
    );

    expect(result.status).toBe("ready");
    if (result.status !== "ready") return;
    for (const fact of Object.values(result.proposals[0]?.facts ?? {})) {
      expect(fact).toMatchObject({ value: null, status: "unknown", confidence: null });
      expect(fact.provenance).toEqual([]);
    }
  });

  it("propagates caller cancellation without converting AbortError into an empty result", async () => {
    const controller = new AbortController();
    const reason = new DOMException("cancelled by caller", "AbortError");
    const candidateProvider = provider((_request, signal) => new Promise((_, reject) => {
      signal.addEventListener("abort", () => reject(signal.reason), { once: true });
    }));

    const pending = discoverFreeRideLoops(
      INPUT,
      discoveryDeps(candidateProvider),
      controller.signal,
    );
    controller.abort(reason);

    await expect(pending).rejects.toBe(reason);
  });

  it("propagates cancellation while candidate evidence is loading", async () => {
    const controller = new AbortController();
    const reason = new DOMException("cancelled during evidence", "AbortError");
    const pending = discoverFreeRideLoops(
      INPUT,
      discoveryDeps(provider([loop("waiting", 60, 0)]), {
        assess: async (_candidate, _context, signal) => new Promise((_, reject) => {
          signal.addEventListener("abort", () => reject(signal.reason), { once: true });
        }),
      }),
      controller.signal,
    );
    await Promise.resolve();
    controller.abort(reason);

    await expect(pending).rejects.toBe(reason);
  });
});
