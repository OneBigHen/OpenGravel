/**
 * Bounded corridor-prize beam search for time-boxed motorcycle loops.
 *
 * This is intentionally not a general Arc Orienteering solver. It selects only
 * a handful of promising ordered corridor sequences before any expensive
 * provider routing call is made.
 *
 * Each prize carries a 0..1 search utility density plus an estimated traversal
 * time. Accumulated value is utility * corridor seconds, which approximates the
 * "worthwhile minutes" OpenGravel wants to maximize without rewarding a tiny
 * high-score fragment as much as a sustained good road.
 *
 * Connector costs are caller-supplied estimates. GraphHopper remains the
 * authority for the actual route, legality/access evidence remains canonical,
 * and the returned route must be measured again after routing.
 */

import type { Coordinate } from "@/domain/ride/types";

export interface CorridorPrize {
  readonly id: string;
  readonly entry: Coordinate;
  readonly exit: Coordinate;
  /** Estimated time spent traversing the corridor itself. */
  readonly traversalSeconds: number;
  /** Search utility density in [0, 1], never a canonical route score. */
  readonly utility: number;
  /**
   * Corridors from the same source/window family may share a group id. At most
   * one prize from a group is collected in one loop.
   */
  readonly groupId?: string;
}

export interface CorridorPrizeBeamOptions {
  readonly maxPrizes?: number;
  readonly beamWidth?: number;
  readonly maxResults?: number;
  /**
   * Maximum share of the estimated loop spent merely connecting prizes and
   * returning home. This prevents the search from collecting distant prizes at
   * any cost.
   */
  readonly maxConnectorShare?: number;
  /** Ignore weak catalogue hints before beam expansion. */
  readonly minimumPrizeUtility?: number;
}

export interface CorridorPrizeSequence {
  readonly prizeIds: readonly string[];
  readonly anchors: readonly Coordinate[];
  readonly estimatedSeconds: number;
  readonly connectorSeconds: number;
  readonly corridorSeconds: number;
  readonly returnSeconds: number;
  /** Sum of utility-density * traversal seconds. */
  readonly collectedValueSeconds: number;
  readonly averageCorridorUtility: number;
  readonly connectorShare: number;
  readonly budgetUtilization: number;
}

export type ConnectorTimeEstimator = (
  from: Coordinate,
  to: Coordinate,
) => number | null;

interface ResolvedOptions {
  readonly maxPrizes: number;
  readonly beamWidth: number;
  readonly maxResults: number;
  readonly maxConnectorShare: number;
  readonly minimumPrizeUtility: number;
}

interface BeamState {
  readonly prizes: readonly CorridorPrize[];
  readonly elapsedBeforeReturnSeconds: number;
  readonly connectorSeconds: number;
  readonly corridorSeconds: number;
  readonly collectedValueSeconds: number;
}

interface CompletedState {
  readonly state: BeamState;
  readonly returnSeconds: number;
  readonly totalSeconds: number;
  readonly connectorShare: number;
}

const DEFAULT_MAX_PRIZES = 3;
const DEFAULT_BEAM_WIDTH = 8;
const DEFAULT_MAX_RESULTS = 4;
const DEFAULT_MAX_CONNECTOR_SHARE = 0.45;
const DEFAULT_MINIMUM_PRIZE_UTILITY = 0.35;

const MAX_CONFIGURED_PRIZES = 5;
const MAX_CONFIGURED_BEAM_WIDTH = 32;
const MAX_CONFIGURED_RESULTS = 8;
const EPSILON = 1e-9;

function validCoordinate(point: Coordinate): boolean {
  return (
    Number.isFinite(point.lon) &&
    Math.abs(point.lon) <= 180 &&
    Number.isFinite(point.lat) &&
    Math.abs(point.lat) <= 90
  );
}

function validPrize(prize: CorridorPrize): boolean {
  return (
    prize.id.trim().length > 0 &&
    validCoordinate(prize.entry) &&
    validCoordinate(prize.exit) &&
    Number.isFinite(prize.traversalSeconds) &&
    prize.traversalSeconds > 0 &&
    Number.isFinite(prize.utility) &&
    prize.utility >= 0 &&
    prize.utility <= 1 &&
    (prize.groupId === undefined || prize.groupId.trim().length > 0)
  );
}

function resolveOptions(
  options: CorridorPrizeBeamOptions,
): ResolvedOptions | null {
  const maxPrizes = options.maxPrizes ?? DEFAULT_MAX_PRIZES;
  const beamWidth = options.beamWidth ?? DEFAULT_BEAM_WIDTH;
  const maxResults = options.maxResults ?? DEFAULT_MAX_RESULTS;
  const maxConnectorShare =
    options.maxConnectorShare ?? DEFAULT_MAX_CONNECTOR_SHARE;
  const minimumPrizeUtility =
    options.minimumPrizeUtility ?? DEFAULT_MINIMUM_PRIZE_UTILITY;

  if (
    !Number.isSafeInteger(maxPrizes) ||
    maxPrizes < 1 ||
    maxPrizes > MAX_CONFIGURED_PRIZES ||
    !Number.isSafeInteger(beamWidth) ||
    beamWidth < 1 ||
    beamWidth > MAX_CONFIGURED_BEAM_WIDTH ||
    !Number.isSafeInteger(maxResults) ||
    maxResults < 1 ||
    maxResults > MAX_CONFIGURED_RESULTS ||
    !Number.isFinite(maxConnectorShare) ||
    maxConnectorShare < 0 ||
    maxConnectorShare > 1 ||
    !Number.isFinite(minimumPrizeUtility) ||
    minimumPrizeUtility < 0 ||
    minimumPrizeUtility > 1
  ) {
    return null;
  }

  return {
    maxPrizes,
    beamWidth,
    maxResults,
    maxConnectorShare,
    minimumPrizeUtility,
  };
}

function finiteCost(value: number | null): value is number {
  return value !== null && Number.isFinite(value) && value >= 0;
}

function currentCoordinate(
  origin: Coordinate,
  state: BeamState,
): Coordinate {
  return state.prizes.at(-1)?.exit ?? origin;
}

function usedIds(state: BeamState): ReadonlySet<string> {
  return new Set(state.prizes.map((prize) => prize.id));
}

function usedGroups(state: BeamState): ReadonlySet<string> {
  return new Set(
    state.prizes
      .map((prize) => prize.groupId)
      .filter((group): group is string => group !== undefined),
  );
}

function completion(
  origin: Coordinate,
  state: BeamState,
  budgetSeconds: number,
  maxConnectorShare: number,
  estimateConnectorSeconds: ConnectorTimeEstimator,
): CompletedState | null {
  const returnSeconds = estimateConnectorSeconds(
    currentCoordinate(origin, state),
    origin,
  );
  if (!finiteCost(returnSeconds)) return null;

  const totalSeconds = state.elapsedBeforeReturnSeconds + returnSeconds;
  if (totalSeconds > budgetSeconds + EPSILON) return null;

  const totalConnectorSeconds = state.connectorSeconds + returnSeconds;
  const connectorShare =
    totalSeconds > 0 ? totalConnectorSeconds / totalSeconds : 1;
  if (connectorShare > maxConnectorShare + EPSILON) return null;

  return {
    state,
    returnSeconds,
    totalSeconds,
    connectorShare,
  };
}

function stateKey(state: BeamState): string {
  const last = state.prizes.at(-1)?.id ?? "";
  const set = state.prizes
    .map((prize) => prize.id)
    .sort((left, right) => left.localeCompare(right))
    .join("\u0000");
  return set + "|" + last;
}

function betterPartial(left: BeamState, right: BeamState): boolean {
  if (
    left.collectedValueSeconds >
    right.collectedValueSeconds + EPSILON
  ) {
    return true;
  }
  if (
    right.collectedValueSeconds >
    left.collectedValueSeconds + EPSILON
  ) {
    return false;
  }
  if (
    left.connectorSeconds + EPSILON <
    right.connectorSeconds
  ) {
    return true;
  }
  if (
    right.connectorSeconds + EPSILON <
    left.connectorSeconds
  ) {
    return false;
  }
  if (
    left.elapsedBeforeReturnSeconds + EPSILON <
    right.elapsedBeforeReturnSeconds
  ) {
    return true;
  }
  if (
    right.elapsedBeforeReturnSeconds + EPSILON <
    left.elapsedBeforeReturnSeconds
  ) {
    return false;
  }
  return (
    left.prizes.map((prize) => prize.id).join("\u0000") <
    right.prizes.map((prize) => prize.id).join("\u0000")
  );
}

function partialRank(
  left: BeamState,
  right: BeamState,
): number {
  if (betterPartial(left, right)) return -1;
  if (betterPartial(right, left)) return 1;
  return 0;
}

function completedRank(
  left: CompletedState,
  right: CompletedState,
): number {
  if (
    left.state.collectedValueSeconds !==
    right.state.collectedValueSeconds
  ) {
    return (
      right.state.collectedValueSeconds -
      left.state.collectedValueSeconds
    );
  }
  if (left.connectorShare !== right.connectorShare) {
    return left.connectorShare - right.connectorShare;
  }
  if (left.totalSeconds !== right.totalSeconds) {
    return right.totalSeconds - left.totalSeconds;
  }
  return left.state.prizes
    .map((prize) => prize.id)
    .join("\u0000")
    .localeCompare(
      right.state.prizes
        .map((prize) => prize.id)
        .join("\u0000"),
    );
}

function dedupePartials(states: readonly BeamState[]): readonly BeamState[] {
  const best = new Map<string, BeamState>();
  for (const state of states) {
    const key = stateKey(state);
    const previous = best.get(key);
    if (previous === undefined || betterPartial(state, previous)) {
      best.set(key, state);
    }
  }
  return [...best.values()];
}

function toSequence(
  completed: CompletedState,
  origin: Coordinate,
  budgetSeconds: number,
): CorridorPrizeSequence {
  const state = completed.state;
  const anchors = state.prizes.flatMap((prize) => [
    { ...prize.entry },
    { ...prize.exit },
  ]);
  const averageCorridorUtility =
    state.corridorSeconds > 0
      ? state.collectedValueSeconds / state.corridorSeconds
      : 0;

  return {
    prizeIds: state.prizes.map((prize) => prize.id),
    anchors,
    estimatedSeconds: completed.totalSeconds,
    connectorSeconds: state.connectorSeconds + completed.returnSeconds,
    corridorSeconds: state.corridorSeconds,
    returnSeconds: completed.returnSeconds,
    collectedValueSeconds: state.collectedValueSeconds,
    averageCorridorUtility,
    connectorShare: completed.connectorShare,
    budgetUtilization:
      budgetSeconds > 0 ? completed.totalSeconds / budgetSeconds : 0,
  };
}

/**
 * Builds at most a handful of promising ordered corridor sequences.
 *
 * Every expansion includes a return-to-origin feasibility check, so the beam
 * never spends the rider's time budget without reserving a way home.
 */
export function searchCorridorPrizeLoops(input: {
  readonly origin: Coordinate;
  readonly budgetSeconds: number;
  readonly prizes: readonly CorridorPrize[];
  readonly estimateConnectorSeconds: ConnectorTimeEstimator;
  readonly options?: CorridorPrizeBeamOptions;
}): readonly CorridorPrizeSequence[] {
  if (
    !validCoordinate(input.origin) ||
    !Number.isFinite(input.budgetSeconds) ||
    input.budgetSeconds <= 0
  ) {
    return [];
  }
  const options = resolveOptions(input.options ?? {});
  if (options === null) return [];

  const prizes = input.prizes
    .filter(validPrize)
    .filter((prize) => prize.utility >= options.minimumPrizeUtility)
    .sort((left, right) => left.id.localeCompare(right.id));
  if (prizes.length === 0) return [];

  let beam: readonly BeamState[] = [
    {
      prizes: [],
      elapsedBeforeReturnSeconds: 0,
      connectorSeconds: 0,
      corridorSeconds: 0,
      collectedValueSeconds: 0,
    },
  ];
  const completed: CompletedState[] = [];

  for (let depth = 0; depth < options.maxPrizes; depth += 1) {
    const expanded: BeamState[] = [];

    for (const state of beam) {
      const ids = usedIds(state);
      const groups = usedGroups(state);
      const from = currentCoordinate(input.origin, state);

      for (const prize of prizes) {
        if (ids.has(prize.id)) continue;
        if (prize.groupId !== undefined && groups.has(prize.groupId)) continue;

        const connectorSeconds = input.estimateConnectorSeconds(
          from,
          prize.entry,
        );
        if (!finiteCost(connectorSeconds)) continue;

        const next: BeamState = {
          prizes: [...state.prizes, prize],
          elapsedBeforeReturnSeconds:
            state.elapsedBeforeReturnSeconds +
            connectorSeconds +
            prize.traversalSeconds,
          connectorSeconds: state.connectorSeconds + connectorSeconds,
          corridorSeconds:
            state.corridorSeconds + prize.traversalSeconds,
          collectedValueSeconds:
            state.collectedValueSeconds +
            prize.utility * prize.traversalSeconds,
        };

        const feasible = completion(
          input.origin,
          next,
          input.budgetSeconds,
          options.maxConnectorShare,
          input.estimateConnectorSeconds,
        );
        if (feasible === null) continue;

        expanded.push(next);
        completed.push(feasible);
      }
    }

    if (expanded.length === 0) break;
    beam = [...dedupePartials(expanded)]
      .sort(partialRank)
      .slice(0, options.beamWidth);
  }

  completed.sort(completedRank);

  const results: CorridorPrizeSequence[] = [];
  const keys = new Set<string>();
  for (const candidate of completed) {
    if (results.length >= options.maxResults) break;
    const sequence = toSequence(
      candidate,
      input.origin,
      input.budgetSeconds,
    );
    const key = sequence.prizeIds.join("\u0000");
    if (keys.has(key)) continue;
    keys.add(key);
    results.push(sequence);
  }

  return results;
}
