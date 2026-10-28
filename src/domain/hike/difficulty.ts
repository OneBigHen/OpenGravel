/**
 * Difficulty from measured numbers, with the unknowns kept visible
 * (HIKE-MODE-PLAN H1 item 6, truth rules).
 *
 * A rating is the hardest thing the mapped numbers require. A missing surface
 * or SAC mix can never lower it, and it can never leave the answer "easy":
 * when the mapped evidence only supports easy but a part of the trail was never
 * described, the rating is `unknown`. The parts carry their own numbers so the
 * UI can say which measurement drove the answer.
 *
 * Surface class alone does not raise hiking difficulty — dirt is the normal
 * surface of a trail, and rock scrambling is described by `sac_scale` — but an
 * unmapped surface withholds "easy" all the same.
 */

import type { SurfaceClass } from "../roads/surface";
import type {
  HikeBandMeters,
  HikeElevationCoverage,
  HikeSacBand,
  HikeSacMix,
  HikeSacScale,
  HikeStats,
  HikeSurfaceMix,
} from "./types";
import { HIKE_SAC_BANDS } from "./types";

export type HikeDifficultyRating = "easy" | "moderate" | "hard" | "unknown";
export type HikeDifficultyPartName =
  | "length"
  | "gain"
  | "max-grade"
  | "surface"
  | "sac-scale";

export interface HikeDifficultyPart {
  readonly part: HikeDifficultyPartName;
  readonly rating: HikeDifficultyRating;
  readonly explanation: string;
}

export interface HikeDifficulty {
  readonly rating: HikeDifficultyRating;
  /** One part per input; `unknown` parts are the ones with no usable data. */
  readonly parts: readonly HikeDifficultyPart[];
  readonly unknownParts: readonly HikeDifficultyPartName[];
  readonly explanation: string;
}

/** Thresholds, exported so tests and copy quote the same numbers. */
export const DIFFICULTY_LIMITS = {
  /**
   * A property is "known" only when this share of the described distance has
   * it. Below this, a hidden half could be much harder, so it stays unknown.
   */
  knownShare: 0.6,
  lengthModerateMeters: 8_000,
  lengthHardMeters: 16_000,
  gainModerateMeters: 300,
  gainHardMeters: 900,
  gradeModeratePercent: 15,
  gradeHardPercent: 30,
} as const;

const SURFACE_BANDS: readonly SurfaceClass[] = ["paved", "gravel", "dirt", "unknown"];

const SAC_T_GRADES: Readonly<Record<HikeSacScale, number>> = {
  hiking: 1,
  "mountain-hiking": 2,
  "demanding-mountain-hiking": 3,
  "alpine-hiking": 4,
  "demanding-alpine-hiking": 5,
  "difficult-alpine-hiking": 6,
};

const SAC_LABELS: Readonly<Record<HikeSacScale, string>> = {
  hiking: "T1 hiking",
  "mountain-hiking": "T2 mountain hiking",
  "demanding-mountain-hiking": "T3 demanding mountain hiking",
  "alpine-hiking": "T4 alpine hiking",
  "demanding-alpine-hiking": "T5 demanding alpine hiking",
  "difficult-alpine-hiking": "T6 difficult alpine hiking",
};

/** SAC T-grade for a band; null for "unknown". */
export function sacGrade(band: HikeSacBand): number | null {
  return band === "unknown" ? null : SAC_T_GRADES[band];
}

/**
 * Normalises an OSM `sac_scale` label (or a T1–T6 grade) to a band. An
 * unrecognised label is "unknown", never the easiest grade.
 */
export function normalizeSacScale(value: string | null | undefined): HikeSacBand {
  if (value === null || value === undefined) return "unknown";
  const normalised = value.trim().toLowerCase().replace(/_/g, "-");
  const grade = /^t([1-6])$/.exec(normalised);
  if (grade !== null) {
    const tGrade = Number(grade[1]);
    const match = (Object.entries(SAC_T_GRADES) as [HikeSacScale, number][]).find(
      ([, gradeValue]) => gradeValue === tGrade,
    );
    return match === undefined ? "unknown" : match[0];
  }
  return (HIKE_SAC_BANDS as readonly string[]).includes(normalised)
    ? (normalised as HikeSacBand)
    : "unknown";
}

function emptyMix<Band extends string>(bands: readonly Band[]): Record<Band, number> {
  const mix = {} as Record<Band, number>;
  for (const band of bands) mix[band] = 0;
  return mix;
}

function assertMeters(entry: { readonly meters: number }, label: string): void {
  if (!Number.isFinite(entry.meters) || entry.meters < 0) {
    throw new TypeError(`${label} metres must be a finite non-negative number`);
  }
}

/** Sums metres per SAC band; duplicates add, negatives and unknown bands throw. */
export function buildSacMix(entries: readonly HikeBandMeters<HikeSacBand>[]): HikeSacMix {
  const mix = emptyMix(HIKE_SAC_BANDS);
  for (const entry of entries) {
    if (!(HIKE_SAC_BANDS as readonly string[]).includes(entry.band)) {
      throw new TypeError(`unknown SAC band ${String(entry.band)}`);
    }
    assertMeters(entry, `SAC band ${entry.band}`);
    mix[entry.band] += entry.meters;
  }
  return mix;
}

/** Sums metres per surface class; duplicates add, negatives and unknown bands throw. */
export function buildSurfaceMix(
  entries: readonly HikeBandMeters<SurfaceClass>[],
): HikeSurfaceMix {
  const mix = emptyMix(SURFACE_BANDS);
  for (const entry of entries) {
    if (!SURFACE_BANDS.includes(entry.band)) {
      throw new TypeError(`unknown surface band ${String(entry.band)}`);
    }
    assertMeters(entry, `surface band ${entry.band}`);
    mix[entry.band] += entry.meters;
  }
  return mix;
}

function totalMeters(mix: Readonly<Record<string, number>>): number {
  let total = 0;
  for (const meters of Object.values(mix)) total += meters;
  return total;
}

function knownShareOfMixed(
  mix: Readonly<Record<string, number>>,
  unknownBand: string,
): { readonly knownShare: number; readonly total: number } {
  const total = totalMeters(mix);
  const unknownMeters = mix[unknownBand] ?? 0;
  return {
    knownShare: total > 0 ? (total - unknownMeters) / total : 0,
    total,
  };
}

const RATING_INDEX: Readonly<Record<Exclude<HikeDifficultyRating, "unknown">, number>> = {
  easy: 0,
  moderate: 1,
  hard: 2,
};

const RATING_LABELS: Readonly<Record<HikeDifficultyRating, string>> = {
  easy: "Easy",
  moderate: "Moderate",
  hard: "Hard",
  unknown: "Unknown",
};

function ratingFromIndex(index: number): HikeDifficultyRating {
  if (index >= RATING_INDEX.hard) return "hard";
  if (index >= RATING_INDEX.moderate) return "moderate";
  return "easy";
}

function percent(value: number): string {
  return `${Math.round(value)}%`;
}

function share(value: number): string {
  return `${Math.round(value * 100)}%`;
}

function lengthPart(stats: HikeStats): HikeDifficultyPart {
  const meters = stats.lengthMeters;
  if (!(meters > 0)) {
    return { part: "length", rating: "unknown", explanation: "the line has no measurable distance" };
  }
  const kilometres = (meters / 1000).toFixed(1);
  let rating: HikeDifficultyRating = "easy";
  if (meters >= DIFFICULTY_LIMITS.lengthHardMeters) rating = "hard";
  else if (meters >= DIFFICULTY_LIMITS.lengthModerateMeters) rating = "moderate";
  return { part: "length", rating, explanation: `${kilometres} km` };
}

function elevationKnown(stats: HikeStats): boolean {
  return (
    (stats.gainMeters !== null || stats.lossMeters !== null) &&
    stats.elevation.measuredLengthShare >= DIFFICULTY_LIMITS.knownShare
  );
}

function gainPart(stats: HikeStats, elevation: HikeElevationCoverage): HikeDifficultyPart {
  if (!elevationKnown(stats) || stats.gainMeters === null) {
    return {
      part: "gain",
      rating: "unknown",
      explanation: `elevation gain is unknown (a DEM profile covers ${share(elevation.measuredLengthShare)} of the line)`,
    };
  }
  const gain = Math.round(stats.gainMeters);
  let rating: HikeDifficultyRating = "easy";
  if (stats.gainMeters >= DIFFICULTY_LIMITS.gainHardMeters) rating = "hard";
  else if (stats.gainMeters >= DIFFICULTY_LIMITS.gainModerateMeters) rating = "moderate";
  const coverage =
    elevation.measuredLengthShare < 1
      ? ` (measured on ${share(elevation.measuredLengthShare)} of the line)`
      : "";
  return { part: "gain", rating, explanation: `${gain} m gain${coverage}` };
}

function maxGradePart(stats: HikeStats, elevation: HikeElevationCoverage): HikeDifficultyPart {
  if (!elevationKnown(stats) || stats.maxGrade === null) {
    return {
      part: "max-grade",
      rating: "unknown",
      explanation: `the steepest grade is unknown (a DEM profile covers ${share(elevation.measuredLengthShare)} of the line)`,
    };
  }
  const grade = Math.abs(stats.maxGrade.percent);
  let rating: HikeDifficultyRating = "easy";
  if (grade >= DIFFICULTY_LIMITS.gradeHardPercent) rating = "hard";
  else if (grade >= DIFFICULTY_LIMITS.gradeModeratePercent) rating = "moderate";
  return {
    part: "max-grade",
    rating,
    explanation: `worst grade about ${percent(grade)} ${stats.maxGrade.direction}`,
  };
}

function dominantBand<Band extends string>(
  mix: Readonly<Record<Band, number>>,
  bands: readonly Band[],
): { readonly band: Band; readonly meters: number } | null {
  let best: { band: Band; meters: number } | null = null;
  for (const band of bands) {
    const meters = mix[band];
    if (meters <= 0) continue;
    if (best === null || meters > best.meters) best = { band, meters };
  }
  return best;
}

function surfacePart(surfaceMix: HikeSurfaceMix | null): HikeDifficultyPart {
  if (surfaceMix === null) {
    return {
      part: "surface",
      rating: "unknown",
      explanation: "the surface was not mapped",
    };
  }
  const { knownShare, total } = knownShareOfMixed(surfaceMix, "unknown");
  if (total <= 0 || knownShare < DIFFICULTY_LIMITS.knownShare) {
    return {
      part: "surface",
      rating: "unknown",
      explanation: `the surface is unknown for ${share(total > 0 ? 1 - knownShare : 1)} of the line`,
    };
  }
  const knownSurfaceBands: readonly SurfaceClass[] = ["paved", "gravel", "dirt"];
  const dominant = dominantBand(surfaceMix, knownSurfaceBands);
  const label = dominant === null ? "mapped" : dominant.band;
  return {
    part: "surface",
    rating: "easy",
    explanation: `surface mapped for ${share(knownShare)} of the line (mostly ${label})`,
  };
}

function sacPart(sacMix: HikeSacMix): HikeDifficultyPart {
  const { knownShare, total } = knownShareOfMixed(sacMix, "unknown");
  if (total <= 0 || knownShare < DIFFICULTY_LIMITS.knownShare) {
    return {
      part: "sac-scale",
      rating: "unknown",
      explanation: `the SAC scale is unknown for ${share(total > 0 ? 1 - knownShare : 1)} of the line`,
    };
  }
  // The hardest mapped step decides: a short scrambling move is still a
  // scrambling move, so it is not averaged away.
  let hardest: HikeSacScale | null = null;
  for (const band of HIKE_SAC_BANDS) {
    if (band === "unknown" || sacMix[band] <= 0) continue;
    if (hardest === null || SAC_T_GRADES[band] > SAC_T_GRADES[hardest]) hardest = band;
  }
  if (hardest === null) {
    return {
      part: "sac-scale",
      rating: "unknown",
      explanation: "no SAC grade covers any mapped distance",
    };
  }
  const grade = SAC_T_GRADES[hardest];
  const rating: HikeDifficultyRating = grade <= 1 ? "easy" : grade === 2 ? "moderate" : "hard";
  return {
    part: "sac-scale",
    rating,
    explanation: `SAC ${SAC_LABELS[hardest]} on ${share(sacMix[hardest] / total)} of the line`,
  };
}

/**
 * Rates difficulty from measured numbers.
 *
 * @param stats measured line/DEM numbers (`computeHikeStats`).
 * @param sacMix metres per SAC band; an empty mix means no SAC data.
 * @param surfaceMix metres per surface class; null means the surface is unmapped.
 */
export function difficultyFromNumbers(
  stats: HikeStats,
  sacMix: HikeSacMix,
  surfaceMix: HikeSurfaceMix | null = null,
): HikeDifficulty {
  const parts: HikeDifficultyPart[] = [
    lengthPart(stats),
    gainPart(stats, stats.elevation),
    maxGradePart(stats, stats.elevation),
    surfacePart(surfaceMix),
    sacPart(sacMix),
  ];

  let hardestIndex = -1;
  for (const part of parts) {
    if (part.rating === "unknown") continue;
    hardestIndex = Math.max(hardestIndex, RATING_INDEX[part.rating]);
  }
  const unknownParts = parts
    .filter((part) => part.rating === "unknown")
    .map((part) => part.part);

  let rating: HikeDifficultyRating;
  if (hardestIndex < 0) {
    rating = "unknown";
  } else if (hardestIndex === RATING_INDEX.easy && unknownParts.length > 0) {
    // The mapped parts only support "easy", but a part of the trail was never
    // described. It could be easy; we do not know, and we do not say easy.
    rating = "unknown";
  } else {
    rating = ratingFromIndex(hardestIndex);
  }

  const known = parts.filter((part) => part.rating !== "unknown");
  const unknown = parts.filter((part) => part.rating === "unknown");
  let explanation: string;
  if (rating === "unknown") {
    explanation = `Difficulty unknown: ${unknown
      .map((part) => part.explanation)
      .join("; ")}.`;
  } else if (unknown.length > 0) {
    explanation = `${RATING_LABELS[rating]}: ${known
      .map((part) => part.explanation)
      .join(", ")}. Still unknown: ${unknown
      .map((part) => part.explanation)
      .join("; ")}.`;
  } else {
    explanation = `${RATING_LABELS[rating]}: ${known
      .map((part) => part.explanation)
      .join(", ")}.`;
  }

  return { rating, parts, unknownParts, explanation };
}
