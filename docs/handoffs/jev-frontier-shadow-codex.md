# Local Codex handoff — PR #51 Jev frontier shadow

Work in repository: `OneBigHen/OpenGravel`

Pull request: `#51 Experiment: bounded Jev frontier shadow judge`

Branch: `feat/jev-frontier-shadow`

## Goal

Finish the first executable Jev 1.13 experiment without giving Jev routing
authority.

The branch already contains:

- `docs/jev-frontier-shadow.md`
- `src/application/planner/jev-frontier-shadow.ts`
- `tests/unit/application/jev-frontier-shadow.test.ts`

Read those files first. Treat their boundaries as requirements.

Also inspect before editing:

- `src/infrastructure/routing/jev-fun-character.ts`
- `src/server/planning/plan-service.ts`
- `src/application/planner/frontier-routing.ts`
- `src/application/planner/pipeline.ts`
- `src/domain/personalization/rider-preference.ts`
- `src/application/personalization/route-features.ts`
- `tests/real-router/routing-quality-corpus.ts` from PR #39 if available
- PR #34 exact bounded-regret work
- PR #39 permanent PA/NJ routing-quality corpus
- PRs #37/#40/#43 only for Free Ride boundary context; do not wire Jev into
  Free Ride in this PR.

## Critical sequencing fact

The frontier selector is merged, but as of PR #51 creation it is still an
experimental pure selector and is not the production planner's rider-visible
selection path.

Do **not** invent a fake live post-frontier hook.

The first executable slice should therefore be:

1. server-only Jev adapter;
2. deterministic state/question builder;
3. replay/shadow evaluator that can consume a stable 2–3 candidate set;
4. diagnostics/JSON output for corpus comparison;
5. only wire into `planRide` if you can prove there is now a real stable
   post-frontier shortlist on the branch you are working from.

If that seam still does not exist, leave production `planRide` behavior
unchanged and document the exact future insertion point.

## Implement the provider adapter

Create an infrastructure implementation of the application-owned
`JevFrontierJudge` port, probably under:

`src/infrastructure/routing/jev-frontier-judge.ts`

Use the already-installed `@typesafe-ai/sdk ^0.6.0`.

Useful SDK facts:

```ts
import { choice, noul, score, TypeSafeClient } from "@typesafe-ai/sdk";
```

For the OpenRouter experiment configure:

```ts
new TypeSafeClient({
  apiKey: process.env.OPENROUTER_API_KEY,
  baseURL: "https://openrouter.ai/api",
  defaultModel: "jev-1.13",
  timeout: 1500,
  retry: { maxRetries: 0 },
  logLevel: "off",
});
```

The TypeSafe SDK appends `/v1/systemone` to that base URL. OpenRouter maps
`jev-1.13` to `typesafe/jev-1.13`.

Pin 1.13 for P0. Do not use `jev-latest`.

Do not expose the key to browser code.

No configured OpenRouter key => return no judge / no call.

## One request per stable candidate set

One Jev request should answer all questions against the same compact state.

### Choice

Options are each supplied candidate id plus `NONE`.

Instructions must say, in substance:

> Choose the already-eligible candidate that best matches the rider's explicit
> current ride intent and supplied rider-preference summary, using only supplied
> measurements. Choose NONE if the supplied evidence does not support a
> meaningful preference. Do not infer legality, access, closure, safety,
> missing road facts, or unsupplied characteristics.

Remember that TypeSafe does not send the question id as semantic content. Put
meaning into instructions/criteria.

### Per-candidate Score

One score question per candidate, using exactly this 0–3 ordered rubric:

0. Poor fit — materially conflicts with supplied current intent/preference.
1. Acceptable — usable but little evidence of a particularly strong match.
2. Strong — clearly matches several supplied priorities without a material
   supplied tradeoff.
3. Exceptional — unusually strong match across priorities supported by the
   supplied evidence.

The returned score is probability-weighted and can be fractional. Preserve the
full probability distribution and confidence.

Call it semantic/rider fit. Never call it RouteScore.

### Noul

Use an independent proposition, not one that depends on the Choice output:

> At least one supplied non-baseline candidate is meaningfully better matched
> than the deterministic baseline to this rider's explicit current intent and
> supplied rider-preference summary.

Preserve the returned `noul` probability directly.

## State rules

Use `JevFrontierState` exactly.

No raw GPX.
No raw GPS history.
No saved ride list.
No arbitrary account metadata.
No geometry unless you can prove the compact measurements are insufficient.
Do not send any ineligible candidate.

OpenGravel computes all arithmetic before the call.

Jev may receive:

- explicit current RideIntent fields;
- precomputed timebox-satisfied boolean/null;
- final frontier quality vector;
- canonical score/rank;
- distance/duration;
- evidence coverage;
- compact rider posterior weights/evidence counts;
- precomputed rider preference utility;
- deterministic coherence metrics.

Unknown remains null. Never turn missing evidence into 0.5 or prose such as
"probably okay."

## Failure policy

The experiment must be incapable of breaking planning.

- zero retries;
- strict timeout;
- caller abort respected;
- transport failure => null/no judgment;
- invalid state => no call;
- malformed answer => null/no judgment;
- invented candidate id => null/no judgment;
- malformed probability map => null/no judgment;
- missing score => null/no judgment;
- low confidence => retain telemetry, no production behavior change.

Do not copy Jev Router's fail-the-request semantics into OpenGravel routing.

If you add a foreground budget, follow the existing
`jev-fun-character.ts` pattern: provider timeout around 1.5 s, smaller planning
wait around 0.8 s, no retry, and cache only compact deterministic state.

## Replay / corpus harness

Prefer an explicit experiment runner over premature production wiring.

The permanent corpus is being built in PR #39. If it has landed, extend it.
If it has not landed, either:

- stack narrowly on the relevant two real-router test files, or
- add a replay fixture/harness to PR #51 without merging unrelated PR #39 code.

Emit stable machine-readable JSON for each candidate set containing:

- schema version;
- corpus/request id;
- candidate ids/fingerprints;
- deterministic baseline id;
- canonical ranks;
- rider preference utilities/probabilities if available;
- exact Jev model snapshot returned;
- Choice + all option probabilities + confidence;
- every candidate Score + distribution + confidence;
- Noul probability;
- latency;
- input tokens / cost if the SDK response exposes them;
- validation/failure reason;
- telemetry-only counterfactual status.

Never log keys or raw GPS.

## Invariance tests

Add tests proving the route-plan result is unchanged when Jev is:

- absent;
- enabled and agrees;
- enabled and strongly disagrees;
- returns NONE;
- low confidence;
- malformed;
- times out;
- throws;
- aborted.

If there is not yet a true live frontier seam, prove invariance at the
experiment runner/adapter boundary instead of hacking the old planner selection
just to satisfy this checklist.

The key invariant is:

```
bundle.candidates
bundle.roles
bundle.selectedRouteId
bundle.selectionSource
```

must not change in P0 because of Jev.

## Architecture checks

No domain module may import the Jev infrastructure adapter.

No route authority / access / closure module may import it.

No canonical scoring module may import it.

No `RouteScore` field is overwritten from Jev output.

No candidate is added or made eligible based on Jev.

The adapter should depend inward on the application port, never the reverse.

## Do not do these in PR #51

- Do not wire `typesafe/jev-router` into motorcycle routing.
- Do not change Free Ride behavior.
- Do not change selectedRouteId from Jev.
- Do not add Jev values into canonical scoring.
- Do not let Jev infer legal access, closures, surface truth or safety.
- Do not send raw rider history to the server just to improve this experiment.
- Do not merge unrelated visualization/map work.
- Do not switch GraphHopper.
- Do not make a GraphHopper fork.

## Optional second experiment spec only

If the routing work is complete and clean, you may add a short separate spec
for testing `typesafe/jev-router` at the **AI Advisor transport** boundary.

That experiment may choose the generative LLM/effort only. Existing Advisor
schema validation, geocoding and command application remain authoritative.

Do not implement that second experiment in the same runtime path unless it is
trivially isolated and has its own evals.

## Validation

Before pushing final work, run:

```bash
npm run lint
npm run typecheck
npm run test:unit
npm run test:architecture
npm test
npm run build
```

Run the real-router corpus too when its required services/env are available:

```bash
npm run test:real-router
```

If live credentials are unavailable, do not fake a passing live Jev call.
Unit-test the adapter with an injected fetch/client seam and report exactly what
was not exercised.

Review the final diff adversarially for:

- hidden routing authority creep;
- accidental raw rider-data upload;
- model alias drift;
- retries/latency on the ride path;
- threshold constants masquerading as product policy;
- confusing Jev confidence with option probability;
- confusing Jev semantic score with RouteScore.

Then push to `feat/jev-frontier-shadow` and update PR #51 with what is actually
implemented, tests run, and any blocked live validation.
