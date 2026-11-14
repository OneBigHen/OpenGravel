import type { Measurement, Ride, WinMargin, MarginBar } from './types';

/** A Win that clears its closest bar by less than this share is labelled thin. */
export const THIN_MARGIN = 0.10;

type Route = Pick<Measurement, 'minutes' | 'goodMiles' | 'goodShare' | 'busyShare'>;
type Baseline = Pick<Measurement, 'minutes' | 'goodMiles' | 'busyShare'>;
type RiderBar = Pick<Measurement, 'goodMiles' | 'goodShare'>;

function ratio(score: number, bar: number): number {
  if (bar > 1e-12) return score / bar;
  // A zero bar is cleared at zero; any gain is unlimited room. Never let it hide a thin share.
  return score > 0 ? Number.POSITIVE_INFINITY : 1;
}

function bar(label: string, score: number, target: number): MarginBar {
  return { label, score, bar: target, ratio: ratio(score, target) };
}

/** The tightest bar in an AND group: a win is only as comfortable as its closest requirement. */
function andPath(label: string, bars: MarginBar[]): { label: string; ratio: number; closest: MarginBar; bars: MarginBar[] } {
  const closest = bars.reduce((tightest, next) => next.ratio < tightest.ratio ? next : tightest);
  return { label, ratio: closest.ratio, closest, bars };
}

export function unmeasuredMargin(): WinMargin {
  return { aboveBar: null, thin: false, bar: null, detail: [] };
}

/**
 * Scorecard v4 item c: the margin behind a v3 verdict, measured as the ratio of
 * the route's score to each bar the rule asked for. Rule v3 itself is not touched.
 *
 * A-to-B rides have one AND path. Loops may pass either on share or at par with
 * the rider's own line, so the roomiest passing path decides the margin: a win
 * that also clears a second path comfortably is not fragile.
 */
export function winMargin(
  ride: Pick<Ride, 'loopMinutes' | 'mode'>,
  route: Route,
  baseline: Baseline,
  curvyLoopShare: number,
  riderLine: RiderBar | null = null,
): WinMargin {
  const oneAndHalf = bar('1.5 times fastest good miles', route.goodMiles, baseline.goodMiles * 1.5);
  const paths: { label: string; ratio: number; closest: MarginBar; bars: MarginBar[] }[] = [];
  const isLoop = ride.loopMinutes !== undefined;

  if (isLoop) {
    const shareBar = ride.mode === 'curvy' ? curvyLoopShare : 0.35;
    paths.push(andPath('good share', [
      bar(`${(shareBar * 100).toFixed(2)}% ${ride.mode === 'curvy' ? 'Curvy bend' : 'dirt'} share`, route.goodShare, shareBar),
    ]));
    if (riderLine !== null) {
      paths.push(andPath('at par with the rider line', [
        bar("the rider's good miles", route.goodMiles, riderLine.goodMiles),
        bar("the rider's good share", route.goodShare, riderLine.goodShare),
        oneAndHalf,
      ]));
    }
  } else if (ride.mode === 'curvy') {
    paths.push(andPath('curvy A-to-B', [
      bar(`${(curvyLoopShare * 100).toFixed(2)}% Curvy bend share`, route.goodShare, curvyLoopShare),
      oneAndHalf,
    ]));
  } else {
    paths.push(andPath('dirt A-to-B', [
      oneAndHalf,
      bar('3 more good miles than fastest', route.goodMiles - baseline.goodMiles, 3),
    ]));
  }

  const passing = paths.filter(path => path.ratio + 1e-9 >= 1);
  const best = (passing.length > 0 ? passing : paths).reduce((roomiest, next) => next.ratio > roomiest.ratio ? next : roomiest);
  const aboveBar = Number.isFinite(best.ratio) ? best.ratio - 1 : Number.POSITIVE_INFINITY;
  return {
    aboveBar,
    thin: aboveBar < THIN_MARGIN - 1e-9,
    bar: best.closest.label,
    detail: paths.flatMap(path => path.bars),
  };
}
