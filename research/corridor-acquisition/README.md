# Corridor-acquisition research (pre-registration draft)

Status: DESIGN ONLY — not pre-registered, not peer reviewed, and not a completed experiment.
The production OpenGravel planner remains unchanged by this package.

## Research question

Given an origin, destination or time-bounded loop, a road-network snapshot, a pool
of promising road corridors, and a fixed number of routing-engine attempts, can an
adaptive policy discover better **eligible** recreational route alternatives than
matched static and randomized search policies?

The proposed contribution is **routing-specific acquisition under uncertain
corridor feasibility**; it is NOT the invention of scenic routing, Bayesian
optimization, regret minimization, or GPX-guided routing.

## Contents

- [protocol.md](protocol.md): confirmatory design, failure criteria, fairness, splits, metrics, and human-study safeguards.
- [prior-art.md](prior-art.md): closest papers, anticipated novelty objections, missing comparisons.
- [validate.mjs](validate.mjs): a zero-dependency validator and descriptive audit for paired experiment records.
- [legacy-benchmark-audit.md](legacy-benchmark-audit.md): independently counted unequal provider calls in the saved October 4 benchmark.
- [audit-legacy.mjs](audit-legacy.mjs): executable reproduction of the confounding audit.
- [validate.test.mjs](validate.test.mjs): executable contract tests.
- [fixtures/synthetic-manifest.json](fixtures/synthetic-manifest.json): dummy manifest.
- [fixtures/synthetic-trials.ndjson](fixtures/synthetic-trials.ndjson): dummy records; **never use these as scientific evidence**.

## Local verification

With Node.js 24+ (the repository-supported version):

    node --test research/corridor-acquisition/*.test.mjs
    node research/corridor-acquisition/audit-legacy.mjs
    node research/corridor-acquisition/validate.mjs research/corridor-acquisition/fixtures/synthetic-manifest.json research/corridor-acquisition/fixtures/synthetic-trials.ndjson

The validator checks structural fidelity, actual attempt accounting, impossible
eligibility statements, duplicate cases, and some group leakage. It **cannot**
certify spatial source overlap, legal-access ground truth, real rider enjoyment,
or sample independence. Those require independent audits.

## Evidence hierarchy

1. Reproducible code and complete outcomes including failures.
2. Frozen graph and authority snapshots, held-out regions, equal-maximum-budget arms.
3. Independent road audits and human rider judgments.
4. Peer review. Until then: preliminary open-source engineering research.

## Relationship to production

The current code at src/application/planner/fun-generators.ts has a fixed 0.5
success prior in its adaptive allocator and experiments are not calibrated.
Do not use production scores as a substitute for blinded rider preferences.
Do not flip experimental feature flags while investigating.

The purpose of this directory is to make a publishable claim falsifiable,
including when the experimental method loses.
