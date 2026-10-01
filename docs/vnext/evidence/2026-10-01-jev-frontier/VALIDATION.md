# Validation and handoff

Base: `1a04c4661575fded6cde019731a64e75f128f139`. Rebased pre-implementation
head: `9201a3a753b96e7b3073fff5894026feae937508`. Final pushed head is recorded
in PR #51. Commands used Node 24.15.0 and the checked-in dependency lockfile.

## Required gates

| Command | Result |
| --- | --- |
| `npm run lint` | Exit 0; one existing `RidesLibrary.tsx:217` React cleanup warning; no new warnings. |
| `npm run typecheck` | Exit 0. |
| `npm run test:unit -- --maxWorkers=2` | Exit 0; 324 files passed, 1 skipped; 3,698 tests passed, 3 skipped. |
| `npm run test:architecture` | Exit 0; 8 files / 142 tests passed. |
| `npm test -- --maxWorkers=2` | Exit 0; 332 files passed, 1 skipped; 3,840 tests passed, 3 skipped. |
| `npm run build` | Exit 0; optimized Next.js build, TypeScript, page generation completed. One workspace warning about an ignored outside-repository lockfile. |
| `npm run test:real-router` | Exit 0 against actual local GraphHopper; 3 files passed / 3 skipped, 17 tests passed / 8 skipped. |

The two-worker setting changes execution concurrency only. No assertions,
timeouts, thresholds, architecture guards, or screenshot baselines were weakened.
The full unit project includes integration and contract tests under the repository's
existing Vitest configuration. Real-router measurements were also captured with
`--silent=false --reporter=verbose` so successful-case emitted records were retained.

Existing unit skips: one optional installed Pennsylvania offline-region test
(`OGV_OFFLINE_REGION_ROOT` unavailable), one live NWS test (`OGV_LIVE` not enabled),
and the intentional "vendored worker missing" branch when the worker is present.
Existing real-router skips: one opt-in discovery test (`OGV_DISCOVER_LIVE` not set),
three opt-in road-authority tests (`OGV_ROAD_AUTHORITY` not enabled), and four sketch
tests (no `OGV_SKETCH_ROUTE_FIXTURE`). None is claimed as exercised.

No browser or physical-device acceptance claim is made. There is no changed
rider-visible UI or production planning boundary requiring a new critical E2E
flow in this slice.

## Development failures and final review

An earlier overlapping broad run failed two existing planner recovery-workflow UI
tests and was interrupted. The isolated recovery suite then passed 6/6. A unit run
started before review edits settled loaded old numeric Choice criteria and failed
two adapter expectations. Those runs do not count as final gates; the implementation
was frozen and the broad suites rerun sequentially. No load-related root cause is
claimed solely from the successful isolated run.

Both final frozen broad suites passed, including the recovery-workflow tests and
the adapter criteria assertions. The final build also passed. All required local
gates completed; hosted CI, live Jev, and rider/physical acceptance are separate
evidence boundaries.

Standards review: no remaining material findings after the final frozen-source
review. Spec review: no remaining material findings after requiring posterior D
for rider evidence, omitting duration-derived duplicate transport features, and
using slot-specific field references rather than duplicated numeric criteria.

| Adversarial boundary | Evidence |
| --- | --- |
| Model alias drift | Both adapters pin 1.13; runtime validators reject unexpected families; injected remote drift tests. No live model-resolution claim. |
| Candidate order | Two/three balanced permutations, same seed across ablations, local ID remapping, nonzero flip / repeated winner instability abstention tests. |
| Baseline leakage | Projection excludes stable IDs and baseline identity; A/B exclude canonical score/rank, C deliberately adds them for ablation; only independent Noul references the baseline slot. |
| Correlated features | Duration ratio excluded remotely; no repeated numeric criteria or aggregate fun/coherence axis added; unknown measures stay null. |
| Remote JSON / unsafe IDs | Exact compact input schemas, guarded remote answers and question keys, unsafe-key rejection, caller-mutation fence. |
| PMF / Score / Choice | Known-key distributions, finite probability bounds, score expectation checks, unique Choice argmax and tie rejection. |
| Secrets / history | Explicit server-only import and key gate; no browser key names or raw-history schema; safe structured errors and logging off. |
| Retry / latency | Real SDK with injected fetch proves single calls on 429/500/503; deadline/abort tests include fetch ignoring AbortSignal. |
| Routing authority | Source architecture checks forbid production importers, scoring/UI/domain/Free Ride integration; nine replay outcomes preserve a preexisting plan bundle. |
| Held-out integrity | Frozen fingerprints, corridor/session partition guards, separate pre/post labels, caller-frozen control/policy, unavailable metrics without labels. |

## Changed responsibilities and files

- Infrastructure: `src/infrastructure/routing/jev-frontier-judge.ts`; narrow
  application port `src/application/planner/ports/jev-frontier-judge.ts`.
- Application experiment: `jev-frontier-shadow.ts` extends nullable unknown
  measurements, safe projection, and usage contract; new `jev-frontier-corpus.ts`,
  `jev-frontier-replay.ts`, and `jev-frontier-evaluation.ts` own freeze/replay/scoring.
- CLI/dependencies: `scripts/jev-frontier-replay.ts`, `package.json`, and lockfile;
  pinned server-only guard and Node TS runner added.
- Tests: Jev adapter, projection, corpus, replay, evaluation, fixtures, and explicit
  shadow architecture guard; PR #39's two corpus files plus a new freeze helper.
- Documentation: experiment contract, canonical handoff update, and curated
  aggregate evidence in this directory.

Production `plan-service.ts`, `pipeline.ts`, `frontier-routing.ts`, rider posterior,
route features, PlannerWorkspace, and Free Ride are unchanged by this implementation
slice. The exact selector is used offline on canonical eligible/diverse corpus
candidates; this does not constitute a new live post-frontier seam.

Remaining blockers: pinned-model availability/live inference evidence; blinded multi-rider
pre/post labels; calibrated caller policy and posterior forecasts; a separately
designed legitimate frozen-frontier live seam and promotion PR. PR #39 remains a
draft donor; PR #33's equal-budget regret-aware probe scheduler remains separate.

## Direct TypeSafe follow-up

Implementation base: `dafe596eaf1b60410f91e308be977cb042458881`; current main
remains `1a04c4661575fded6cde019731a64e75f128f139`. The owner supplied a direct
TypeSafe credential and authorized its use. The credential is never committed,
printed, included in public evidence, or persisted in production configuration.

The adapter now explicitly selects TypeSafe or OpenRouter with separate key gates
and fixed service URLs. The CLI exposes `--provider typesafe`; OpenRouter is still
the default. A/B/C projection, model 1.13, zero retries, 1,500 ms deadline, failure
taxonomy, abstention, and production routing isolation remain unchanged. Failure
telemetry gains validated numeric HTTP status only; arbitrary response bodies and
messages remain excluded. Source tests verify no URL override, unknown provider,
credential fallback, retries, or raw failure-data propagation.

Direct catalog access succeeded, exposing only `jev-latest` and `jev-preview`.
The preserved six-request pilot returned HTTP 400 for every requested `jev-1.13`
judgment; a diagnostic request confirmed `Unknown model: jev-1.13`. Including the
initial pilot and one diagnostic, 13 SystemOne requests and one catalog request
were made. There are zero valid judgments, resolved models, alias requests, or
blinded labels. These failed live requests are not semantic model evaluation.

Focused Jev tests passed 82/82. A first concurrent architecture run timed out in
the unchanged stylesheet balance test (7,331 ms against its existing 5,000 ms
limit). No stylesheet, test, assertion, or timeout was edited. Isolated reproduction
passed in 2.14 seconds; the final sequential architecture run passed in 2.45 seconds.
No definitive environmental root cause is claimed from those successful reruns.

| Follow-up command | Actual result |
| --- | --- |
| `npm run lint` | Exit 0; the same existing RidesLibrary cleanup warning, no new warnings. |
| `npm run typecheck` | Exit 0. |
| `npm run test:unit -- --maxWorkers=2` | Exit 0; 3,704 passed / 3 skipped, 324 files passed / 1 skipped. |
| `npm run test:architecture` | Final sequential run exit 0; 142 tests / 8 files passed. |
| `npm test -- --maxWorkers=2` | Exit 0; 3,846 passed / 3 skipped, 332 files passed / 1 skipped. |
| `npm run build` | Exit 0; optimized Next.js build, TypeScript and page generation completed; existing outside-repository lockfile warning. |
| `npm run test:real-router` | Exit 0; 17 passed / 8 skipped, 3 files passed / 3 skipped against actual GraphHopper. |

Manual CLI controls also passed: configured direct key without `--live` produced
only disabled skips (exit 0); missing direct key and unknown provider both failed
before requests/output (exit 1). The opt-in/key/provider requirements stay explicit.

Standards and Spec follow-up reviews found no remaining material blockers. The
Standards review noted a nonblocking duplicated provider dispatch between CLI and
adapter; both boundaries are currently tested and reject fallback/unknown providers.
Semantic-quality improvement, repeat stability, and order-flip measurement remain
unavailable until an explicitly approved model is actually callable. No alias was
substituted or calibrated policy changed to manufacture a result.
