/**
 * Library-derived corridor probes.
 *
 * A saved/imported route is not routing truth and a recorded ride is not proof
 * that the rider liked it. This module therefore does one narrow job: convert
 * caller-approved library lines into a small set of bounded search probes.
 *
 * The probes are provider-neutral. They add ordered shaping anchors to an
 * otherwise ordinary point-to-point request, then the existing provider,
 * eligibility, evidence, scoring, diversity and frontier layers decide whether
 * the returned route is useful.
 */

import { haversine } from "@/domain/geometry/analysis";
import type { Coordinate } from "@/domain/ride/types";
import { indexRoute, lineOverlap } from "@/application/roads/route-overlap";
import type { ProviderRouteRequest } from "./route-provider";

export const DEFAULT_LIBRARY_CORRIDOR_TARGET_METERS = 12_000;
export const DEFAULT_LIBRARY_CORRIDOR_MINIMUM_METERS = 4_000;
export const DEFAULT_LIBRARY_CORRIDOR_WINDOW_STEP_METERS = 8_000;
export const DEFAULT_LIBRARY_CORRIDOR_MAX_SHAPING_ANCHORS = 5;
export const DEFAULT_LIBRARY_CORRIDOR_MAX_PROBES = 1;
export const DEFAULT_LIBRARY_CORRIDOR_MAX_PER_SOURCE = 1;

const MAX_RAW_WINDOWS_PER_SOURCE = 64;
const MAX_CONFIGURED_PROBES = 8;
const MAX_CONFIGURED_PER_SOURCE = 8;
const MAX_CONFIGURED_SHAPING_ANCHORS = 16;
const EPSILON = 1e-9;

export interface LibraryCorridorSource {
  /** Stable local/library id. It is diagnostic identity, never rider copy. */
  readonly id: string;
  /** Caller-approved source line. No quality or legality is inferred from it. */
  readonly geometry: readonly Coordinate[];
  /**
   * Optional search-allocation prior in [0, 1].
   *
   * It may come from explicit curation, a trusted source catalogue, or a future
   * learned preference. It is not a route score and must not come from "the
   * rider happened to record this road" alone.
   */
  readonly priority?: number;
}

export interface LibraryCorridorProbeOptions {
  /** Desired source-corridor length before the router connects to it. */
  readonly targetCorridorMeters?: number;
  /** Shorter source fragments are ignored. */
  readonly minimumCorridorMeters?: number;
  /** Distance between candidate window starts on a long source line. */
  readonly windowStepMeters?: number;
  /** Includes corridor entry and exit; GraphHopper sees these as ordered vias. */
  readonly maxShapingAnchors?: number;
  /** Total provider calls the caller is willing to spend on library probes. */
  readonly maxProbes?: number;
  /** Diversity cap so one long source does not consume the whole call budget. */
  readonly maxPerSource?: number;
}

export interface LibraryCorridorProbe {
  readonly id: string;
  readonly sourceId: string;
  readonly sourcePriority: number;
  readonly sourceStartIndex: number;
  readonly sourceEndIndex: number;
  readonly direction: "forward" | "reverse";
  /** Oriented source geometry the probe is trying to recover. */
  readonly corridor: readonly Coordinate[];
  /** Bounded ordered vias sampled from corridor. */
  readonly shaping: readonly Coordinate[];
  readonly corridorMeters: number;
  /** Straight-line origin-to-entry plus exit-to-destination search overhead. */
  readonly connectorMeters: number;
  readonly connectorToCorridorRatio: number;
  /**
   * Cheap search-allocation proxy only. It is not an ETA and never enters the
   * canonical route score.
   */
  readonly detourProxyMeters: number;
}

export interface LibraryCorridorAdherence {
  readonly corridorMeters: number;
  readonly riddenMeters: number;
  readonly share: number;
}

interface ResolvedProbeOptions {
  readonly targetCorridorMeters: number;
  readonly minimumCorridorMeters: number;
  readonly windowStepMeters: number;
  readonly maxShapingAnchors: number;
  readonly maxProbes: number;
  readonly maxPerSource: number;
}

interface CorridorWindow {
  readonly startIndex: number;
  readonly endIndex: number;
  readonly geometry: readonly Coordinate[];
  readonly meters: number;
}

function validCoordinate(point: Coordinate): boolean {
  return (
    Number.isFinite(point.lon) &&
    Math.abs(point.lon) <= 180 &&
    Number.isFinite(point.lat) &&
    Math.abs(point.lat) <= 90
  );
}

function validLine(line: readonly Coordinate[]): boolean {
  return line.length >= 2 && line.every(validCoordinate);
}

function copyCoordinate(point: Coordinate): Coordinate {
  return { lon: point.lon, lat: point.lat };
}

function segmentMeters(from: Coordinate, to: Coordinate): number {
  const meters = haversine(from, to);
  return Number.isFinite(meters) && meters > 0 ? meters : 0;
}

function cumulativeMeters(line: readonly Coordinate[]): readonly number[] {
  const cumulative = [0];
  let total = 0;
  for (let index = 1; index < line.length; index += 1) {
    const from = line[index - 1];
    const to = line[index];
    if (from === undefined || to === undefined) continue;
    total += segmentMeters(from, to);
    cumulative.push(total);
  }
  return cumulative;
}

function lineMeters(line: readonly Coordinate[]): number {
  return cumulativeMeters(line).at(-1) ?? 0;
}

function firstIndexAtOrAfter(
  cumulative: readonly number[],
  targetMeters: number,
  fromIndex = 0,
): number {
  for (let index = Math.max(0, fromIndex); index < cumulative.length; index += 1) {
    const value = cumulative[index];
    if (value !== undefined && value + EPSILON >= targetMeters) return index;
  }
  return cumulative.length - 1;
}

function resolveOptions(
  options: LibraryCorridorProbeOptions,
): ResolvedProbeOptions | null {
  const targetCorridorMeters =
    options.targetCorridorMeters ?? DEFAULT_LIBRARY_CORRIDOR_TARGET_METERS;
  const minimumCorridorMeters =
    options.minimumCorridorMeters ?? DEFAULT_LIBRARY_CORRIDOR_MINIMUM_METERS;
  const windowStepMeters =
    options.windowStepMeters ?? DEFAULT_LIBRARY_CORRIDOR_WINDOW_STEP_METERS;
  const maxShapingAnchors =
    options.maxShapingAnchors ?? DEFAULT_LIBRARY_CORRIDOR_MAX_SHAPING_ANCHORS;
  const maxProbes = options.maxProbes ?? DEFAULT_LIBRARY_CORRIDOR_MAX_PROBES;
  const maxPerSource =
    options.maxPerSource ?? DEFAULT_LIBRARY_CORRIDOR_MAX_PER_SOURCE;

  if (
    !Number.isFinite(targetCorridorMeters) ||
    targetCorridorMeters <= 0 ||
    !Number.isFinite(minimumCorridorMeters) ||
    minimumCorridorMeters <= 0 ||
    minimumCorridorMeters > targetCorridorMeters ||
    !Number.isFinite(windowStepMeters) ||
    windowStepMeters <= 0 ||
    !Number.isSafeInteger(maxShapingAnchors) ||
    maxShapingAnchors < 2 ||
    maxShapingAnchors > MAX_CONFIGURED_SHAPING_ANCHORS ||
    !Number.isSafeInteger(maxProbes) ||
    maxProbes < 1 ||
    maxProbes > MAX_CONFIGURED_PROBES ||
    !Number.isSafeInteger(maxPerSource) ||
    maxPerSource < 1 ||
    maxPerSource > MAX_CONFIGURED_PER_SOURCE
  ) {
    return null;
  }

  return {
    targetCorridorMeters,
    minimumCorridorMeters,
    windowStepMeters,
    maxShapingAnchors,
    maxProbes,
    maxPerSource,
  };
}

function windowsFor(
  geometry: readonly Coordinate[],
  options: ResolvedProbeOptions,
): readonly CorridorWindow[] {
  if (!validLine(geometry)) return [];
  const cumulative = cumulativeMeters(geometry);
  const totalMeters = cumulative.at(-1) ?? 0;
  if (totalMeters + EPSILON < options.minimumCorridorMeters) return [];

  if (
    totalMeters <=
    options.targetCorridorMeters + options.minimumCorridorMeters / 2
  ) {
    return [
      {
        startIndex: 0,
        endIndex: geometry.length - 1,
        geometry: geometry.map(copyCoordinate),
        meters: totalMeters,
      },
    ];
  }

  const windows: CorridorWindow[] = [];
  const seen = new Set<string>();
  let targetStartMeters = 0;

  while (
    targetStartMeters <= totalMeters - options.minimumCorridorMeters + EPSILON &&
    windows.length < MAX_RAW_WINDOWS_PER_SOURCE
  ) {
    const startIndex = firstIndexAtOrAfter(cumulative, targetStartMeters);
    const startMeters = cumulative[startIndex] ?? 0;
    if (totalMeters - startMeters + EPSILON < options.minimumCorridorMeters) break;

    const desiredEndMeters = Math.min(
      totalMeters,
      startMeters + options.targetCorridorMeters,
    );
    const endIndex = Math.max(
      startIndex + 1,
      firstIndexAtOrAfter(cumulative, desiredEndMeters, startIndex + 1),
    );
    const boundedEndIndex = Math.min(endIndex, geometry.length - 1);
    const windowMeters =
      (cumulative[boundedEndIndex] ?? totalMeters) - startMeters;
    const key = String(startIndex) + ":" + String(boundedEndIndex);

    if (
      !seen.has(key) &&
      windowMeters + EPSILON >= options.minimumCorridorMeters
    ) {
      const windowGeometry = geometry
        .slice(startIndex, boundedEndIndex + 1)
        .map(copyCoordinate);
      if (validLine(windowGeometry)) {
        windows.push({
          startIndex,
          endIndex: boundedEndIndex,
          geometry: windowGeometry,
          meters: windowMeters,
        });
        seen.add(key);
      }
    }

    targetStartMeters += options.windowStepMeters;
  }

  return windows;
}

function sampleShapingAnchors(
  corridor: readonly Coordinate[],
  maximumAnchors: number,
): readonly Coordinate[] {
  if (!validLine(corridor)) return [];
  if (corridor.length <= maximumAnchors) return corridor.map(copyCoordinate);

  const cumulative = cumulativeMeters(corridor);
  const totalMeters = cumulative.at(-1) ?? 0;
  if (!(totalMeters > 0)) {
    return [copyCoordinate(corridor[0]!), copyCoordinate(corridor.at(-1)!)];
  }

  const indexes: number[] = [];
  for (let slot = 0; slot < maximumAnchors; slot += 1) {
    const targetMeters = (totalMeters * slot) / (maximumAnchors - 1);
    const index = firstIndexAtOrAfter(cumulative, targetMeters);
    if (indexes.at(-1) !== index) indexes.push(index);
  }
  if (indexes[0] !== 0) indexes.unshift(0);
  const lastIndex = corridor.length - 1;
  if (indexes.at(-1) !== lastIndex) indexes.push(lastIndex);

  const interior = indexes
    .filter((index) => index !== lastIndex)
    .slice(0, maximumAnchors - 1)
    .map((index) => copyCoordinate(corridor[index]!));
  return [...interior, copyCoordinate(corridor[lastIndex]!)];
}

function sourcePriority(source: LibraryCorridorSource): number | null {
  if (source.priority === undefined) return 0.5;
  return Number.isFinite(source.priority) &&
    source.priority >= 0 &&
    source.priority <= 1
    ? source.priority
    : null;
}

/**
 * First experiment compatibility.
 *
 * GraphHopper's current OpenGravel adapter turns discovery into round_trip,
 * which cannot carry shaping points. Existing stops/shaping/sketches/spans are
 * also rider-authored route truth; a library experiment must not silently
 * reorder or compete with them.
 */
export function libraryCorridorProbeIncompatibility(
  request: ProviderRouteRequest,
): string | null {
  if (request.discovery !== undefined) return "discovery-round-trip";
  if (request.stops.length > 0) return "authored-stops";
  if (request.shaping.length > 0) return "authored-shaping";
  if (request.sketch !== undefined) return "authored-sketch";
  if ((request.roadSpans?.length ?? 0) > 0) return "authored-road-spans";
  return null;
}

/**
 * Produces a deterministic, tiny search allocation from caller-approved library
 * lines. Ranking is deliberately not rider-visible route ranking:
 *
 * 1. explicit source priority, when supplied;
 * 2. less straight-line connector overhead per corridor metre;
 * 3. closer to the target corridor length;
 * 4. less absolute connector overhead;
 * 5. stable probe id.
 */
export function selectLibraryCorridorProbes(
  request: ProviderRouteRequest,
  sources: readonly LibraryCorridorSource[],
  options: LibraryCorridorProbeOptions = {},
): readonly LibraryCorridorProbe[] {
  if (libraryCorridorProbeIncompatibility(request) !== null) return [];
  const resolved = resolveOptions(options);
  if (resolved === null) return [];

  const directMeters = haversine(request.origin, request.destination);
  const probes: LibraryCorridorProbe[] = [];

  for (const source of sources) {
    if (source.id.trim().length === 0) continue;
    const priority = sourcePriority(source);
    if (priority === null) continue;

    for (const window of windowsFor(source.geometry, resolved)) {
      const forwardStart = window.geometry[0];
      const forwardEnd = window.geometry.at(-1);
      if (forwardStart === undefined || forwardEnd === undefined) continue;

      const forwardConnector =
        haversine(request.origin, forwardStart) +
        haversine(forwardEnd, request.destination);
      const reverseConnector =
        haversine(request.origin, forwardEnd) +
        haversine(forwardStart, request.destination);
      const reverse = reverseConnector + EPSILON < forwardConnector;
      const corridor = reverse
        ? [...window.geometry].reverse().map(copyCoordinate)
        : window.geometry.map(copyCoordinate);
      const connectorMeters = reverse ? reverseConnector : forwardConnector;
      const shaping = sampleShapingAnchors(corridor, resolved.maxShapingAnchors);
      if (shaping.length < 2) continue;

      const direction = reverse ? "reverse" : "forward";
      probes.push({
        id:
          source.id +
          ":" +
          String(window.startIndex) +
          "-" +
          String(window.endIndex) +
          ":" +
          direction,
        sourceId: source.id,
        sourcePriority: priority,
        sourceStartIndex: window.startIndex,
        sourceEndIndex: window.endIndex,
        direction,
        corridor,
        shaping,
        corridorMeters: window.meters,
        connectorMeters,
        connectorToCorridorRatio:
          connectorMeters / Math.max(window.meters, 1),
        detourProxyMeters: Math.max(
          0,
          connectorMeters + window.meters - Math.max(0, directMeters),
        ),
      });
    }
  }

  probes.sort((left, right) => {
    if (left.sourcePriority !== right.sourcePriority) {
      return right.sourcePriority - left.sourcePriority;
    }
    if (left.connectorToCorridorRatio !== right.connectorToCorridorRatio) {
      return left.connectorToCorridorRatio - right.connectorToCorridorRatio;
    }
    const leftLengthMiss = Math.abs(
      left.corridorMeters - resolved.targetCorridorMeters,
    );
    const rightLengthMiss = Math.abs(
      right.corridorMeters - resolved.targetCorridorMeters,
    );
    if (leftLengthMiss !== rightLengthMiss) return leftLengthMiss - rightLengthMiss;
    if (left.connectorMeters !== right.connectorMeters) {
      return left.connectorMeters - right.connectorMeters;
    }
    return left.id.localeCompare(right.id);
  });

  const selected: LibraryCorridorProbe[] = [];
  const perSource = new Map<string, number>();
  for (const probe of probes) {
    if (selected.length >= resolved.maxProbes) break;
    const count = perSource.get(probe.sourceId) ?? 0;
    if (count >= resolved.maxPerSource) continue;
    selected.push(probe);
    perSource.set(probe.sourceId, count + 1);
  }
  return selected;
}

/**
 * Converts one probe into the exact provider-neutral request the current
 * GraphHopper adapter already understands. Alternatives are disabled because a
 * shaped request has more than two wire points, and GraphHopper alternative
 * routing is a two-point algorithm.
 */
export function applyLibraryCorridorProbe(
  request: ProviderRouteRequest,
  probe: LibraryCorridorProbe,
): ProviderRouteRequest | null {
  if (libraryCorridorProbeIncompatibility(request) !== null) return null;
  if (probe.shaping.length < 2 || !probe.shaping.every(validCoordinate)) return null;

  return {
    ...request,
    shaping: probe.shaping.map(copyCoordinate),
    options: {
      ...request.options,
      includeAlternatives: false,
    },
  };
}

/**
 * Measures whether the engine actually recovered the source corridor.
 *
 * A probe that only crosses the source at one junction receives approximately
 * zero overlap. The result is experiment evidence, not legal/access evidence
 * and not a route score.
 */
export function assessLibraryCorridorAdherence(
  route: readonly Coordinate[],
  probe: LibraryCorridorProbe,
  toleranceMeters = 35,
): LibraryCorridorAdherence | null {
  if (
    !validLine(route) ||
    !validLine(probe.corridor) ||
    !Number.isFinite(toleranceMeters) ||
    toleranceMeters <= 0
  ) {
    return null;
  }

  const overlap = lineOverlap(
    indexRoute(route),
    probe.corridor,
    toleranceMeters,
  );
  if (!(overlap.lineMeters > 0)) return null;

  return {
    corridorMeters: overlap.lineMeters,
    riddenMeters: overlap.riddenMeters,
    share: overlap.riddenMeters / overlap.lineMeters,
  };
}

/** Exposed for experiment reports; never use this as a provider ETA. */
export function libraryCorridorLengthMeters(
  corridor: readonly Coordinate[],
): number | null {
  if (!validLine(corridor)) return null;
  const meters = lineMeters(corridor);
  return meters > 0 ? meters : null;
}
