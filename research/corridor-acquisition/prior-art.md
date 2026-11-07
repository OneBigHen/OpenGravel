# Prior art and reviewer objections (reviewed 2026-10-15)

This is a scoped, non-systematic literature review, NOT a novelty clearance,
patent opinion, or claim that no closer work exists. Reviewers should search
transportation, GIS, operations research, recommendation, and Bayesian
optimization literature before submission.

| Literature | Established contribution | Novelty implication |
| --- | --- | --- |
| Chen et al., ScenicPlanner, Frontiers of Computer Science (2017), DOI:10.1007/s11704-016-5550-2 | Scenic route planning informed by heterogeneous crowdsourced place/footprint signals | GPX/social popularity plus attractive road routing is NOT, alone, new |
| Jossé et al., Scenic Routes Now, ACM SIGSPATIAL (2017), DOI:10.1145/3132847.3132874 | Time-dependent arc orienteering on road graphs | Finding the highest-reward road route subject to time is established |
| Truschel et al., Multi-Criteria Route Planning with Little Regret, ATMOS (2025), DOI:10.4230/OASIcs.ATMOS.2025.13 | Regret-based representation of multiple routing objectives | Regret minimization over candidate paths is established |
| Wan and Dodge, Revealing drivers route choice preferences through traffic-aware characterization and evaluation, Journal of Location Based Services (2025), DOI:10.1080/17489725.2025.2601133 | Independently evaluates actual route-choice preferences and traffic-aware route characteristics | Rider preference models and empirical route choice are a core baseline, not a novelty claim |
| Golovin and Krause, Adaptive Submodularity, JAIR (2011), DOI:10.1613/JAIR.3278 | Sequential information acquisition under uncertain outcomes | Adaptive greedy acquisition itself is established; no approximation guarantee without proving assumptions |
| Xie et al., Cost-aware Stopping for Bayesian Optimization, ICML (2026), https://proceedings.mlr.press/v306/xie26c.html | Cost-aware acquisition and stopping with guarantees in their setting | Expected improvement divided by query cost is NOT novel |
| Survey of Route Recommendations: Methods, Applications, and Opportunities (2024), https://arxiv.org/abs/2403.00284 | Landscape of personalized route recommendation | Add recent graph-based, multimodal, and personalized competitors |

## Narrow potential research contribution

A reproducible, empirically calibrated acquisition policy that learns the
feasibility, adherence, and incremental value of **corridor-shaped queries to a
black-box road router** using noisy source-road evidence. Evaluation must use
held-out geographic clusters and identical query budgets, then verify that
candidate improvements translate into independent rider judgments.

Novelty depends on evidence that corridor-conditional learning *beats*
simple strong alternatives, not merely static profile routing.

## Anticipated reviewer objections and required evidence

1. **"ScenicPlanner already does this."** Compare to a faithful
   implementation of a published scenic/corridor approach or explicitly
   acknowledge when only a limited approximation is available.
2. **"This is cost-aware Bayesian optimization with roads."** Show the
   role of route-specific reachability, source confidence, corridor adherence,
   overlap, and hard access verification through controlled ablations.
3. **"Your objective is self-fulfilling."** Primary human evaluation must not
   reuse the reward function on which the method was trained.
4. **"Your data leaks."** Split by route/source family and geographically
   buffered clusters, not randomly by request. Include spatial overlap audit.
5. **"Your comparisons buy more calls."** Predefine equal maximum attempt
   budgets, count retries, alternatives, and failed/empty requests.
6. **"No real road was independently checked."** Audit route-access decisions
   against independent, dated authority evidence, including unknown status.
7. **"Your statistical units are not independent."** Cluster by ride area,
   paired OD case and rider in the inferential model; publish CIs.
8. **"Your adaptation is fake."** A fixed 50% prior is not calibration.
   Fit on randomized exploration observations, report calibration/error,
   compare against unconditional cost-aware acquisition.
9. **"Your selector changed your candidate generator."** Isolate a common
   generator pool and compare acquisition policies holding probe supply
   fixed; separately test full end-to-end pipelines.
10. **"Can results reproduce?"** Pin data, graph extraction, software versions,
    seed, deadlines, hardware/host, and failure logs; publish replay tooling.

## Explicitly disallowed publication claims at this stage

- "First algorithm to discover scenic roads."
- "Improves rider enjoyment" without independent rider evidence.
- "Safe/legal routes" without audited jurisdictional, temporal coverage.
- "Globally optimal" from an oracle defined over a sampled candidate pool.
- Theoretical regret or approximation bounds without formal assumptions/proofs.
