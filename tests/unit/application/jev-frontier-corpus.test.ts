import { expect, it } from "vitest";
import { freezeJevFrontierCorpusCase } from "@/application/planner/jev-frontier-corpus";
import { frontierState } from "../../helpers/jev-frontier";
import { validateJevReplayCase } from "@/application/planner/jev-frontier-replay";

it("freezes only exact-selector survivors with contiguous ranks and immutable fingerprints", () => {
  const state = frontierState();
  const result = freezeJevFrontierCorpusCase({
    caseId: "corpus-1",
    corridorKey: "corridor-1",
    rideSessionKey: "session-1",
    intent: state.intent,
    rider: null,
    candidates: state.candidates.map((c) => ({
      candidate: c,
      eligible: true,
      fingerprint: `fp-${c.id}`,
    })),
    maxResults: 2,
  });
  expect(result).not.toBeNull();
  expect(validateJevReplayCase(result)).toBe(true);
  expect(result!.state.candidates).toHaveLength(2);
  expect(result!.state.candidates.map((c) => c.canonicalRank).sort()).toEqual([
    1, 2,
  ]);
  expect(Object.isFrozen(result!.state.candidates)).toBe(true);
});
it("never resurrects an ineligible candidate or invents a two-route shortlist", () => {
  const state = frontierState(2);
  expect(
    freezeJevFrontierCorpusCase({
      caseId: "c",
      corridorKey: "c",
      rideSessionKey: "s",
      intent: state.intent,
      rider: null,
      candidates: state.candidates.map((c, i) => ({
        candidate: c,
        eligible: i === 0,
        fingerprint: `fp-${c.id}`,
      })),
      maxResults: 3,
    }),
  ).toBeNull();
});
it("preserves unknown coherence counts instead of inventing zero", () => {
  const state = frontierState(2);
  const result = freezeJevFrontierCorpusCase({
    caseId: "c",
    corridorKey: "c",
    rideSessionKey: "s",
    intent: state.intent,
    rider: null,
    candidates: state.candidates.map((c) => ({
      candidate: {
        ...c,
        coherence: {
          ...c.coherence,
          explicitUTurns: null,
          geometryReversals: null,
        },
      },
      eligible: true,
      fingerprint: `fp-${c.id}`,
    })),
    maxResults: 3,
  });
  expect(result?.state.candidates[0]?.coherence.geometryReversals).toBeNull();
});

it("requires an independently frozen rider forecast when a posterior is supplied", () => {
  const state = frontierState(2);
  const rider = {
    mean: { curvature: 1 },
    precision: { curvature: 2 },
    evidence: { curvature: 3 },
    explicitComparisons: 3,
    implicitComparisons: 0,
  };
  const base = {
    caseId: "c",
    corridorKey: "c",
    rideSessionKey: "s",
    intent: state.intent,
    rider,
    candidates: state.candidates.map((c) => ({
      candidate: c,
      eligible: true,
      fingerprint: `fp-${c.id}`,
    })),
    maxResults: 2 as const,
  };
  expect(freezeJevFrontierCorpusCase(base)).toBeNull();
  const result = freezeJevFrontierCorpusCase({
    ...base,
    control: {
      source: "rider-posterior",
      choiceCandidateId: "route-2",
      probabilitiesByCandidateId: { "route-1": 0.3, "route-2": 0.7 },
    },
  } as never);
  expect(result?.control).toMatchObject({
    source: "rider-posterior",
    choiceCandidateId: "route-2",
    probabilitiesByCandidateId: { "route-1": 0.3, "route-2": 0.7 },
  });
});
