/** Caller-measured, eligibility-approved corpus pool -> current exact selector -> frozen replay. */
import { deepFreeze } from "@/domain/util/freeze";
import {
  DEFAULT_FRONTIER_PREFERENCE_PROFILES,
  selectLowRegretRepresentatives,
} from "./frontier-routing";
import {
  isJevFrontierCandidateState,
  type JevFrontierCandidateState,
  type JevFrontierIntentState,
  type JevFrontierRiderState,
} from "./jev-frontier-shadow";
import {
  validateJevReplayCase,
  type JevReplayCase,
  type JevReplayControl,
} from "./jev-frontier-replay";

export function freezeJevFrontierCorpusCase(input: {
  readonly caseId: string;
  readonly corridorKey: string;
  readonly rideSessionKey: string;
  readonly intent: JevFrontierIntentState;
  readonly rider: JevFrontierRiderState | null;
  /** Independently frozen rider forecast over the selected subset, when available. */
  readonly control?: JevReplayControl;
  readonly candidates: readonly {
    readonly candidate: JevFrontierCandidateState;
    readonly eligible: boolean;
    readonly fingerprint: string;
  }[];
  readonly maxResults: 2 | 3;
}): JevReplayCase | null {
  if (
    input.candidates.length > 6 ||
    ![2, 3].includes(input.maxResults) ||
    (input.rider !== null && input.control?.source !== "rider-posterior")
  )
    return null;
  const eligible = input.candidates.filter((c) => c.eligible === true);
  if (
    eligible.length < 2 ||
    !eligible.every((c) => isJevFrontierCandidateState(c.candidate)) ||
    new Set(eligible.map((c) => c.candidate.id)).size !== eligible.length
  )
    return null;
  const selected = selectLowRegretRepresentatives(
    eligible.map((c) => ({
      id: c.candidate.id,
      quality: c.candidate.frontier,
      payload: c,
    })),
    DEFAULT_FRONTIER_PREFERENCE_PROFILES,
    input.maxResults,
  );
  if (selected.length < 2) return null;
  const ranked = selected
    .map((c) => c.payload!)
    .sort((a, b) => a.candidate.canonicalRank - b.candidate.canonicalRank);
  const candidates = ranked.map((c, i) => ({
    ...c.candidate,
    canonicalRank: i + 1,
  }));
  const baseline = candidates[0]!.id;
  const entry: JevReplayCase = {
    schemaVersion: 1,
    caseId: input.caseId,
    corridorKey: input.corridorKey,
    rideSessionKey: input.rideSessionKey,
    selector: "exact-bounded-regret-v1",
    fingerprints: Object.fromEntries(
      ranked.map((c) => [c.candidate.id, c.fingerprint]),
    ),
    state: {
      schemaVersion: 1,
      intent: input.intent,
      rider: input.rider,
      candidates,
      deterministicBaselineId: baseline,
    },
    control: input.control ?? {
      source: "deterministic-baseline",
      choiceCandidateId: baseline,
      probabilitiesByCandidateId: Object.fromEntries(
        candidates.map((c) => [c.id, Number(c.id === baseline)]),
      ),
    },
  };
  return validateJevReplayCase(entry)
    ? deepFreeze(JSON.parse(JSON.stringify(entry)) as JevReplayCase)
    : null;
}
