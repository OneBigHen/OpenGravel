# Jev FUN JUDGE — live evidence (2026-10-03)

Model: TypeSafe direct, pinned `jev-1.13.0` (every answer reported that identity).
Router: local GraphHopper (PA/NJ graph), production plan service, `OGV_JEV_FUN_JUDGE=shadow`.
Road authority (closures/access) was disabled for the evaluation runs, so closures were
unknown, not clear. No route geometry, rider history or credentials are stored here.

Total live Jev requests this lane: 75 (1 synthetic transport probe + 32 FUN JUDGE + 42
held-out replay). All sequential; no retries.

## 1. FUN JUDGE on live plans — `live-shadow-eval.json`

8 public-place corpus OD pairs (PR #39 corpus) x 2 road characters (curvy, backroads) = 16
plans, 2 Jev calls each (forward + reversed presentation order) = 32 calls, 32 ok.

| Measure | Result |
| --- | ---: |
| Plans judged | 16 / 16 |
| Outcome `preferred` (confident, order-stable) | 14 |
| Outcome `order-disagreement` (abstain, deterministic kept) | 2 (both Cherry Hill–Batsto, the only 3-candidate shortlist) |
| Order agreement (same pick in both orders) | 87.5% (14/16) |
| Raw Jev pick = deterministic Best Ride | 93.8% (15/16) |
| Confident Jev pick = deterministic Best Ride | 100% (14/14) — `on` would have changed 0 of 16 Best Rides |
| Raw Jev pick = Frontier method pick | 56.3% (9/16) |
| Deterministic Best Ride = Frontier pick | 62.5% (10/16) |
| Per-call latency p50 / p95 / max | 144 / 240 / 297 ms |
| Judgement wall latency p50 / p95 (2 calls in parallel) | 151 / 298 ms |

Where Jev and Frontier disagree (Doylestown–New Hope, Harrisburg–Lancaster,
Reading–Jim Thorpe, both characters), Frontier chose the fastest route and Jev chose the
scenic/backroad route that deterministic scoring also chose (e.g. Harrisburg–Lancaster:
77 min, backroad 0.89 vs fastest 50 min, backroad 0.11; +54% time, which Best Ride's 35%
envelope admits only because the deterministic winner is always the baseline — see the
integrator note in the lane report).

Cherry Hill–Batsto offers twisty 67 min vs scenic 72.6 min (fastest also shown). Jev's
pick flipped between twisty and scenic when the presentation order was reversed (in both
characters), so the order check made it abstain and the deterministic winner stood. This is the case type that matters most —
near-tied fun candidates — and Jev 1.13 was not order-stable on it.

## 2. PR #51 held-out replay harness, live — `frontier-replay-live.json`

`npm run experiment:jev-frontier` on the 7 frozen PR #51 cases, `--provider typesafe
--repeats 1 --live`, uncalibrated `smoke-policy.json`. 7 cases x A/B/C x 2 orders = 42
calls, 41 ok, 1 invalid (`invalid-fit`: Score/PMF inconsistency in variant B).

| Variant | What Jev sees | Order-flip rate | Agreement with exact bounded-regret baseline (stable verdicts) | p50 / p95 ms |
| --- | --- | ---: | ---: | --- |
| A | intent + frontier facts | 14% | 100% | 163 / 300 |
| B | + rider summary/utility (null here) | 50% | 100% | 142 / 207 |
| C | + canonical score/rank (leakage ablation) | 0% | 100% | 142 / 180 |

No blinded rider labels exist, so log loss / Brier / calibration / incremental value stay
unavailable and the harness reports `promotionReady: false`. Variant C's perfect
stability is the expected leakage effect (it copies the supplied rank), not skill.

## Reproduce

```sh
set -a; . /etc/opengravel/ogv.env; set +a   # JEV_API_KEY, server-side only
node --conditions=react-server --import tsx scripts/jev-fun-judge-eval.ts --live \
  --output docs/vnext/evidence/2026-10-03-jev-fun-judge/live-shadow-eval.json
OGV_JEV_FRONTIER_SHADOW=1 npm run experiment:jev-frontier -- \
  --input docs/vnext/evidence/2026-10-01-jev-frontier/frozen-cases.json \
  --output docs/vnext/evidence/2026-10-03-jev-fun-judge/frontier-replay-live.json \
  --seed jev-lane-2026-10-03 --policy docs/vnext/evidence/2026-10-01-jev-frontier/smoke-policy.json \
  --repeats 1 --live --provider typesafe
```

Without `--live` the FUN JUDGE script makes zero model calls (GraphHopper only).
