/**
 * On-device routing over downloaded road-graph tiles, ported from SwitchBack
 * `src/lib/offline/v2-router.ts`. Same search (turn restrictions, road locks,
 * several snap candidates per point, a bounded state budget), plus an A*
 * heuristic so a ride across a state stays inside the budget.
 *
 * The heuristic's cost-per-metre floor is measured from the tiles actually
 * loaded, so it stays admissible whatever weights a future build writes.
 * Built tiles make every OSM vertex a node (hundreds per km² in a suburb), so
 * runs of one way through plain vertices are contracted into one edge before
 * the search; snap nodes and turn-restriction vias are always kept.
 */

import type { Coordinate, RoadCharacterIntent, SurfaceIntent } from "@/domain/ride/types";

import type { GraphPosition, OfflineGraphEdge, OfflineGraphNode, OfflineGraphTile, OfflineTurnRestriction } from "./graph-tile";

export type OfflineRouteProfile = "quick" | "balanced" | "twisty" | "scenic" | "adventure" | "gravel";
export type OfflineBikeCompatibility = "street" | "adventure";

export interface OfflineRoadLock {
  readonly osmWayId: string;
  readonly mode: "must" | "prefer" | "avoid";
}

export interface OfflineRouteRequest {
  /** Start, any stops in order, then the finish. At least two. */
  readonly waypoints: readonly Coordinate[];
  readonly profile: OfflineRouteProfile;
  readonly bike: OfflineBikeCompatibility;
  readonly avoidHighways?: boolean;
  readonly roadLocks?: readonly OfflineRoadLock[];
  readonly maxSnapMeters?: number;
  readonly maxVisitedStates?: number;
}

export type OfflineRouteFailure =
  | { readonly ok: false; readonly kind: "invalid_request"; readonly message: string }
  | { readonly ok: false; readonly kind: "out_of_coverage"; readonly message: string }
  | { readonly ok: false; readonly kind: "no_path"; readonly message: string }
  | { readonly ok: false; readonly kind: "search_budget"; readonly visitedStates: number; readonly message: string }
  | { readonly ok: false; readonly kind: "cancelled"; readonly message: string };

export interface OfflineRouteSuccess {
  readonly ok: true;
  readonly edgeIds: readonly string[];
  readonly osmWayIds: readonly string[];
  readonly geometry: readonly Coordinate[];
  readonly distanceMeters: number;
  readonly visitedStates: number;
}

export type OfflineRouteResult = OfflineRouteSuccess | OfflineRouteFailure;

/** The rider's road character and surface choice, as an offline profile. */
export function offlineProfileFor(
  character: RoadCharacterIntent,
  surface: SurfaceIntent["preference"],
): { readonly profile: OfflineRouteProfile; readonly bike: OfflineBikeCompatibility } {
  if (surface === "dirt-preferred") return { profile: "gravel", bike: "adventure" };
  if (surface === "mixed") return { profile: "adventure", bike: "adventure" };
  const bike: OfflineBikeCompatibility = surface === "pavement" ? "street" : "adventure";
  switch (character) {
    case "efficient":
      return { profile: "quick", bike };
    case "balanced":
      return { profile: "balanced", bike };
    case "curvy":
      return { profile: "twisty", bike };
    case "backroads":
      return { profile: "scenic", bike };
  }
}

const UNPAVED = new Set(["gravel", "dirt", "unpaved", "ground"]);
const ROUGH = new Set(["bad", "very_bad", "horrible"]);

/** The eight SwitchBack profiles reduced to the six vnext exposes. */
export function offlineProfileWeight(
  edge: Pick<OfflineGraphEdge, "profileWeights" | "surface" | "roadClass">,
  profile: OfflineRouteProfile,
): number {
  const w = edge.profileWeights;
  const majorRoadPenalty = edge.roadClass === "motorway" || edge.roadClass === "trunk" ? 8 : 1;
  switch (profile) {
    case "quick":
      return w.quick;
    case "balanced":
      return (w.quick + w.twisty) / 2;
    case "twisty":
      return w.twisty;
    case "scenic":
      return w.scenic;
    case "adventure":
      return w.adventure * majorRoadPenalty;
    case "gravel":
      return (UNPAVED.has(edge.surface) ? w.adventure * 0.82 : w.adventure * 1.12) * majorRoadPenalty;
  }
}

interface Graph {
  readonly nodes: Map<string, OfflineGraphNode>;
  readonly edges: Map<string, OfflineGraphEdge>;
  readonly outgoing: Map<string, OfflineGraphEdge[]>;
  readonly restrictions: Map<string, OfflineTurnRestriction[]>;
  /** Nodes some turn restriction passes through. */
  readonly vias: Set<string>;
}

/** One built edge, or a contracted run of them along a single way. */
interface RouteEdge extends OfflineGraphEdge {
  /** The built edge ids this edge stands for, in travel order. */
  readonly parts: readonly string[];
}

interface SnapCandidate {
  readonly distance: number;
  readonly nodeId: string;
}

interface SearchState {
  readonly nodeId: string;
  readonly incomingEdgeId: string;
  readonly targetIndex: number;
  readonly lockMask: number;
}

interface Score {
  readonly snap: number;
  readonly cost: number;
}

const MAX_MUST_LOCKS = 20;
const MAX_SNAP_CANDIDATES = 16;
const SNAP_ALTERNATIVE_RADIUS_METERS = 1_000;
const DEFAULT_MAX_STATES = 400_000;
const MAX_RETRY_STATES = 1_000_000;

export function routeOffline(
  tiles: readonly OfflineGraphTile[],
  request: OfflineRouteRequest,
  options: { readonly isCancelled?: () => boolean } = {},
): OfflineRouteResult {
  const cancelled: OfflineRouteFailure = { ok: false, kind: "cancelled", message: "Offline route was cancelled" };
  if (options.isCancelled?.()) return cancelled;
  if (request.waypoints.length < 2) {
    return { ok: false, kind: "invalid_request", message: "An offline route needs a start and a finish" };
  }
  const graph = mergeTiles(tiles);
  const points = request.waypoints.map((c): GraphPosition => [c.lon, c.lat]);
  const allCandidates = points.map((p) => snapToLegalEdges(graph, p, request));
  if (allCandidates.some((c) => c.length === 0)) {
    return { ok: false, kind: "out_of_coverage", message: "A route point is outside the downloaded roads" };
  }

  const locks = request.roadLocks ?? [];
  const mustLocks = [...new Set(locks.filter((l) => l.mode === "must").map((l) => l.osmWayId))];
  if (mustLocks.length > MAX_MUST_LOCKS) {
    return { ok: false, kind: "no_path", message: `Offline routing keeps at most ${MAX_MUST_LOCKS} required roads` };
  }
  const mustBit = new Map(mustLocks.map((way, i) => [way, 1 << i]));
  const requiredMask = mustLocks.reduce((mask, _, i) => mask | (1 << i), 0);
  const avoid = new Set(locks.filter((l) => l.mode === "avoid").map((l) => l.osmWayId));
  const prefer = new Set(locks.filter((l) => l.mode === "prefer").map((l) => l.osmWayId));
  // With must-locks the path detours by design; the distance bound still
  // holds, since every leg is still at least its straight line.
  const floor = costFloor(graph, request.profile) * (prefer.size > 0 ? 0.7 : 1);
  const keep = new Set([...graph.vias, ...allCandidates.flatMap((list) => list.map((c) => c.nodeId))]);
  const outgoing = contractChains(graph, keep);

  const budget = request.maxVisitedStates ?? DEFAULT_MAX_STATES;
  const retryBudget = Math.min(MAX_RETRY_STATES, Math.floor(budget * 2.5));

  const search = (candidates: readonly (readonly SnapCandidate[])[], maxStates: number): OfflineRouteResult => {
    // Lower bound on metres still to travel from a node while heading for
    // target `i`: to that point (less its snap radius), then leg by leg.
    const radius = candidates.map((list, i) =>
      Math.max(0, ...list.map((c) => haversine(points[i]!, graph.nodes.get(c.nodeId)!.coordinate))),
    );
    const tail: number[] = new Array<number>(points.length + 1).fill(0);
    for (let i = points.length - 2; i >= 0; i -= 1) {
      tail[i] = Math.max(0, haversine(points[i]!, points[i + 1]!) - radius[i]! - radius[i + 1]!) + tail[i + 1]!;
    }
    const heuristic = (nodeId: string, target: number): number => {
      if (target >= points.length) return 0;
      const at = graph.nodes.get(nodeId)!.coordinate;
      return floor * (Math.max(0, haversine(at, points[target]!) - radius[target]!) + tail[target]!);
    };
    const targetMatch = (target: number, nodeId: string) => candidates[target]?.find((c) => c.nodeId === nodeId);

    const queue = new MinQueue();
    const scores = new Map<string, Score>();
    const states = new Map<string, SearchState>();
    const previous = new Map<string, { key: string; edge: RouteEdge }>();
    const relax = (key: string, state: SearchState, score: Score, from?: { key: string; edge: RouteEdge }) => {
      const known = scores.get(key);
      if (known && compareScores(score, known) >= 0) return;
      scores.set(key, score);
      states.set(key, state);
      if (from) previous.set(key, from);
      else previous.delete(key);
      queue.push(key, score, score.cost + heuristic(state.nodeId, state.targetIndex));
    };

    for (const start of candidates[0]!) {
      // Consecutive identical points collapse onto the one node.
      let target = 1;
      while (
        target < candidates.length &&
        (target < candidates.length - 1 || requiredMask === 0) &&
        samePosition(points[target]!, points[target - 1]!) &&
        targetMatch(target, start.nodeId)
      ) {
        target += 1;
      }
      const state: SearchState = { nodeId: start.nodeId, incomingEdgeId: "", targetIndex: target, lockMask: 0 };
      relax(stateKey(state), state, { snap: start.distance, cost: start.distance });
    }

    let visited = 0;
    while (queue.size > 0) {
      if (options.isCancelled?.()) return cancelled;
      const entry = queue.pop()!;
      if (entry.score !== scores.get(entry.key)) continue;
      const current = states.get(entry.key)!;
      visited += 1;
      if (visited > maxStates) {
        return { ok: false, kind: "search_budget", visitedStates: visited, message: `Offline search passed ${maxStates} states` };
      }
      if (current.targetIndex >= candidates.length) {
        return buildSuccess(entry.key, previous, visited);
      }

      for (const edge of outgoing.get(current.nodeId) ?? []) {
        if (!edgeIsCompatible(edge, request.bike) || avoid.has(edge.osmWayId)) continue;
        if (turnIsRestricted(graph, current, edge)) continue;

        const lockMask = current.lockMask | (mustBit.get(edge.osmWayId) ?? 0);
        // The finish only counts once every required road has been ridden;
        // otherwise the search would finish, then wander off to collect one.
        const reachable = (target: number) => target < candidates.length - 1 || lockMask === requiredMask;
        let target = current.targetIndex;
        let snapPenalty = 0;
        let matched: SnapCandidate | undefined;
        for (let hit = targetMatch(target, edge.toNodeId); hit && reachable(target); hit = targetMatch(target, edge.toNodeId)) {
          matched = hit;
          snapPenalty += hit.distance;
          target += 1;
        }
        const highwayPenalty = request.avoidHighways && (edge.roadClass === "motorway" || edge.roadClass === "trunk") ? 8 : 1;
        const step = offlineProfileWeight(edge, request.profile) * highwayPenalty * (prefer.has(edge.osmWayId) ? 0.7 : 1);
        const from = { key: entry.key, edge };
        // The way in only matters where a turn restriction could apply.
        const incomingEdgeId = graph.vias.has(edge.toNodeId) ? edge.parts.at(-1)! : "";

        // Reaching a stop's candidate node counts it, but the search may also
        // drive through and take a later candidate of the same stop.
        if (matched && target === current.targetIndex + 1 && matched.nodeId !== candidates[current.targetIndex]![0]!.nodeId) {
          const through: SearchState = { nodeId: edge.toNodeId, incomingEdgeId, targetIndex: current.targetIndex, lockMask };
          relax(stateKey(through), through, { snap: entry.score.snap, cost: entry.score.cost + step }, from);
        }
        const next: SearchState = { nodeId: edge.toNodeId, incomingEdgeId, targetIndex: target, lockMask };
        relax(stateKey(next), next, { snap: entry.score.snap + snapPenalty, cost: entry.score.cost + step + snapPenalty }, from);
      }
    }
    return { ok: false, kind: "no_path", message: "No legal road in the download joins these points" };
  };

  // Nearest snap first; retry wider snaps, then a bigger budget, only when
  // that could change the answer. A disconnected graph stays a cheap no_path.
  const nearest = allCandidates.map((c) => c.slice(0, 1));
  const first = search(nearest, budget);
  if (first.ok || first.kind === "cancelled") return first;
  const widen = allCandidates.some((c) => c.length > 1);
  const second = widen ? search(allCandidates, budget) : first;
  if (second.ok || second.kind !== "search_budget" || retryBudget <= budget) return second;
  return search(widen ? allCandidates : nearest, retryBudget);
}

function mergeTiles(tiles: readonly OfflineGraphTile[]): Graph {
  const nodes = new Map<string, OfflineGraphNode>();
  const edges = new Map<string, OfflineGraphEdge>();
  const restrictions = new Map<string, OfflineTurnRestriction[]>();
  const vias = new Set<string>();
  for (const tile of tiles) {
    for (const node of tile.nodes) nodes.set(node.id, node);
    for (const edge of tile.edges) edges.set(edge.id, edge);
    for (const r of tile.turnRestrictions) {
      vias.add(r.viaNodeId);
      const key = `${r.incomingEdgeId}:${r.viaNodeId}`;
      const list = restrictions.get(key) ?? [];
      if (!list.some((c) => c.outgoingEdgeId === r.outgoingEdgeId && c.restriction === r.restriction)) list.push(r);
      restrictions.set(key, list);
    }
  }
  const outgoing = new Map<string, OfflineGraphEdge[]>();
  for (const edge of edges.values()) {
    // An edge whose far node lives in a tile that was not loaded is a dead end.
    if (!nodes.has(edge.fromNodeId) || !nodes.has(edge.toNodeId)) continue;
    const list = outgoing.get(edge.fromNodeId) ?? [];
    list.push(edge);
    outgoing.set(edge.fromNodeId, list);
  }
  return { nodes, edges, outgoing, restrictions, vias };
}

/**
 * Replaces each run of one way through plain vertices with a single edge. A
 * vertex is plain when it is not kept, every edge at it belongs to one way,
 * it joins exactly two neighbours, and each way in has one way on (no U-turn).
 * Weights are linear in length, so the merged edge's weights are the sums.
 */
function contractChains(graph: Graph, keep: ReadonlySet<string>): Map<string, RouteEdge[]> {
  const incoming = new Map<string, OfflineGraphEdge[]>();
  for (const list of graph.outgoing.values()) {
    for (const edge of list) {
      const into = incoming.get(edge.toNodeId) ?? [];
      into.push(edge);
      incoming.set(edge.toNodeId, into);
    }
  }
  const plainCache = new Map<string, boolean>();
  const plain = (nodeId: string): boolean => {
    let answer = plainCache.get(nodeId);
    if (answer === undefined) {
      answer = isPlain(nodeId, graph.outgoing.get(nodeId) ?? [], incoming.get(nodeId) ?? [], keep);
      plainCache.set(nodeId, answer);
    }
    return answer;
  };
  const onward = (arriving: OfflineGraphEdge): OfflineGraphEdge | undefined => {
    if (!plain(arriving.toNodeId)) return undefined;
    const next = (graph.outgoing.get(arriving.toNodeId) ?? []).filter((e) => e.toNodeId !== arriving.fromNodeId);
    return next.length === 1 ? next[0] : undefined;
  };

  const result = new Map<string, RouteEdge[]>();
  for (const [nodeId, list] of graph.outgoing) {
    // Chains start only at nodes that stay; a closed loop of plain vertices
    // has no way in or out and is dropped with them.
    if (plain(nodeId)) continue;
    result.set(
      nodeId,
      list.map((first) => {
        const parts = [first];
        for (let next = onward(first); next && next.toNodeId !== nodeId; next = onward(next)) parts.push(next);
        return parts.length === 1 ? { ...first, parts: [first.id] } : mergeParts(parts);
      }),
    );
  }
  return result;
}

function isPlain(
  nodeId: string,
  outs: readonly OfflineGraphEdge[],
  ins: readonly OfflineGraphEdge[],
  keep: ReadonlySet<string>,
): boolean {
  if (keep.has(nodeId) || outs.length === 0 || outs.length > 2 || outs.length !== ins.length) return false;
  const way = outs[0]!;
  let a: string | undefined;
  let b: string | undefined;
  for (const [edge, neighbour] of [...outs.map((e) => [e, e.toNodeId] as const), ...ins.map((e) => [e, e.fromNodeId] as const)]) {
    if (!sameWay(edge, way)) return false;
    if (neighbour === a || neighbour === b) continue;
    if (a === undefined) a = neighbour;
    else if (b === undefined) b = neighbour;
    else return false;
  }
  return b !== undefined;
}

function sameWay(a: OfflineGraphEdge, b: OfflineGraphEdge): boolean {
  return (
    a.osmWayId === b.osmWayId &&
    a.roadClass === b.roadClass &&
    a.surface === b.surface &&
    a.smoothness === b.smoothness &&
    a.trackType === b.trackType &&
    a.access === b.access &&
    a.motorcycleAccess === b.motorcycleAccess
  );
}

function mergeParts(parts: readonly OfflineGraphEdge[]): RouteEdge {
  const first = parts[0]!;
  const geometry: GraphPosition[] = [...first.geometry];
  for (const part of parts.slice(1)) geometry.push(...part.geometry.slice(1));
  const sum = (key: keyof OfflineGraphEdge["profileWeights"]) => parts.reduce((total, p) => total + p.profileWeights[key], 0);
  return {
    ...first,
    toNodeId: parts.at(-1)!.toNodeId,
    geometry,
    profileWeights: { quick: sum("quick"), twisty: sum("twisty"), scenic: sum("scenic"), adventure: sum("adventure") },
    parts: parts.map((p) => p.id),
  };
}

/** The least cost per straight-line metre any loaded edge offers. */
function costFloor(graph: Graph, profile: OfflineRouteProfile): number {
  let floor = Number.POSITIVE_INFINITY;
  for (const edge of graph.edges.values()) {
    const from = graph.nodes.get(edge.fromNodeId);
    const to = graph.nodes.get(edge.toNodeId);
    if (!from || !to) continue;
    const straight = haversine(from.coordinate, to.coordinate);
    if (straight < 1) continue;
    floor = Math.min(floor, offlineProfileWeight(edge, profile) / straight);
  }
  return Number.isFinite(floor) ? floor : 0;
}

function edgeIsCompatible(edge: OfflineGraphEdge, bike: OfflineBikeCompatibility): boolean {
  if (edge.access === "forbidden" || edge.motorcycleAccess === "forbidden") return false;
  if (bike === "street") {
    if (edge.roadClass === "path" || UNPAVED.has(edge.surface) || edge.trackType) return false;
    if (ROUGH.has(edge.smoothness ?? "")) return false;
  }
  return true;
}

function turnIsRestricted(graph: Graph, current: SearchState, outgoing: RouteEdge): boolean {
  if (!current.incomingEdgeId) return false;
  const list = graph.restrictions.get(`${current.incomingEdgeId}:${current.nodeId}`) ?? [];
  const out = outgoing.parts[0];
  if (list.some((r) => r.restriction === "no_turn" && r.outgoingEdgeId === out)) return true;
  const only = list.filter((r) => r.restriction === "only_turn");
  return only.length > 0 && !only.some((r) => r.outgoingEdgeId === out);
}

function snapToLegalEdges(graph: Graph, point: GraphPosition, request: OfflineRouteRequest): SnapCandidate[] {
  const bestByNode = new Map<string, SnapCandidate>();
  const maxSnap = request.maxSnapMeters ?? 5_000;
  // Cheap reject: a degree box around the point sized by the snap limit.
  const latPad = maxSnap / 111_320;
  const lonPad = latPad / Math.max(0.1, Math.cos((point[1] * Math.PI) / 180));
  for (const edge of graph.edges.values()) {
    if (!edgeIsCompatible(edge, request.bike) || !graph.outgoing.has(edge.fromNodeId)) continue;
    const from = graph.nodes.get(edge.fromNodeId)?.coordinate;
    const to = graph.nodes.get(edge.toNodeId)?.coordinate;
    if (!from || !to) continue;
    if (!edge.geometry.some((p) => Math.abs(p[0] - point[0]) <= lonPad && Math.abs(p[1] - point[1]) <= latPad)) continue;
    const nodeId = haversine(point, from) <= haversine(point, to) ? edge.fromNodeId : edge.toNodeId;
    for (let i = 0; i < edge.geometry.length - 1; i += 1) {
      const distance = pointSegmentMeters(point, edge.geometry[i]!, edge.geometry[i + 1]!);
      const known = bestByNode.get(nodeId);
      if (!known || distance < known.distance) bestByNode.set(nodeId, { distance, nodeId });
    }
  }
  const nearest = Math.min(Number.POSITIVE_INFINITY, ...[...bestByNode.values()].map((c) => c.distance));
  const limit = Math.min(maxSnap, nearest + SNAP_ALTERNATIVE_RADIUS_METERS);
  return [...bestByNode.values()]
    .filter((c) => c.distance <= limit)
    .sort((a, b) => a.distance - b.distance)
    .slice(0, MAX_SNAP_CANDIDATES);
}

function buildSuccess(
  finalKey: string,
  previous: Map<string, { key: string; edge: RouteEdge }>,
  visitedStates: number,
): OfflineRouteSuccess {
  const path: RouteEdge[] = [];
  for (let key = finalKey, step = previous.get(key); step; key = step.key, step = previous.get(key)) {
    path.unshift(step.edge);
  }
  const geometry: Coordinate[] = [];
  let distanceMeters = 0;
  for (const edge of path) {
    for (const [lon, lat] of edge.geometry) {
      const last = geometry.at(-1);
      if (!last || last.lon !== lon || last.lat !== lat) geometry.push({ lon, lat });
    }
    for (let i = 0; i < edge.geometry.length - 1; i += 1) distanceMeters += haversine(edge.geometry[i]!, edge.geometry[i + 1]!);
  }
  const osmWayIds: string[] = [];
  for (const edge of path) if (osmWayIds.at(-1) !== edge.osmWayId) osmWayIds.push(edge.osmWayId);
  return { ok: true, edgeIds: path.flatMap((e) => e.parts), osmWayIds, geometry, distanceMeters, visitedStates };
}

function stateKey(s: SearchState): string {
  return `${s.nodeId}|${s.incomingEdgeId}|${s.targetIndex}|${s.lockMask}`;
}

function samePosition(a: GraphPosition, b: GraphPosition): boolean {
  return a[0] === b[0] && a[1] === b[1];
}

function compareScores(a: Score, b: Score): number {
  return a.snap !== b.snap ? a.snap - b.snap : a.cost - b.cost;
}

function pointSegmentMeters(point: GraphPosition, start: GraphPosition, end: GraphPosition): number {
  const latScale = 111_320;
  const lonScale = Math.cos((point[1] * Math.PI) / 180) * latScale;
  const ax = (start[0] - point[0]) * lonScale;
  const ay = (start[1] - point[1]) * latScale;
  const dx = (end[0] - point[0]) * lonScale - ax;
  const dy = (end[1] - point[1]) * latScale - ay;
  const lengthSquared = dx * dx + dy * dy;
  const t = lengthSquared === 0 ? 0 : Math.max(0, Math.min(1, -(ax * dx + ay * dy) / lengthSquared));
  return Math.hypot(ax + t * dx, ay + t * dy);
}

function haversine(a: GraphPosition, b: GraphPosition): number {
  const rad = (d: number) => (d * Math.PI) / 180;
  const dLat = rad(b[1] - a[1]);
  const dLon = rad(b[0] - a[0]);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a[1])) * Math.cos(rad(b[1])) * Math.sin(dLon / 2) ** 2;
  return 6_371_000 * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
}

/**
 * Binary heap ordered by the snap distance first (a route that reaches its
 * points more closely always wins), then by cost plus the heuristic.
 */
class MinQueue {
  private readonly values: { key: string; score: Score; priority: number }[] = [];

  get size(): number {
    return this.values.length;
  }

  push(key: string, score: Score, priority: number): void {
    const entry = { key, score, priority };
    let i = this.values.length;
    this.values.push(entry);
    while (i > 0) {
      const parent = (i - 1) >> 1;
      if (before(this.values[parent]!, entry)) break;
      this.values[i] = this.values[parent]!;
      i = parent;
    }
    this.values[i] = entry;
  }

  pop(): { key: string; score: Score } | undefined {
    const first = this.values[0];
    const last = this.values.pop();
    if (first === undefined || last === undefined || this.values.length === 0) return first;
    let i = 0;
    for (;;) {
      const left = i * 2 + 1;
      if (left >= this.values.length) break;
      const right = left + 1;
      const child = right < this.values.length && before(this.values[right]!, this.values[left]!) ? right : left;
      if (before(last, this.values[child]!)) break;
      this.values[i] = this.values[child]!;
      i = child;
    }
    this.values[i] = last;
    return first;
  }
}

function before(a: { score: Score; priority: number }, b: { score: Score; priority: number }): boolean {
  return a.score.snap !== b.score.snap ? a.score.snap < b.score.snap : a.priority <= b.priority;
}
