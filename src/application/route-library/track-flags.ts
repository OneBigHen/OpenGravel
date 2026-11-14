/**
 * The three track sanity flags (plan section 5.1 stage 4). They are flags, not
 * deletions: a flagged track is still shown, and a rough one offers neither
 * "Follow this track" nor "Ride this". Every threshold is a named constant so
 * the report and the review can point at one number.
 */

/** Fewer than this many source points per 30 miles is too sparse to trust. */
export const ROUGH_POINTS_PER_30_MILES = 20;
/** A gap longer than this between two points of one track is a jump, not a road. */
export const ROUGH_JUMP_MILES = 3;
/** Tracks this old and older carry "Track from <year>. Check roads first." */
export const OLD_TRACK_YEAR = 2015;
/** Measured miles off the source's stated miles by more than this share. */
export const MISMATCH_FRACTION = 0.4;

export interface RoughTrackInput {
  /** Measured miles along the line; `null` when there is no line. */
  readonly miles: number | null;
  /** Points in the source track before simplifying. */
  readonly rawPoints: number | null;
  /** Longest gap between two neighbouring points; a bundle reports 0. */
  readonly longestJumpMiles: number | null;
  readonly bundle: boolean;
}

/**
 * `rough` when the track is sparser than `ROUGH_POINTS_PER_30_MILES`, or when a
 * single ride jumps more than `ROUGH_JUMP_MILES` between points. A bundle keeps
 * its separate trail segments, so its segment joins are not jumps.
 */
export function isRoughTrack(input: RoughTrackInput): boolean {
  const { miles, rawPoints, longestJumpMiles, bundle } = input;
  if (miles === null || miles <= 0) return false;
  const pointsPer30 = rawPoints === null ? null : rawPoints / (miles / 30);
  const tooSparse = pointsPer30 !== null && pointsPer30 < ROUGH_POINTS_PER_30_MILES;
  const jumps = !bundle && longestJumpMiles !== null && longestJumpMiles > ROUGH_JUMP_MILES;
  return tooSparse || jumps;
}

/** `old` when the track's newest year is `OLD_TRACK_YEAR` or earlier. An undated track is not called old. */
export function isOldTrack(year: number | null): boolean {
  return year !== null && year <= OLD_TRACK_YEAR;
}

/** `mismatch` when the measured line is more than `MISMATCH_FRACTION` off the length the source stated. */
export function isLengthMismatch(measuredMiles: number | null, statedMiles: number | null): boolean {
  if (measuredMiles === null || statedMiles === null || statedMiles <= 0) return false;
  return Math.abs(measuredMiles - statedMiles) / statedMiles > MISMATCH_FRACTION;
}

export interface TrackFlagInput extends RoughTrackInput {
  readonly year: number | null;
  readonly statedMiles: number | null;
}

export interface TrackFlags {
  readonly rough: boolean;
  readonly old: boolean;
  readonly mismatch: boolean;
}

export function trackFlags(input: TrackFlagInput): TrackFlags {
  return {
    rough: isRoughTrack(input),
    old: isOldTrack(input.year),
    mismatch: isLengthMismatch(input.miles, input.statedMiles),
  };
}
