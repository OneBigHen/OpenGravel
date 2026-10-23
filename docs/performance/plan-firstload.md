# Plan first-load optimization — 2026-10-23

Baseline: `47cda69f831981d4180de829f6c7d584946044a8`, branch `dlg/plan-firstload`.
Local production builds, no production environment copied, OpenFreeMap basemap.
No PostHog, GraphHopper, routing policy, map layer, or CSS behavior changes retained.

## Measurements

Each comparison used `npm run build`, `next start -p 3330`, then:

```sh
node .perf/measure.mjs http://127.0.0.1:3330 / /explore / /explore / /explore
node .perf/profile.mjs http://127.0.0.1:3330/
```

The supplied harness uses fresh browser contexts, 390×844, CPU throttle 4×,
150 ms latency, 800,000 bytes/s download and 93,750 bytes/s upload. It sums
long-task excess through six seconds after `load`. It is not Lighthouse TBT.
Values below are medians of three contexts per page, with the same harness and
server setup. Baseline was rebuilt and repeated immediately before the final
candidate to reduce differences from cold compilation and host warmup.

| Page | Baseline LCP | Final LCP | Baseline TBT | Final TBT | Baseline JS | Final JS |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| Plan `/` | 5.728 s | 4.520 s | 4.573 s | 3.417 s | 679 KB | 633 KB |
| Explore `/explore` | 4.340 s | 3.964 s | 3.199 s | 2.869 s | 606 KB | 552 KB |

Plan improved about 21% LCP / 25% TBT; Explore improved about 9% / 10%.
**The <3.5 s LCP / <2 s TBT targets are not reached.** These are local results,
not a claim about the live site's Mapbox/production configuration. Plan final
samples were LCP 5.252 / 4.100 / 4.520 s, TBT 4.128 / 3.077 / 3.417 s.
External tile responses and native rendering produce substantial variance:
earlier calibration baseline LCP ranged from 1.524 to 9.924 s.

Sampled Plan CPU self-time (one profile each, directional rather than a median):

| Category | Before | Final |
| --- | ---: | ---: |
| Turbopack runtime/module evaluation | 1,077 ms | 563 ms |
| MapLibre script | 2,731 ms | 1,609 ms |
| Native `(program)` | 3,273 ms | 3,394 ms |

The remaining native/WebGL cost is material. CSS transfer remains 55 KB on Plan
and 44 KB on Explore; this task does not claim CSS parsing savings.

## Retained changes

- Load Protomaps/PMTiles/offline-map implementation only in the existing offline
  branch, preserving its caught-error fallback.
- Disable automatic primary-tab/settings prefetch; those destinations now fetch
  on navigation. This trades speculative downloads for first-navigation latency.
- Load advisor proposal construction/request serialization and its API client on
  ask. Preserve the original document snapshot, pending state, abort/generation
  protection, and existing request-error handling.
- Load elevation sampling, fetch hook and chart only for a selected route; keep
  briefing code behind the route boundary. Clear traffic state when a route clears.
- Load sharing, selected map-feature details, and stop/road/drawing refinement
  controls when opened. Loading indicators provide local Suspense boundaries.
- Load Explore route details and their preparation providers only on the detail
  path. Plan's shared places/map-layer provider factories remain eager.

## Experiments and rejected work

| Candidate | Plan LCP / TBT | Explore LCP / TBT | Plan / Explore JS |
| --- | ---: | ---: | ---: |
| Offline import + tab prefetch | 4.260 / 3.109 s | 3.808 / 2.728 s | 656 / 582 KB |
| Initial optional-panel split | 5.308 / 3.917 s | 4.052 / 2.729 s | 638 / 558 KB |
| First-idle optional map layers | 4.392 / 4.177 s | 4.464 / 3.231 s | 638 / 558 KB |
| Final boundaries, advisor and providers | 4.520 / 3.417 s | 3.964 / 2.869 s | 633 / 552 KB |

- Rejected the first-idle map candidate: it did not reduce overall blocking and
  added lifecycle/layer-order complexity. Its route/pin, latest-scene replay,
  style-reset, and disposal tests passed before rejection. No deferred-map option
  or corresponding test modifications remain in the final change.
- Kept the Things tab eager to preserve its immediately available CTA. Kept
  AvoidAreasPanel eager because the status/conflict surface already needs it.
- Retained module boundaries for lower startup bytes/evaluation, without claiming
  that every small boundary independently improves noisy wall-clock timings.
- Did not defer storage restoration or route geometry work: the initial empty
  Plan scene has no large line to fingerprint, and restoration is needed for
  the first meaningful interaction. Routing/offline-worker behavior was untouched.

## CSS follow-up plan

1. Inventory selector ownership in `globals.css` and `theme-glass.css` with a CSS
   AST; keep shared tokens, reset, type, navigation, map controls, and accessibility
   rules in the root. Class-prefix matching alone is unsafe for grouped selectors.
2. Move ride-only, Explore/detail-only, and settings-only rules together with their
   media-query and theme overrides into scoped route/component stylesheets.
   Preserve original cascade order; do not introduce cascade layers blindly.
3. Import lazy-panel styles with their corresponding component. Keep styles scoped
   so stylesheets retained across client navigation cannot alter another route.
4. Verify cold loads and Plan→Explore→Ride→Settings→Plan transitions in day/night,
   phone portrait/landscape and desktop. Compare screenshots, fonts, sheet geometry,
   markers, attribution and reduced-motion behavior before enforcing CSS budgets.
5. Re-measure actual loaded CSS bytes and CPU style/layout time. The large source
   files alone do not establish how much of native `(program)` is CSS work.

## Validation and limits

- Production build passed. `npx tsc --noEmit` and ESLint on all changed TypeScript
  files passed. `git diff --check` passed.
- Focused Vitest: 181 tests across 13 files passed (`--maxWorkers=1`), covering
  advisor, workspace, preparation, sharing, Explore/Things, map host/offline map,
  map component, navigation, and advisor transport.
- Architecture Vitest: 145 tests across 8 files passed (`--maxWorkers=1`).
- Loaded 390×844 Plan screenshot matches the original baseline byte-for-byte:
  `.perf/plan-before.png` and `.perf/plan-after.png`, SHA-256
  `96749c5bc5dcd3fe82fc3505b0fcdc942b8e9a08ccb24b4b334cf8a4be509a88`.
  A later baseline screenshot used a different camera after viewport resizing;
  it was not used as evidence of pixel equality.
- Browser map reports ready/painted with no map error. Placed start and destination
  markers; scene reports `points:2`, no map error. No local provider-backed planned
  route, physical phone, Safari/WebKit, or production Mapbox visual proof is claimed.
- Browser direct-load of Explore detail `fb-8b03e3e24269f34452b8` reached its
  route map, Plan/Export/Share actions and Before you ride section after lazy loading.
- Raw ignored artifacts: `.perf/baseline-repeat.jsonl`, `.perf/final.jsonl`,
  `.perf/profile-before.txt`, `.perf/profile-final.txt`, build/test/lint logs and
  screenshots. Full Vitest and Playwright suites were not run on this host.
- Commit attempt could not stage: the linked worktree Git metadata is read-only
  (`index.lock` creation failed). The complete fallback is `/tmp/og-firstload.patch`.
- No push or deployment. Full gates and production verification remain with the
  orchestrator. Performance target and CSS split remain open work.
