# PR #51: server adapter, replay, and real-router evidence

This is a shadow-only experiment. GraphHopper was exercised live; Jev was not.
There are no blinded rider labels and no evidence of incremental held-out value.
No rider-visible route, eligibility, score, geometry, rerouting, or Free Ride path
imports the new adapter or replay harness.

See [VALIDATION.md](VALIDATION.md) for required gates, exact skips, adversarial
inspection, changed files/responsibilities, and remaining blockers.

## Identity and ownership

- Base: `main@1a04c4661575fded6cde019731a64e75f128f139`, including PR #34's
  exact bounded-regret selector.
- Original PR #51 head: `30fdac0d1c03e5920914a56d7ecac452d88f2862`.
- Rebased head before this implementation: `9201a3a753b96e7b3073fff5894026feae937508`.
- PR #39 corpus donor: `46d9a69e3eee21ebb824ecfd6d428b071d25c943`. Only its
  two real-router corpus files were reused; the Jev freeze helper is new.
- Final pushed head and gate results are recorded in PR #51 and the accompanying
  validation record. The original dirty checkout was preserved.

The infrastructure adapter owns server credentials, SDK transport, the strict
deadline, and remote JSON decoding. Application modules own frozen corpus input,
balanced replay, abstention, and evaluation. No production architecture ownership
moved: RideDocument, PlanningSession, RideSession, provider proposals, and canonical
selection/scoring retain their existing boundaries. PlannerWorkspace is unchanged.

## Preserved artifacts

| File | Meaning |
| --- | --- |
| `routing-quality.json` | Eight actual GraphHopper cases, three profile calls each; aggregate measurements only. |
| `frozen-cases.json` | Seven two-candidate cases selected by the current exact selector from canonical eligible/diverse candidates. |
| `frozen-skips.json` | Hawk Mountain–Jim Thorpe did not produce a two-candidate frontier; no replacement was fabricated. |
| `smoke-policy.json` | Explicit, uncalibrated caller thresholds for the disabled smoke run; not product policy. |
| `replay-disabled.json` | Seven cases × three ablations × two permutations × two repeats = 84 structured disabled skips; D requires no model calls. |
| `run-metadata.json` | Service version, profiles, base/donor identity, and availability limits. |

Inputs use public-place scenarios, ephemeral candidate IDs, and aggregate evidence.
They contain no rider history or route geometry. Unknown coherence measurements and
unavailable rider summaries remain null. For cases with rider evidence, D must be
an independently frozen rider-posterior forecast; this unlabeled/no-rider corpus
explicitly uses the one-hot deterministic-baseline fallback.

## Motorcycle twisty versus fastest

Live GraphHopper 11.0 at the local service supplied encoded curvature. Each case
used fastest, scenic, and twisty, with alternatives disabled. Positive duration
delta means twisty took longer; curvature/backroad deltas are twisty minus fastest.
These are measurements, not a subjective winner or a Jev outcome.

| Case | Geometry overlap | Duration delta | Curvature delta | Backroad-share delta |
| --- | ---: | ---: | ---: | ---: |
| Allentown–Stroudsburg | 0.93 | +4.99% | +0.0088 | -0.0095 |
| Hawk Mountain–Jim Thorpe | 0.46 | -0.13% | -0.0724 | 0.0000 |
| Doylestown–New Hope | 0.34 | -1.31% | -0.0079 | +0.0815 |
| Harrisburg–Lancaster | 0.10 | +51.51% | +0.0936 | +0.7525 |
| Reading–Jim Thorpe | 0.78 | +8.78% | -0.0087 | +0.0846 |
| West Chester–Lancaster | 0.03 | +24.36% | +0.2745 | +0.4501 |
| Bethlehem–Delaware Water Gap | 0.51 | +13.50% | +0.1226 | +0.3206 |
| Cherry Hill–Batsto | 0.64 | -14.01% | -0.0226 | -0.0120 |

Provider fingerprints incorporate the profile name; different fingerprints alone
do not prove different geometry. The reported overlap is the geometry diagnostic.

## Reproduce

Use Node 24 and the lockfile:

```sh
npm ci
npm run test:real-router -- --silent=false --reporter=verbose
npm run experiment:jev-frontier -- \
  --input docs/vnext/evidence/2026-10-01-jev-frontier/frozen-cases.json \
  --output /tmp/jev-frontier-disabled.json \
  --seed pr51-gh-2026-10-01 \
  --policy docs/vnext/evidence/2026-10-01-jev-frontier/smoke-policy.json \
  --repeats 2
```

The live suite emits `ROUTING_QUALITY_JSON` and `JEV_FRONTIER_FROZEN_JSON` records.
The CLI defaults to zero remote calls. Live requests additionally require `--live`,
`OGV_JEV_FRONTIER_SHADOW=1`, and a server-only `OPENROUTER_API_KEY`. No OpenRouter
credential was available in the checked process/service environments. The existing
direct TypeSafe `JEV_API_KEY` is not used as an OpenRouter fallback.

## Remaining limitations

- No live Jev request, model-resolution proof, empirical stability/order-bias
  measurement, or Jev cost measurement was possible. Injected SDK fetch tests
  verify transport and decoding, not the remote service.
- No blinded pre/post-ride multi-rider labels exist. Log loss, Brier, calibration,
  selective accuracy, and incremental value remain unavailable for this corpus.
  Synthetic tests verify metric arithmetic and split/fingerprint safeguards.
- The live planner still uses its existing diversity/role path. It has no genuine
  frozen exact-frontier shortlist seam. The corpus freezes an offline experiment
  after canonical eligibility/diversity; no production hook was invented.
- PR #39 remains a donor/draft and needs its own review. No wholesale merge or
  subjective routing claim is implied by these measurements.
- PR #33's regret-aware probe-allocation note was reviewed. That search-policy
  change belongs in a separate equal-provider-call-budget experiment.
- Rider-visible Jev influence requires a separate promotion PR with calibrated,
  multi-rider held-out evidence. This harness always reports `promotionReady: false`.
