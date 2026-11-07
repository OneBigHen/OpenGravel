# Legacy October 4 benchmark audit (source-fixed)

Source: [ride-formula-benchmark-2026-10-04.json](../../docs/vnext/research/ride-formula-benchmark-2026-10-04.json)

Reproduced from the 28 JSON entries in the legacy benchmark, with the code
at [audit-legacy.mjs](audit-legacy.mjs). This is a historical confounding audit,
not a live-router rerun and not a report of current production performance.

| Measurement | Value |
| --- | ---: |
| Scenario-mode comparisons | 28 |
| Distinct trip IDs | 14 |
| Pairs with equal actual provider calls | 0 |
| Pairs where experimental Formula used more calls | 28 |
| Total production control calls | 184 |
| Total Formula treatment calls | 257 |
| Additional Formula calls | 73 |
| Mean additional calls per scenario | 2.6071 |
| Production elapsed sum | 43.34 s |
| Formula elapsed sum | 108.84 s |
| Mean treatment elapsed increase | 2.34 s |
| Aggregate treatment/control elapsed ratio | 2.51 |

**Conclusion:** The legacy Formula treatment used additional routing search effort
in every comparison. The resulting treatment-vs-control differences may be
interesting engineering diagnostics but **cannot** support an
equal-computational-cost algorithm comparison or a human enjoyment claim.

The 28 scenario-mode rows also reuse 14 trip IDs and are not 28 independent
geographic test locations.

## Other time-dependent confounders

The 2026-10-04 routing notes document subsequent corrections to loop random
seeding, explicit surface/tracktype precedence, rider ETA baselines, dirt
sweeps, and motorcycle profile speeds. Those later analyses do not retroactively
repair the comparability of this earlier saved JSON. Results from different
router/graph revisions must not be pooled uncritically.

A journal-grade result requires a new experiment with frozen graph and source
fingerprints, a shared candidate universe where appropriate, randomized
exploration data, matched allowed attempts, and independent quality evidence.

## How to reproduce

    node research/corridor-acquisition/audit-legacy.mjs

No rider GPS or personally identifiable information is needed to rerun this
diagnostic. The audit only uses the already-committed aggregate benchmark.
