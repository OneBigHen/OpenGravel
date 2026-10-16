# Scientific protocol v0.1 — draft for review, not pre-registered

## Estimand and research question

For each paired scenario s and allowed router-attempt budget B, compare
the candidate-search policies given identical road graph, date/intent,
candidate-source snapshot, and initial incumbent routes. The estimand is the
difference in independently evaluated **best eligible route quality** returned
at budget B, conditional on the sampled target population of scenarios.

Candidate quality must NOT be the same engineered OpenGravel score that
guides candidate acquisition when used as confirmatory ground truth.
Until rider labels exist, report proxy outcomes as exploratory.

## Hypotheses and failure criteria

- H1: Contextual, calibrated acquisition improves the best eligible route
  over the strongest of fixed, random, greedy and noncontextual cost-aware
  policies under equal maximum provider-attempt budget.
- H2: The uplift persists in wholly held-out geographic regions and GPX
  source families, not merely within the PA/NJ corpus.
- H3: Independent blinded rider preferences support any asserted improvement
  in real enjoyment. Without labels, this claim must remain untested.
- H4: Any uplift is not purchased by increased known-prohibited-road traversal
  or unjustified conversion of unknown access to verified open.

STOP/negative-result rule: If a contextual policy cannot beat a tuned greedy
or noncontextual cost-aware baseline on geographically held-out data after
the preregistered analysis, publish the null result honestly or revise
the research question and collect NEW holdout data. Do not retune on test.

## Comparators

A. Ordinary fastest/alternative GraphHopper queries.
B. Matching rider-profile strength sweep with identical attempt cap.
C. Seeded random eligible corridor-probe allocation.
D. Fixed round-robin from the same generator proposal set.
E. Greedy forecasted utility / cost from the same proposal set.
F. Noncontextual success-prior expected improvement / cost.
G. Contextual calibrated acquisition (proposed treatment).

Additionally compare a published scenic-routing-inspired corridor method
if its features/data can be implemented fairly. State deviations in advance;
a weak straw-man implementation cannot support a state-of-the-art claim.

An algorithm that has fewer successful routes or fails to propose probes
must still appear in the denominator. Distinguish provider *attempts*,
candidate count, API requests, retries, execution time and wall-clock latency.
Run arms at the same maximum attempt allowance, not necessarily the exact
same actual cost: early stopping is part of the result.

## Experimental phases

1. Pilot — debug manifests, spatial partitions, route-quality definitions;
   all results exploratory. A 30–60-scenario pilot is not the paper.
2. Data collection — randomized exploration probes (including failures and
   duplicates), train/validate outcome probabilities and cost estimates.
3. Freeze — preregister protocol, immutable code commit, data snapshots,
   calibrations and primary/secondary endpoints BEFORE accessing held-out tests.
4. Confirmatory route evaluation — suggested starting scope at least 600
   scenario/budget observations across three or more disjoint regions, with
   final sample count determined by a pilot variance/power analysis.
5. Human evaluation — obtain appropriate ethics determination, randomize
   anonymized route pairs and presentation order, blind generator identity,
   report rider- and scenario-clustered intervals. No publication-grade
   human preference claim without this step.

Where possible run the adaptive policy LIVE against the frozen router.
Offline replay requires a complete common candidate/probe outcome bank for
all policy-accessible actions. Never infer unavailable counterfactual outcomes
from actions chosen only by the deployed policy.

## Preventing leakage

Partition by geospatial clusters and original GPX *families*. Include
spatial buffers so near-parallel roads and corridor windows do not cross
train/validation/test. Canonicalize reverse-direction duplicates, overlapping
GPX tracks and corridor-derived copies. Audit source-to-test geometric overlap,
not merely duplicate route IDs. Pin OSM/GraphHopper graph and legal authority
snapshots and record their digests.

The included validator checks that a cluster or sourceFamilyId does not
appear in multiple splits in the provided records. It CANNOT compute geometric
buffers. A separate GIS check is mandatory before calling the split clean.

## Route outcomes and access evidence

Record every attempted probe, including skipped, timeout, no-route,
ineligible, duplicate and provider-error outcomes, without dropping failures.
A provider-successful route is not necessarily canonically eligible.
Independent access truth uses the source authority, applicable date, direction
and verified spatial traversal. Missing/unpublished evidence means UNKNOWN,
not open. Unknown-access exposure is separately reported; no claim of legal
clearance follows from absence of a known prohibition.

Preserve measured distance/ETA, bend share and continuous worthwhile-road
metrics, unpaved metres, coverage, corridor adherence, road classes, and
source provenance. Underlying road facts and rider judgments should not be
replaced by hand-tuned composite scores in the confirmatory table.

## Primary and secondary analyses

The confirmatory primary endpoint should be frozen after the pilot and before
the final geographic holdout. Preferred endpoint: paired, blinded rider
preference for eligible output routes under an equal budget. If a sufficiently
powered rider study is infeasible, make this an algorithm/systems study with
proxy quality explicitly labeled and do not claim improved enjoyment.

Secondary: eligible route discovery rate, quality-call frontier, latency,
total provider attempts, candidate-pool diversity, detour/timebox deviation,
surface coverage, unknown-access exposure, known-prohibited traversal,
probe feasibility calibration, corridor adherence and cross-region transfer.

Use an analysis plan with cluster bootstrap or hierarchical regression by
scenario/geographic region; human judgments additionally cluster by rider.
Include effect sizes, uncertainty intervals and all predeclared comparisons.
Use a multiplicity correction or explicitly distinguish exploratory outcomes.
Do not report per-route points as statistically independent trips.

An oracle over observed candidate union is a SAMPLED-POOL oracle only.

## Known code issues to resolve separately before confirmatory experiments

- The current allocation success probability in fun-generators.ts is hardcoded
  to 0.5, not estimated from real outcomes; profiles focus only on time/curves.
- The existing Ride Formula uses heuristic worthwhile-road labeling; do not
  present its Ride Arc quality as observed rider enjoyment.
- Some road-confidence inputs are constant heuristic values, not calibrated.
- Seasonal-window logic in route-intelligence/policy.ts uses UTC date fields;
  inspect local-midnight cases and prove correct semantics with fixtures.
- Current scorecards reject unequal ACTUAL provider attempts. A fair fixed-cap
  acquisition experiment should instead record comparable caps and actual
  cost as a distinct outcome; otherwise early stopping is wrongly excluded.

Keep these fixes outside the initial benchmark-contract PR. Track them as
explicit implementation hypotheses, then verify by unit and real-router tests.

## Reproducibility bundle

The published artifact should include: protocol and dated amendments; pinned
Git SHA; OSM extract/hash, GraphHopper and custom-model hashes; official road
source manifests with dated versions; route-source family identifiers; seeds;
hardware/environment; all attempted probes, errors and elapsed times;
evaluation code, route geometry after privacy review, split-audit report,
analysis scripts and a negative-result log.

Permission to redistribute rider GPX tracks/photos is NOT implied by their
being in an open-source application. Publish aggregate/hashes or obtain
permission for source data as needed. Collect no raw rider home location in
the blinded-choice study.

## Publication positioning

A reproducible applied geospatial methodology paper is a stronger near-term
fit than a claim of universal theoretical optimality. Journal of Location
Based Services explicitly covers LBS evaluation, volunteered geographic
information, navigation, context awareness and user studies:
https://www.tandfonline.com/journals/tlbs20/about-this-journal

No journal submission, ethics approval, preregistration or independent
reproduction is asserted by this document.
