import type { Row } from './types';

/** A Curvy loop must reach this fraction of what riders' own favourite loops reach. */
export const CURVY_THRESHOLD_FRACTION = 0.75;

export function median(values: readonly number[]): number {
  if (values.length === 0) throw new Error('Median of nothing');
  const sorted = [...values].sort((a, b) => a - b);
  const mid = sorted.length >> 1;
  return sorted.length % 2 === 1 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
}

/** 75% of the median rider-line share. Set from what riders rode, never from what our router returns. */
export function curvyLoopThreshold(riderShares: readonly number[]): number {
  return round6(CURVY_THRESHOLD_FRACTION * median(riderShares));
}

const round6 = (n: number): number => Math.round(n * 1e6) / 1e6;

/** Rider-line curvy shares (planner bend metres over line length) for the Curvy rides that have a snapped rider line. */
export function riderCurvyShares(rows: readonly Pick<Row, 'ride' | 'riderLine'>[]): Record<string, number> {
  const shares: Record<string, number> = {};
  for (const row of rows) if (row.ride.mode === 'curvy' && row.ride.riderTrack && row.riderLine) shares[row.ride.id] = round6(row.riderLine.goodShare);
  return shares;
}

export interface FrozenCurvyThreshold {
  /** SHA-256 of tests/scorecard/rides.json when this was frozen. A manifest edit invalidates it. */
  readonly manifestSha256: string;
  /** Rider-line curvy share per tuning ride, as measured once through the live router. */
  readonly riderShares: Readonly<Record<string, number>>;
  readonly median: number;
  readonly threshold: number;
}

export function freezeCurvyThreshold(manifestSha256: string, riderShares: Record<string, number>): FrozenCurvyThreshold {
  const values = Object.values(riderShares);
  return { manifestSha256, riderShares, median: round6(median(values)), threshold: curvyLoopThreshold(values) };
}

/** Source text of scripts/scorecard/frozen-threshold.ts, so a re-freeze is one command and a reviewable diff. */
export function renderFrozenThreshold(frozen: FrozenCurvyThreshold): string {
  const shares = Object.entries(frozen.riderShares).map(([id, share]) => `    ${JSON.stringify(id)}: ${share},`).join('\n');
  return `import type { FrozenCurvyThreshold } from './threshold';

/**
 * The Curvy loop share bar for scorecard v2, frozen once. It is 75% of the median
 * share of the riders' own tuning lines (snapped to our roads, measured with the
 * planner's own bend metres). It comes from what riders rode, not from what our
 * router returns, so it cannot be tuned to our output.
 *
 * Do not edit by hand. \`npm run scorecard -- --freeze-threshold\` rewrites this file;
 * tests/unit/scorecard/threshold.test.ts recomputes it and checks the manifest hash.
 */
export const FROZEN_CURVY_THRESHOLD: FrozenCurvyThreshold = {
  manifestSha256: ${JSON.stringify(frozen.manifestSha256)},
  riderShares: {
${shares}
  },
  median: ${frozen.median},
  threshold: ${frozen.threshold},
};
`;
}
