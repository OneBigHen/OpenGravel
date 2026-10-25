/** Atlas tours propose roads; only the router establishes geometry and ETA. */
import { haversine } from "@/domain/geometry/analysis";
import type { Coordinate } from "@/domain/ride/types";
import type { GravelAtlasCorridor } from "@/application/roads/gravel-atlas";
import type { ProviderRouteRequest } from "./route-provider";

/** Mixed seeks half the dirt of Dirt OK, only on timeboxed loops. */
export function loopDirtTarget(request: ProviderRouteRequest): number {
  if (request.discovery === undefined || request.options.bike?.maintainedGravel === "avoid") return 0;
  const surface = request.options.surfacePreference;
  if (surface !== "mixed" && surface !== "dirt-preferred") return 0;
  return request.options.targetUnpavedShare ?? (surface === "mixed" ? 0.25 : 0.5);
}

export interface AtlasLoopSequence {
  readonly corridors: readonly GravelAtlasCorridor[];
  readonly estimatedSeconds: number;
  readonly connectorMeters: number;
  readonly prize: number;
  readonly key: string;
}

/**
 * Keep both legal orientations in the beam. Orienting each road relative to
 * home first misses cheap joins between roads on the far side of the loop.
 * Five corridors allow a useful tour of several short nearby atlas fragments.
 * Estimates order probes, never replace the measured ride-time gate.
 */
export function atlasDirtLoopSequences(
  request: ProviderRouteRequest,
  allowed: readonly GravelAtlasCorridor[],
  connectorSpeed: number,
): readonly AtlasLoopSequence[] {
  if (loopDirtTarget(request) <= 0 || request.discovery === undefined) return [];
  const target = request.discovery.targetMinutes * 60;
  const cap = (request.discovery.targetMinutes + request.discovery.toleranceMinutes) * 60;
  const speed = Math.max(8, Math.min(30, connectorSpeed));
  const dirtSpeed = Math.min(8, speed);
  const approach = (corridor: GravelAtlasCorridor): number =>
    haversine(request.origin, corridor.geometry[0]!) + haversine(corridor.geometry.at(-1)!, request.origin);
  const sources = [...allowed].sort((a, b) =>
    b.lengthMeters / (1 + approach(b) / 10_000) - a.lengthMeters / (1 + approach(a) / 10_000) || a.id.localeCompare(b.id),
  ).slice(0, 32);
  const oriented = sources.flatMap(corridor => corridor.reversible
    ? [corridor, { ...corridor, geometry: [...corridor.geometry].reverse() }]
    : [corridor]);
  interface State { corridors: readonly GravelAtlasCorridor[]; from: Coordinate; connectors: number; dirt: number; qualityMeters: number }
  let beam: readonly State[] = [{ corridors: [], from: request.origin, connectors: 0, dirt: 0, qualityMeters: 0 }];
  const found: AtlasLoopSequence[] = [];
  for (let depth = 0; depth < 5; depth += 1) {
    const next: { state: State; sequence: AtlasLoopSequence }[] = [];
    for (const state of beam) for (const corridor of oriented) {
      if (state.corridors.some(c => c.id === corridor.id)) continue;
      const connectors = state.connectors + haversine(state.from, corridor.geometry[0]!);
      const dirt = state.dirt + corridor.lengthMeters;
      const from = corridor.geometry.at(-1)!;
      const totalConnectors = connectors + haversine(from, request.origin);
      const seconds = totalConnectors * 1.5 / speed + dirt / dirtSpeed;
      if (seconds > cap) continue;
      const qualityMeters = state.qualityMeters + corridor.lengthMeters * (0.6 + 0.4 * corridor.quality);
      // Length matters more than bendiness for a rider asking for dirt. Favor
      // a real tour over a remote prize with a long paved commute.
      const share = dirt / Math.max(1, dirt + totalConnectors * 1.5);
      const prize = qualityMeters * Math.min(1, share / loopDirtTarget(request)) / (1 + Math.abs(seconds - target) / target);
      const corridors = [...state.corridors, corridor];
      const key = corridors.map(c => `${c.id}:${c.geometry[0]!.lon},${c.geometry[0]!.lat}`).join(">");
      const sequence = { corridors, estimatedSeconds: seconds, connectorMeters: totalConnectors, prize, key };
      next.push({ state: { corridors, from, connectors, dirt, qualityMeters }, sequence });
    }
    next.sort((a, b) => b.sequence.prize - a.sequence.prize || a.sequence.key.localeCompare(b.sequence.key));
    // Avoid filling the beam with permutations of the same collected roads.
    const sets = new Map<string, (typeof next)[number]>();
    for (const item of next) {
      const key = item.state.corridors.map(c => c.id).sort().join("|");
      const prior = sets.get(key);
      if (prior === undefined || item.sequence.estimatedSeconds < prior.sequence.estimatedSeconds) sets.set(key, item);
    }
    const distinct = [...sets.values()].sort((a, b) => b.sequence.prize - a.sequence.prize || a.sequence.key.localeCompare(b.sequence.key));
    found.push(...distinct.map(item => item.sequence));
    beam = distinct.slice(0, 32).map(item => item.state);
    if (beam.length === 0) break;
  }
  return found.sort((a, b) => b.prize - a.prize || a.key.localeCompare(b.key));
}
