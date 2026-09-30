# Rider preference learning — fast personalization without a gimmick

Status: foundation implementation + integration plan  
Branch: `feat/rider-preference-learning`

## Decision

OpenGravel should learn a rider's taste as a **small probabilistic preference model over route evidence it already owns**, not as a separate AI recommender and not as a deep model trained on hundreds of miles.

The first model is an 8-dimensional Bayesian-style pairwise preference learner:

- curvature
- backroad character
- unpaved share
- elevation
- calm traffic
- junction flow
- novelty
- time efficiency

Each road/route is projected into those bounded features from the existing deterministic `RouteScore`. The rider's hidden utility is a weight vector over those features. A pairwise choice updates only the dimensions that actually differ between the choices.

The likelihood is Bradley-Terry/logistic:

```text
P(A preferred to B) = sigmoid(w · (features(A) - features(B)))
```

The implementation keeps a diagonal Gaussian posterior over `w` and performs a bounded online Laplace/Newton update per observation. Prediction integrates posterior uncertainty, so a new rider starts near 50/50 rather than with fake confidence.

This is intentionally much smaller than deep inverse reinforcement learning. Deep route-choice models are useful when a fleet has enormous trajectory data; they are the wrong cold-start primitive for one rider who expects OpenGravel to improve after a few decisions.

## Why pairwise feedback

Asking "rate this road 1–5" makes riders invent a scale. Pairwise preference is easier:

> Which would you rather ride?

The answer gives a direct relative observation and maps naturally onto route ranking. Preference-based online learning / dueling-bandit literature exists specifically for this form of feedback, and recent cold-start work shows that adaptive pair selection can extract useful preference structure with fewer questions than a fixed seed set.

References:

- Bose et al., *Cold-Start Personalization via Bayesian Adaptive Questioning* (ICML 2026): https://proceedings.mlr.press/v306/bose26a.html
- De Pessemier et al., *Active learning algorithm for alleviating the user cold start problem of recommender systems* (Scientific Reports 2025): https://www.nature.com/articles/s41598-025-09708-2
- Bengs et al., *Preference-based Online Learning with Dueling Bandits: A Survey*: https://arxiv.org/abs/1807.11398
- Gharahighehi et al., *Pairwise and Attribute-Aware Decision Tree-Based Preference Elicitation for Cold-Start Recommendation*: https://arxiv.org/abs/2510.27342
- Cantürk & Aydoğan, *Explainable Active Learning for Preference Elicitation*: https://arxiv.org/abs/2309.00356
- Yang, Pan & Zhu, *Preference-Centric Route Recommendation*: https://arxiv.org/abs/2504.01192
- Mai, *Learning Sequential Mobility Choice* review: https://arxiv.org/abs/2608.15339

## The UX is not Tinder

Do not build an endless swipe feed.

Use a short, purposeful **Teach OpenGravel** interaction only when useful:

```text
Which looks more like your road?

┌─────────────────────┐   ┌─────────────────────┐
│ Creek Road           │   │ Ridge Road           │
│ curvy · quiet        │   │ faster · open        │
│ mostly paved         │   │ some gravel          │
│ [small map preview]  │   │ [small map preview]  │
└─────────────────────┘   └─────────────────────┘

       [ LEFT ]   [ BOTH / SKIP ]   [ RIGHT ]
```

The important part is **which comparison is shown**, not the swipe animation.

`selectPreferenceQuestion()` evaluates candidate pairs and asks about a pair when:

1. the current model is uncertain,
2. the roads differ on meaningful known features, and
3. the model still has posterior uncertainty on those features.

That makes 5–10 comparisons far more useful than 50 random swipes.

### Cold start target

A practical launch flow:

1. Start from the rider's existing authored controls (Curvy / Backroads / surface / novelty). Those remain authoritative route intent; do not duplicate them into hidden learned weights.
2. Generate a local pool of real candidate road/route snippets near the rider.
3. Ask **4 initial high-contrast comparisons**.
4. Recompute posterior after every answer.
5. Ask up to **4 adaptive comparisons** only while expected information value remains high.
6. Immediately use the posterior as a secondary personalization signal.
7. Stop asking. Let real route choices and explicit post-ride feedback refine it.

`selectPreferenceTeachingStep()` now makes that stop rule explicit in the domain layer:

- default minimum deliberate questions: 4;
- default maximum deliberate questions: 8;
- after the minimum, stop when the best remaining active-learning pair has weak information value;
- implicit route behavior never consumes the deliberate teaching budget;
- if the candidate pool has no informative known-feature contrast, stop instead of manufacturing a question.

This is a rider-time budget, not just an ML optimization. A preference setup that keeps asking questions after the useful information is gone is a product failure.

There is no "1000 miles before recommendations get good" requirement. With only eight broad axes and active pair selection, the model can become directionally useful after a handful of informative choices. It should still expose uncertainty and never pretend those first choices fully define the rider.

## What to learn from while riding

The dangerous implementation is "they rode it, therefore they liked it." That is false: the road may have been unavoidable.

Use this evidence hierarchy:

| Signal | Default weight | Learn? | Why |
| --- | ---: | --- | --- |
| Explicit A/B road choice | 1.00 | yes | direct preference |
| Explicit "more like this" / like | 0.80 | yes | direct but one-sided |
| Rider selects one shown route over alternatives | 0.35 | yes | useful but confounded by destination/time |
| Rider taps **Take** on a Free Ride suggestion | 0.25 | yes | weak positive signal |
| Rider ignores a Free Ride suggestion | 0.00 | **no** | workload/timing may be the reason |
| GPS simply travels a road | 0.00 | **no** | necessity is not preference |
| Reroute / deviation once | 0.00 | **no** | closures, mistakes, fuel, traffic |
| Explicit "not for me" / avoid this road | future strong negative | yes | direct negative preference |

The source-dependent weights already exist in the domain model.

## Existing OpenGravel architecture fit

OpenGravel already has the correct layers:

```text
GraphHopper candidates
       ↓
hard eligibility
       ↓
route evidence
       ↓
deterministic RouteScore
       ↓
diversity / roles / selection
       ↓
rider personalization (bounded modifier)
       ↓
presentation
```

The deterministic RoutePolicy remains the safety / constraint / explainability authority. Personalization must never:

- make an ineligible road eligible,
- manufacture missing surface/access/closure evidence,
- override an explicit current-ride preference,
- convert "unknown" into a neutral numeric value,
- make a safety claim.

The learned model is a **bounded preference modifier among already valid choices**.

## Integration sequence

### Phase A — foundation (this branch)

Implemented:

- `domain/personalization/rider-preference.ts`
  - posterior model
  - Bradley-Terry pair prediction
  - source-weighted online update
  - active A/B query selection
  - strict model validation
- `application/personalization/route-features.ts`
  - projects canonical RouteScore components into learning features
- `application/personalization/preference-repository.ts`
  - persistence port
- `infrastructure/storage/rider-preference-repository.ts`
  - stores one versioned local model in the existing settings table
- unit tests for cold-start learning and uncertainty behavior

### Phase B — planner reranking

Do **not** send raw ride history to the server.

Preferred shape:

1. server still returns up to three valid/diverse candidates with canonical scores,
2. client loads its local `RiderPreferenceModel`,
3. client projects each candidate's score to a preference vector,
4. client computes the pairwise/latent personal utility,
5. a bounded modifier reorders candidates only when:
   - at least two relevant learned dimensions have evidence,
   - posterior confidence clears a threshold,
   - the canonical scores are close enough that personalization is a sensible tiebreaker.

Initial bound: personalization may shift effective rank by at most **10–15 canonical score points**. It must not turn an objectively poor candidate into Best Ride.

The decision card should be able to explain the learned delta:

> More like roads you usually pick: quieter backroads and fewer intersections.

Do not expose model weights.

### Phase C — Free Ride

Free Ride is where this becomes valuable.

For each live suggestion:

- use the same canonical route evidence,
- apply the local rider model after eligibility,
- keep the workload/cooldown/ahead checks unchanged,
- weakly learn from **Take**,
- do not learn from ignore/pass.

This should reduce repetitive suggestions quickly without forcing interaction while riding.

### Phase D — active teaching

Add one entry point under rider preferences, not a new product mode:

> Teach OpenGravel

Generate 6–12 real nearby candidates, then let `selectPreferenceQuestion()` choose at most ~8 A/B questions. Stop early when information value drops.

Never ask while the rider is moving. Good surfaces:

- onboarding/setup
- planner idle state
- post-ride summary
- explicit settings action

### Phase E — richer road-level features

Only known or estimated measurements enter the model. Unpaved share requires complete surface accounting; partial coverage, missing unknown-distance accounting, and stale evidence remain unknown. Stored models are validated on load and save, and clearing preferences removes the local profile.

The current projection uses route-level score components where they are intrinsic enough, and measured surface evidence for unpaved share. It deliberately does not learn the current ride's surface-fit score because that already contains the rider's authored preference. Once road intelligence exposes stable intrinsic segment features, evolve the vector without breaking the model version:

- actual unpaved/gravel share rather than only surface-fit
- bend density / sustained curve length
- stop/sign/signal density
- road width / class
- traffic percentile
- elevation rhythm
- scenic evidence when it becomes policy-backed

That may justify model version 2 and a migration/reset. Do not silently reinterpret a v1 dimension.

## Jev / TypeSafe fit

OpenGravel already has `@typesafe-ai/sdk` and a Jev adapter for route character. Jev is useful here, but **not as the preference memory**.

TypeSafe positions Jev as a fast System One decision model: typed choices/scores with probabilities and confidence. That fits two optional jobs:

1. **Semantic prior from rider language**  
   Example input: "I like flowing paved mountain roads, hate stop-and-go suburbs, gravel is okay but not the point."  
   Jev can return bounded scores over the known preference axes. Those become a *weak prior*, never observations that overwhelm real rider choices.

2. **Feature interpretation where deterministic road evidence is semantically rich**  
   If a road candidate contains text/metadata that does not map cleanly to an existing scalar, Jev can classify a bounded attribute and return uncertainty.

It should not:

- call on every GPS fix,
- choose the final route,
- store the user's learned profile,
- infer access/safety from vibes,
- be required for self-hosted/OpenGravel core behavior.

Official TypeSafe references:

- announcement: https://typesafe.ai/blog/introducing-system-one-models-and-jev
- API: https://api.typesafe.ai/docs

## Privacy and sync

The learned model is tiny: eight means, eight precisions, eight evidence counts and two counters. That is the sync object.

Keep raw recording geometry where it already belongs. Cross-device sync should transfer only the versioned posterior unless the rider separately opted into ride-history sync.

This also makes merging practical. Future device merge can combine compatible Gaussian posteriors approximately in precision space rather than choosing "last writer wins":

```text
combinedPrecision = pA + pB - priorPrecision
combinedMean =
  (pA*mA + pB*mB - priorPrecision*priorMean) / combinedPrecision
```

That should be implemented only when the passkey/device-sync transport lands and can identify whether both profiles descend from the same prior/model version.

## Evaluation gates

Before letting personalization move the default selected route, add a replay harness.

Minimum evaluation set:

- synthetic rider archetypes:
  - paved twisties
  - flowing backroads
  - gravel explorer
  - efficiency-first
  - novelty seeker
  - familiar-road commuter
- cold start at 0 / 2 / 4 / 8 / 16 explicit comparisons
- noisy rider with 10–20% inconsistent answers
- missing surface / traffic / elevation evidence
- route sets where the canonical winner is much stronger than the personal favorite
- route sets with near-duplicates

Metrics:

- pairwise prediction accuracy
- regret versus the synthetic rider's hidden utility
- number of questions to reach useful rank agreement
- calibration of predicted pair probabilities
- rate at which personalization changes canonical winner
- false learning from implicit signals

Release gate for automatic reranking should be based on those metrics, not "the demo felt personalized."

## Non-goals

Do not add:

- TensorFlow/PyTorch
- collaborative filtering requiring a user account
- a central profile service
- a giant embedding per rider
- deep IRL trained on one person's GPS
- continual model calls while moving
- engagement mechanics, streaks, points or an infinite swipe feed

The product goal is simple: **after a few deliberate choices, OpenGravel should stop suggesting roads that are technically good but wrong for this rider.**
