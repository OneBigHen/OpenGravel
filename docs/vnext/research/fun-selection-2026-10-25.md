# Geometry fun selection — 2026-10-25

**Update 2026-10-25 (gated):** geometry fun selection now applies to the Curvy ride style only. Balanced and Fast use exactly the previous Best Ride selection (Balanced regressed in the first benchmark below), so the Balanced "After" rows equal the control by construction and were re-measured identical. Curvy's alternative search is one parallel wave of two router calls (twisty alternatives plus scenic), skipped when under 1.5 s of search budget remains. The tables show the gated build; the Before columns are the unchanged control. Still a review branch, not a deployment.

Values are **curvy mi / heading degrees per eligible km / Franco per route km / minutes**. Curvy miles and Franco use the unchanged legacy geometry evaluators. Heading uses the new 20 m / centred 1 km signal, with residential, service, urban and link roads excluded from its numerator and denominator. A longer sweeping road can improve fun value while losing tight-curve miles; these are different measurements.

| Ride | Mode | Before | After |
| --- | --- | --- | --- |
| Jim Thorpe → Hawk Mountain | Balanced | 3.22 / 58.52 / 37.34 / 51.86 | 3.22 / 58.52 / 37.34 / 51.86 |
| Jim Thorpe → Hawk Mountain | Curvy | 3.22 / 58.52 / 37.34 / 51.86 | 3.22 / 58.52 / 37.34 / 51.86 |
| Jim Thorpe 120-minute loop | Balanced | 9.48 / 64.85 / 80.42 / 114.60 | 9.48 / 64.85 / 80.42 / 114.60 |
| Jim Thorpe 120-minute loop | Curvy | 6.68 / 49.29 / 102.16 / 117.14 | 10.69 / 90.98 / 82.51 / 121.61 |
| Allentown → Stroudsburg | Balanced | 3.56 / 60.89 / 32.83 / 63.57 | 3.56 / 60.89 / 32.83 / 63.57 |
| Allentown → Stroudsburg | Curvy | 5.14 / 80.36 / 114.39 / 84.24 | 5.41 / 69.26 / 62.97 / 71.72 |
| Doylestown → New Hope | Balanced | 0.91 / 34.62 / 38.14 / 29.08 | 0.91 / 34.62 / 38.14 / 29.08 |
| Doylestown → New Hope | Curvy | 0.85 / 26.73 / 60.59 / 25.83 | 0.85 / 26.73 / 60.59 / 25.83 |
| Reading → Jim Thorpe | Balanced | 10.19 / 69.46 / 76.30 / 116.16 | 10.19 / 69.46 / 76.30 / 116.16 |
| Reading → Jim Thorpe | Curvy | 10.19 / 69.46 / 76.30 / 116.16 | 9.44 / 70.98 / 58.29 / 115.24 |
| Bethlehem → Delaware Water Gap | Balanced | 5.09 / 77.07 / 72.15 / 70.93 | 5.09 / 77.07 / 72.15 / 70.93 |
| Bethlehem → Delaware Water Gap | Curvy | 4.84 / 79.05 / 87.84 / 72.49 | 4.34 / 75.07 / 52.93 / 68.00 |

Planning latency: three alternating complete runs per revision, same warm local control router, 36 plans per revision (18 per mode). Nearest-rank percentiles; benchmark diagnostic geometry measurements run after the plan timer; application selection analysis stays inside the timed plan. These are local provider-backed measurements, not internet/mobile latency or a population guarantee.

| Mode | Before p50 / p95 ms | After p50 / p95 ms |
| --- | --- | --- |
| Balanced | 1061 / 3490 | 1175 / 3116 |
| Curvy | 2412 / 4192 | 1794 / 2483 |

Gated rerun: three complete runs of the six rides (18 plans per mode), same warm local control router. Curvy p95 is now below the old 4,192 ms; with 18 samples per mode the nearest-rank p95 is the maximum.

Fast parity (measured on the first, ungated build; Fast code paths are untouched by the gate): **6/6 rides have identical selected geometry hashes, selected metrics and Fastest metrics** before/after. Balanced recommendations pass the 1.25x fastest ETA cap; both loop modes stay inside 105–135 minutes. All 72 Balanced/Curvy plans and 12 Fast plans pass the live harness.

## Implementation and constraints

- `heading-fun-v1` privately resamples at no more than 20 m with a direction-symmetric phase. Fixed local-projection headings feed centred 1 km windows; per-sample turn is capped at 30 degrees. A separate nominal 200 m signed/absolute coherence guard rejects rapid sawtooths while retaining broad S bends, matching the prior graph study.
- Junction maneuvers suppress both along-road and physical 30 m neighborhoods. Existing road runs supply exact travelled-chainage class coverage, clipped at sample boundaries; incomplete road-run coverage stays unknown. Road facts, ETAs and graph models are unchanged.
- Raw `funScore` is integrated heading credit (capped at one equivalent bend km per km at 90 degrees/km), plus 0.35 times existing eligible/coherent Franco weighted km, minus 0.35 busy km, 0.30 residential/urban km and 0.08 eligible dull straight km (below 15 degrees/km). No credit comes from residential/service/living-street, urban, missing/other, link or roundabout segments.
- Utility subtracts 0.06 equivalent bend km per added router minute. A monotone adapter feeds canonical MMR and Best Ride assignment before dedupe, with the actual fastest eligible ETA as the reference: Balanced 1.25x, Curvy 1.35x; loops use their timeboxes. Existing canonical eligibility, access/bike checks and road-authority verification run before adoption.
- Busy exposure may add at most 10 percentage points under Protect Ride; residential exposure may add at most 3 points. A missing reference cannot authorize additional exposure beyond that conservative slack. Numeric fun values remain internal; Jev does not override this selection.
- The existing 12-candidate lane retention stays. Balanced is back to the previous selection and its previous alternatives search (no weak-pool calls). Curvy runs at most two parallel alternative calls (twisty + scenic), skipped under 1.5 s of search budget; authored and dirt objectives retain their existing ranking path. Fast is unchanged.
- Existing rider copy is retained: its curvy-mile count has a narrower meaning than the new sweeper metric. No badges or numerical scores were added to cards.

## Reproduction, evidence and limits

Baseline `e9c6644319120fe5271abbf2ed995affa692e16a` and this branch use the same unchanged local `http://127.0.0.1:8989` control graph, region, data date, profiles, fixed six trip IDs and default touring/Mixed/Protect Ride options from the prior study. No graph rebuild, deployment, Jev or live closure feed is involved. The baseline checkout adds only the measurement harness and the two measurement modules; selection wiring remains baseline code.

Run on each checkout, alternating revisions three times; use a distinct evidence path per run. Copy the current `fun-selection-live.test.ts`, `heading-fun.ts` and `geometry-fun.ts` to the baseline checkout for measurement only.

```sh
OGV_FUN_SELECTION_BENCHMARK=1 OGV_FUN_SELECTION_EVIDENCE=/tmp/fun-selection-run.json \
  npm run test:real-router -- tests/real-router/fun-selection-live.test.ts --maxWorkers=2
OGV_FUN_SELECTION_FAST=1 OGV_FUN_SELECTION_BENCHMARK=1 \
  npm run test:real-router -- tests/real-router/fun-selection-live.test.ts --maxWorkers=2
```

[Paired metrics, every timed sample, HTTP attempts, exposure, router identity and source hashes](fun-selection-2026-10-25.json). Full raw request diagnostics remain in `/tmp/fun-selection-final-{before,after}-{1,2,3}.json`; they contain aggregate metrics rather than route geometry.

Verification on docker-dev: TypeScript, ESLint on all changed TypeScript files, focused Vitest with `--maxWorkers=2`, and the opt-in live harness. Full Next build was not run. A reviewer started a full unit run and interrupted it (exit 130); it is not counted as a passing gate. The overlapping preliminary latency runs were discarded; the final three pairs ran without competing local test jobs. No physical rider or closure-clearance claim is made. The mixed quality results require calibration/rider acceptance before promotion; latency improvements alone do not promote it.
