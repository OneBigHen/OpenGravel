/**
 * Route evidence from the routing engine's own road attributes (M3, OGV-D-263).
 *
 * The engine already knows, per edge, the OSM surface tag, the road class and a
 * curvature ratio. Before M3 none of it reached a card, so every route read
 * "Surface unknown" and curvature was guessed from the drawn line. This module
 * is the one place that decides what those raw values mean:
 *
 * - **surface** — a tagged edge is its tag; an *untagged* edge on a numbered or
 *   town road (motorway … tertiary, residential) is counted as paved but kept
 *   apart as `inferredPavedMeters`, because in PA/NJ those are paved and a
 *   rider deserves the estimate — while an untagged unclassified road, service
 *   road or track stays unknown, since that is exactly where gravel hides;
 * - **road class** — the backroad share is the metres off the arterial network;
 * - **curvature** — the share of metres ridden through bends, measured on the
 *   route line (`bendMeters`, UX rework 2); an engine without it falls back to
 *   the metres on edges whose straight-line/road-length ratio is at or below
 *   `CURVY_RATIO`.
 *
 * Status is always `estimated`: OSM is a good source, not a survey.
 */

import type { ProviderRoadSummary } from "@/application/planner/route-provider";
import type { EvidenceSource, EvidenceValue } from "@/domain/evidence/types";
import type { SurfaceIntent } from "@/domain/ride/types";
import type { RouteEvidence } from "@/domain/route/types";

type SurfacePreference = SurfaceIntent["preference"];

const PAVED_TAGS = new Set(["asphalt", "concrete", "paved", "paving_stones", "sett", "cobblestone", "chipseal", "metal", "wood"]);
const GRAVEL_TAGS = new Set(["compacted", "fine_gravel", "gravel", "pebblestone"]);
const DIRT_TAGS = new Set(["unpaved", "ground", "dirt", "earth", "grass", "sand", "mud", "rock"]);
/** Untagged edges of these classes are counted as (inferred) paved. */
const PAVED_BY_CLASS = new Set(["motorway", "trunk", "primary", "secondary", "tertiary", "residential"]);
/** The arterial network; everything else is a backroad. */
const ARTERIAL_CLASSES = new Set(["motorway", "trunk", "primary"]);

/** An edge this bent or more counts as a curve (`1` is dead straight). */
export const CURVY_RATIO = 0.9;
/** A route with this share of curvy metres scores as fully curvy. */
const FULLY_CURVY_SHARE = 0.5;
/**
 * The same for the line-measured bends: Old Mine Road, about as twisty as a
 * paved road gets around here, measures 19%.
 */
const FULLY_BENDY_SHARE = 0.2;
/** Tagged OSM surface; an inferred share lowers it toward `INFERRED_CONFIDENCE`. */
const TAGGED_CONFIDENCE = 0.8;
const INFERRED_CONFIDENCE = 0.55;

const OSM_SURFACE_SOURCE: EvidenceSource = {
  id: "osm",
  label: "OpenStreetMap surface and road tags",
  category: "osm",
  authoritativeFor: ["surface"],
};
const OSM_ROAD_SOURCE: EvidenceSource = {
  id: "osm-roads",
  label: "OpenStreetMap road classes",
  category: "osm",
};
const OSM_CURVATURE_SOURCE: EvidenceSource = {
  id: "osm-curvature",
  label: "Road geometry from OpenStreetMap",
  category: "osm",
};

/** The `surfaceMix` value this module writes. `surface` is the dominant class. */
export interface EngineSurfaceMix {
  readonly surface: "paved" | "gravel" | "dirt" | "unknown";
  readonly pavedMeters: number;
  /** Part of `pavedMeters` that is inferred from the road class, not tagged. */
  readonly inferredPavedMeters: number;
  readonly gravelMeters: number;
  readonly dirtMeters: number;
  readonly unknownMeters: number;
  /** How well the mix fits the rider's surface preference, `0..1` (scoring reads it). */
  readonly unit: number;
  /** Where each surface is, in travel order, as `[metres, surface]` runs; absent from older answers. */
  readonly runs?: readonly (readonly [number, SurfaceRunKind])[];
}

export type SurfaceRunKind = "paved" | "gravel" | "dirt" | "unknown";

/** At most this many runs are kept; shorter ones fold into their neighbour. */
const MAX_SURFACE_RUNS = 120;

/**
 * The provider's keyed runs as surface classes, merged, with slivers folded
 * into the run before them so a long ride stays a few dozen runs.
 */
function classifyRuns(runs: readonly (readonly [number, string])[], totalMeters: number): readonly (readonly [number, SurfaceRunKind])[] {
  const minimum = Math.max(40, totalMeters / (MAX_SURFACE_RUNS * 2));
  const merged: [number, SurfaceRunKind][] = [];
  for (const [meters, key] of runs) {
    if (!(meters > 0)) continue;
    const [tag = "missing", roadClass = "missing"] = key.split("|");
    const kind = classifySurface(tag, roadClass);
    const surface: SurfaceRunKind = kind === "inferred" ? "paved" : kind;
    const last = merged[merged.length - 1];
    if (last !== undefined && (last[1] === surface || meters < minimum)) last[0] += meters;
    else merged.push([meters, surface]);
  }
  return merged.slice(0, MAX_SURFACE_RUNS).map(([meters, surface]) => [Math.round(meters), surface] as const);
}

export interface EngineCurvature {
  readonly curvyMeters: number;
  readonly totalMeters: number;
  readonly unit: number;
  /**
   * Sustained-bend diagnostics from the returned geometry. Null means an older
   * provider answer did not carry the continuity measurement.
   */
  readonly longestRunMeters?: number;
  readonly runCount?: number;
  /** Longest run / all bend metres, 0..1; absent when continuity is unavailable. */
  readonly continuityShare?: number;
}

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}

function classifySurface(tag: string, roadClass: string): "paved" | "inferred" | "gravel" | "dirt" | "unknown" {
  if (PAVED_TAGS.has(tag)) return "paved";
  if (GRAVEL_TAGS.has(tag)) return "gravel";
  if (DIRT_TAGS.has(tag)) return "dirt";
  if (tag === "missing" && PAVED_BY_CLASS.has(roadClass)) return "inferred";
  return "unknown";
}

/**
 * How well an unpaved share fits a preference: Paved wants none, Mostly paved
 * tolerates up to 20 %, Mixed (the default) takes anything up to half, Dirt OK
 * wants more.
 */
export function surfaceFit(preference: SurfacePreference, unpavedShare: number): number {
  switch (preference) {
    case "pavement":
      return clamp01(1 - unpavedShare * 5);
    case "mostly-pavement":
      return clamp01(1 - Math.max(0, unpavedShare - 0.2) * 2.5);
    case "mixed":
      return clamp01(1 - Math.max(0, unpavedShare - 0.5) * 2);
    case "dirt-preferred":
      return clamp01(unpavedShare * 2);
  }
}

export function engineSurfaceMix(
  summary: ProviderRoadSummary,
  preference: SurfacePreference,
): EngineSurfaceMix {
  let pavedMeters = 0;
  let inferredPavedMeters = 0;
  let gravelMeters = 0;
  let dirtMeters = 0;
  let unknownMeters = 0;
  for (const [key, meters] of Object.entries(summary.surfaceByRoadClassMeters)) {
    const [tag = "missing", roadClass = "missing"] = key.split("|");
    switch (classifySurface(tag, roadClass)) {
      case "paved":
        pavedMeters += meters;
        break;
      case "inferred":
        pavedMeters += meters;
        inferredPavedMeters += meters;
        break;
      case "gravel":
        gravelMeters += meters;
        break;
      case "dirt":
        dirtMeters += meters;
        break;
      case "unknown":
        unknownMeters += meters;
        break;
    }
  }
  const known = pavedMeters + gravelMeters + dirtMeters;
  const unpavedShare = known > 0 ? (gravelMeters + dirtMeters) / known : 0;
  const dominant = known === 0
    ? "unknown"
    : pavedMeters >= gravelMeters && pavedMeters >= dirtMeters
      ? "paved"
      : gravelMeters >= dirtMeters
        ? "gravel"
        : "dirt";
  return {
    surface: dominant,
    pavedMeters,
    inferredPavedMeters,
    gravelMeters,
    dirtMeters,
    unknownMeters,
    unit: surfaceFit(preference, unpavedShare),
    ...(summary.surfaceRuns === undefined || summary.surfaceRuns.length === 0
      ? {}
      : { runs: classifyRuns(summary.surfaceRuns, summary.totalMeters) }),
  };
}

export function engineCurvature(summary: ProviderRoadSummary): EngineCurvature {
  if (summary.bendMeters !== undefined && Number.isFinite(summary.bendMeters) && summary.totalMeters > 0) {
    const bends = Math.max(0, summary.bendMeters);
    const longestRunMeters =
      summary.longestBendRunMeters !== undefined &&
      Number.isFinite(summary.longestBendRunMeters)
        ? Math.max(0, summary.longestBendRunMeters)
        : null;
    const runCount =
      summary.bendRunCount !== undefined &&
      Number.isSafeInteger(summary.bendRunCount) &&
      summary.bendRunCount >= 0
        ? summary.bendRunCount
        : null;
    return {
      curvyMeters: bends,
      totalMeters: summary.totalMeters,
      unit: clamp01(bends / summary.totalMeters / FULLY_BENDY_SHARE),
      ...(longestRunMeters === null ? {} : { longestRunMeters }),
      ...(runCount === null ? {} : { runCount }),
      ...(longestRunMeters === null || !(bends > 0)
        ? {}
        : { continuityShare: clamp01(longestRunMeters / bends) }),
    };
  }
  let curvyMeters = 0;
  let measured = 0;
  for (const [ratio, meters] of Object.entries(summary.curvatureMeters)) {
    const value = Number(ratio);
    if (!Number.isFinite(value)) continue;
    measured += meters;
    if (value <= CURVY_RATIO + 1e-9) curvyMeters += meters;
  }
  return {
    curvyMeters,
    totalMeters: measured,
    unit: measured > 0 ? clamp01(curvyMeters / measured / FULLY_CURVY_SHARE) : 0,
  };
}

/** The backroad share: metres off motorways, trunks and primaries. */
export function backroadShare(summary: ProviderRoadSummary): number | null {
  let backroad = 0;
  let measured = 0;
  for (const [key, meters] of Object.entries(summary.surfaceByRoadClassMeters)) {
    const roadClass = key.split("|")[1] ?? "missing";
    if (roadClass === "missing") continue;
    measured += meters;
    if (!ARTERIAL_CLASSES.has(roadClass)) backroad += meters;
  }
  return measured > 0 ? backroad / measured : null;
}

/**
 * The evidence entries the engine's road attributes support. A summary that
 * describes nothing contributes nothing, so the pipeline's own "unknown"
 * defaults stand.
 */
export function engineRoadEvidence(
  summary: ProviderRoadSummary | undefined,
  preference: SurfacePreference,
): RouteEvidence {
  if (summary === undefined || !(summary.totalMeters > 0)) return {};
  const evidence: Record<string, EvidenceValue<unknown>> = {};

  const mix = engineSurfaceMix(summary, preference);
  const known = mix.pavedMeters + mix.gravelMeters + mix.dirtMeters;
  if (known > 0) {
    const inferredShare = mix.inferredPavedMeters / known;
    evidence["surfaceMix"] = {
      value: mix,
      status: "estimated",
      confidence: Number((TAGGED_CONFIDENCE - (TAGGED_CONFIDENCE - INFERRED_CONFIDENCE) * inferredShare).toFixed(3)),
      coverage: clamp01(known / summary.totalMeters),
      provenance: [OSM_SURFACE_SOURCE],
    };
  }

  const backroads = backroadShare(summary);
  if (backroads !== null) {
    evidence["roadClassMix"] = {
      value: Number(backroads.toFixed(3)),
      status: "estimated",
      confidence: 0.8,
      provenance: [OSM_ROAD_SOURCE],
    };
  }

  const curvature = engineCurvature(summary);
  if (curvature.totalMeters > 0) {
    evidence["curvature"] = {
      value: curvature,
      status: "estimated",
      confidence: 0.7,
      coverage: clamp01(curvature.totalMeters / summary.totalMeters),
      provenance: [OSM_CURVATURE_SOURCE],
    };
  }
  return evidence;
}

function isEngineSurfaceMix(value: unknown): value is EngineSurfaceMix {
  if (typeof value !== "object" || value === null) return false;
  const record = value as Record<string, unknown>;
  return ["pavedMeters", "gravelMeters", "dirtMeters", "unknownMeters"].every(
    (key) => typeof record[key] === "number" && Number.isFinite(record[key]),
  );
}

const METERS_PER_MILE = 1609.344;

function miles(meters: number): string {
  const value = meters / METERS_PER_MILE;
  return `${value >= 10 ? Math.round(value) : Number(value.toFixed(1))} mi`;
}

/**
 * The card's one-line surface: `Paved`, `Mostly paved · 2.1 mi gravel`,
 * `Mixed · 14 mi unpaved`, `Mostly unpaved`. `null` when the evidence is not an
 * engine mix or measured nothing, so the caller keeps its band badge.
 */
export function surfaceMixLabel(evidence: EvidenceValue<unknown> | undefined): string | null {
  if (evidence === undefined || !isEngineSurfaceMix(evidence.value)) return null;
  const mix = evidence.value;
  const unpaved = mix.gravelMeters + mix.dirtMeters;
  const known = mix.pavedMeters + unpaved;
  if (known <= 0) return null;
  const share = unpaved / known;
  const unpavedWord = mix.dirtMeters > mix.gravelMeters ? "dirt" : "gravel";
  // Under ~0.1 mi of unpaved is a driveway, not a surface a rider plans for.
  if (unpaved < 160) return "Paved";
  if (share <= 0.2) return `Mostly paved · ${miles(unpaved)} ${unpavedWord}`;
  if (share < 0.6) return `Mixed · ${miles(unpaved)} unpaved`;
  return `Mostly unpaved · ${miles(unpaved)} ${unpavedWord}`;
}

/** `12 mi of curves`, or `null` when curvature was not measured by the engine. */
export function curvatureLabel(evidence: EvidenceValue<unknown> | undefined): string | null {
  if (evidence === undefined || typeof evidence.value !== "object" || evidence.value === null) return null;
  const value = evidence.value as Record<string, unknown>;
  const curvy = value["curvyMeters"];
  if (typeof curvy !== "number" || !Number.isFinite(curvy)) return null;
  if (curvy < 800) return "Few curves";
  return `${miles(curvy)} of curves`;
}

/** The rider-facing curviness steps, 1 (straight) to 5 (twisty). */
export const CURVINESS_LABELS = ["Straight", "A few bends", "Curvy", "Very curvy", "Twisty"] as const;

/**
 * Curviness as a 1–5 step from the share of the line ridden through bends
 * (UX rework phase 3, recut for the line-measured bends in rework 2), or
 * `null` when curvature was not measured. The steps follow how riders
 * describe the reference roads: I-76 (2%) is Straight, suburban arterials
 * (4–5%) have A few bends, Hawk Mountain (9%) is Curvy, River Road and the
 * Water Gap (13%) are Very curvy, Old Mine Road (19%) is Twisty.
 */
export function curvinessLevel(evidence: EvidenceValue<unknown> | undefined): 1 | 2 | 3 | 4 | 5 | null {
  if (evidence === undefined || typeof evidence.value !== "object" || evidence.value === null) return null;
  const value = evidence.value as Record<string, unknown>;
  const curvy = value["curvyMeters"];
  const total = value["totalMeters"];
  if (typeof curvy !== "number" || typeof total !== "number" || !Number.isFinite(curvy) || !(total > 0)) return null;
  const share = curvy / total;
  if (share < 0.03) return 1;
  if (share < 0.07) return 2;
  if (share < 0.11) return 3;
  if (share < 0.16) return 4;
  return 5;
}

/** Surface shares for the card's strip, or `null` when the mix is not an engine mix. */
export function surfaceShares(
  evidence: EvidenceValue<unknown> | undefined,
): { readonly paved: number; readonly gravel: number; readonly dirt: number; readonly unknown: number } | null {
  if (evidence === undefined || !isEngineSurfaceMix(evidence.value)) return null;
  const mix = evidence.value;
  const total = mix.pavedMeters + mix.gravelMeters + mix.dirtMeters + mix.unknownMeters;
  if (!(total > 0)) return null;
  return {
    paved: mix.pavedMeters / total,
    gravel: mix.gravelMeters / total,
    dirt: mix.dirtMeters / total,
    unknown: mix.unknownMeters / total,
  };
}

/** One stretch of the surface strip, as shares of the line (`from`, `to` in `0..1`). */
export interface SurfaceRun {
  readonly kind: SurfaceRunKind;
  readonly from: number;
  readonly to: number;
}

/** The surface along the line for the elevation strip, or `null` when the answer carries no runs. */
export function surfaceRuns(evidence: EvidenceValue<unknown> | undefined): readonly SurfaceRun[] | null {
  if (evidence === undefined || !isEngineSurfaceMix(evidence.value)) return null;
  const runs = evidence.value.runs;
  if (!Array.isArray(runs) || runs.length === 0) return null;
  const total = runs.reduce((sum, [meters]) => sum + meters, 0);
  if (!(total > 0)) return null;
  const out: SurfaceRun[] = [];
  let walked = 0;
  for (const [meters, kind] of runs) {
    out.push({ kind, from: walked / total, to: (walked + meters) / total });
    walked += meters;
  }
  return out;
}
