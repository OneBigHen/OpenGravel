import type { FrozenCurvyThreshold } from './threshold';

/**
 * The Curvy loop share bar for scorecard v2, frozen once. It is 75% of the median
 * share of the riders' own tuning lines (snapped to our roads, measured with the
 * planner's own bend metres). It comes from what riders rode, not from what our
 * router returns, so it cannot be tuned to our output.
 *
 * Do not edit by hand. `npm run scorecard -- --freeze-threshold` rewrites this file;
 * tests/unit/scorecard/threshold.test.ts recomputes it and checks the manifest hash.
 */
export const FROZEN_CURVY_THRESHOLD: FrozenCurvyThreshold = {
  manifestSha256: "5bfe4948cb8ebd1be0381eaa8627540ae0308dd0010f2fbbeee191432d23f6b5",
  riderShares: {
    "fb-1ad35a0d02336f3ae0b6": 0.033928,
    "project-gpx-a0fba4f34f6879ca4e8d2f48": 0.027675,
    "project-gpx-922121653abb944c51e9eddc": 0.02987,
    "project-gpx-53058a94b50fe9f4c9465a46": 0.048315,
    "fb-12e4d7d31d95f6b03e7a": 0.029346,
    "project-gpx-94222a4f87560d604bf973b3": 0.03532,
  },
  median: 0.031899,
  threshold: 0.023924,
};
