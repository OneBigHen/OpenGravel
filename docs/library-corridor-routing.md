# Library corridor routing

Status: experimental, shadow-only first.  
Branch: feat/library-corridor-probes-20260930

## Decision

The next routing experiment should use the route library as a **candidate generator**, not as a new source of routing truth.

The useful unit is not "an old GPX route." It is a bounded road corridor extracted from a route/track and offered to the existing router as an ordered sequence of via anchors. GraphHopper still computes the legal connected path. OpenGravel still owns eligibility, access/closure evidence, scoring, diversity, roles, rider preference, and eventual semantic judgment.

That gives OpenGravel a way to search route-space it does not currently sample without forking GraphHopper or creating dozens of permanent profiles.

The first path is:

    caller-approved library lines
              |
              v
      repair / normalize GPX
              |
      optional map matching
              |
              v
        corridor windows
              |
      search-allocation prior
              |
              v
      reachability + direction
              |
              v
      2-5 ordered via anchors
              |
              v
         GraphHopper call
              |
              v
      corridor adherence check
              |
              v
       canonical eligibility
        evidence and scoring
              |
              v
      frontier / diversity
              |
              v
     rider feedback + optional
        Jev shadow judgment

The GPX/library source never establishes current access, surface, closure state, or safety.

## Findings from the live OpenGravel stack

### The provider seam already exists

ProviderRouteRequest already carries ordered shaping points. The GraphHopper request builder currently sends:

    origin -> stops -> shaping -> sketch anchors -> destination

A library corridor can therefore be tested without adding a new provider protocol. The current GraphHopper adapter can receive a cloned request whose shaping field contains a bounded corridor sample.

### One shaped corridor equals one route call

GraphHopper's alternative_route implementation currently accepts only a start and end point. A shaped corridor creates a multi-point via route, so it cannot simultaneously ask the engine for its normal alternative-route bundle.

That is desirable for the first experiment: one library probe should consume exactly one provider call and produce one candidate. It makes call-budget comparisons clear.

Source:
- https://github.com/graphhopper/graphhopper/blob/master/core/src/main/java/com/graphhopper/routing/Router.java

### Quick Ride loops need a separate generator

OpenGravel's current GraphHopper provider transforms request.discovery into GraphHopper round_trip. The request builder deliberately rejects round trips that contain stops, shaping points, or sketches.

Therefore the first corridor-probe implementation is restricted to ordinary point-to-point requests.

Do not hack corridor shaping into round_trip. The correct later loop architecture is to generate a small anchor sequence and route it as a normal closed via route:

    home -> corridor A -> corridor B -> home

That becomes the substrate for corridor-prize loops.

### LM constraints make anchor exploration more attractive

GraphHopper query custom models are merged with the prepared profile. In hybrid/LM mode, request-time multiply_by values must stay in [0, 1], and request distance_influence cannot be smaller than the prepared profile's value.

That means "reward this arbitrary GPX corridor by making it better than the prepared profile" is the wrong primitive. Penalty-only search probes are still useful for road attributes, but a library-specific corridor is better explored by via anchors.

Sources:
- https://github.com/graphhopper/graphhopper/blob/master/docs/core/profiles.md
- https://github.com/graphhopper/graphhopper/blob/master/docs/core/custom-models.md

### Map matching is useful preprocessing, not persistent identity

GraphHopper map matching follows an HMM/Viterbi approach and can snap GPX traces onto the road network. That is useful for malformed/noisy route libraries before corridor extraction.

Do not persist GraphHopper edge/node IDs as the durable corridor identity. GraphHopper explicitly notes that those IDs change across PBF/graph imports.

Source:
- https://github.com/graphhopper/map-matching/blob/master/README.md

A durable corridor should instead retain source geometry plus stable source/provenance metadata. If OpenGravel later needs road identity, prefer OSM-derived/stable identifiers exposed through its own graph build rather than GraphHopper internal edge numbers.

## What landed in this branch

src/application/planner/library-corridor-probes.ts is an isolated application-layer experiment.

It currently:

- validates caller-approved source lines;
- cuts long sources into bounded contiguous windows;
- ignores fragments below the minimum useful length;
- orients each corridor to reduce straight-line connector overhead;
- samples a bounded number of ordered shaping anchors;
- allocates a tiny probe budget deterministically;
- allows an explicit source priority without treating it as route quality;
- disables engine alternatives on the shaped request;
- refuses to interfere with discovery round trips, stops, authored shaping, sketches, or road spans;
- measures how much of the proposed source corridor the returned route actually recovered.

The default experiment is intentionally small:

- target corridor: 12 km;
- minimum corridor: 4 km;
- window step: 8 km;
- maximum shaping anchors: 5;
- maximum library probes: 1;
- maximum selected windows from one source: 1.

These are experiment defaults, not product policy.

## Important semantic rule: library presence is not preference

There are three different concepts and they must remain separate.

### 1. Personal history

A recorded ride means "we observed that the rider traveled here." It supports familiarity/novelty evidence.

It does not mean the rider liked the road.

PR #32 already gets this right.

### 2. Curated source value

A rider explicitly saving/favoriting a route, importing a route because they want to use it, marking "more like this," or selecting a trusted road catalogue can create a **search-allocation prior**.

That prior decides which corridor is worth spending a routing call on. It does not increase the returned route's canonical score.

### 3. Current route quality

The newly generated route must be measured again using current OpenGravel evidence:

- legal/access state;
- closures;
- surface;
- curvature/bend character;
- backroad character;
- traffic/junction flow;
- novelty/familiarity;
- time cost;
- authored constraints.

Only this layer can make the candidate competitive.

## First equal-budget experiment

Do not add a fourth/fifth provider call and then claim the library method improved routing. Hold the routing-call budget constant.

For the common three-lane point-to-point case:

Control:

    baseline-efficient
    balanced/scenic
    curvy

Treatment:

    baseline-efficient
    curvy
    library-corridor

In other words, replace the generic middle probe with one personalized/library-derived corridor probe. Preserve the efficient and twisty extremes.

When a surface-targeted lane is required, preserve it. The library call should replace the most generic middle lane, not a rider-explicit surface request.

### Candidate acceptance before comparison

A generated corridor candidate should be considered a successful probe only when:

1. the provider returns a usable route;
2. canonical hard eligibility passes;
3. access/closure handling is unchanged;
4. corridor adherence is high enough to prove the probe actually sampled the source section;
5. the route remains within a reasonable time/distance envelope for the request.

The exact adherence and detour thresholds should be tuned from the replay corpus rather than baked into product policy now.

### Measurements

For every control/treatment pair record:

- provider calls;
- provider latency;
- corridor adherence;
- duration and added time;
- distance;
- canonical score components;
- frontier quality vector;
- whether the candidate adds a previously missing Pareto/frontier region;
- geometry overlap with visible alternatives;
- rider blinded A/B preference;
- preference-model predicted probability;
- optional Jev Choice/Score/Noul shadow outputs.

The rider choice remains the gold-standard quality label.

### Corpus

Start with point-to-point requests because that is what the P0 implementation safely supports.

Build a PA/NJ replay corpus with:

- short local rides;
- medium backroad rides;
- longer destination rides;
- pavement-first cases;
- mixed/gravel cases;
- origin/destination pairs where the library has strong nearby corridors;
- negative controls where the library has no useful nearby corridor.

Do not select only cases where the library method is expected to win.

## Candidate generators: recommended order

### P0 — library corridor probe

Status: branch implementation exists.

Purpose: prove that forcing the router through one known/curated useful section can produce a candidate the profile lanes miss.

Call cost: one.

This is the cleanest test of the core hypothesis.

### P1 — departure-and-rejoin replacement

Given a baseline route:

    baseline ---- A ============== B ---- destination
                     dull section

Search for a library corridor near A/B:

    baseline ---- A -> corridor -> B ---- destination

The generator should choose a departure point and rejoin point on the baseline, then insert the corridor between them. This preserves authored stops and most of a route while replacing a weak section.

This is likely more useful than whole-route mosaics early because the search space is much smaller and the rider can understand the result.

Required measurements:

- replaced baseline metres;
- added minutes;
- corridor value;
- repeat-road change;
- route continuity;
- rejoin quality.

### P1 — missing-link discovery

Take two valuable corridors that nearly connect but have an unknown gap.

    known good A ====== ? ====== known good B

Ask GraphHopper for the connector, then measure the connector with current evidence.

The connector itself should get no positive score merely for linking two good roads. It must earn its own quality.

This can discover roads the rider has never used while leveraging the library as topology hints.

### P2 — best-section mosaics

Select two or three high-value corridors, order them, and ask GraphHopper to connect them.

This is a small prize-collecting/orienteering problem. Do not attempt arbitrary combinations.

Use a bounded beam:

1. choose reachable first corridors;
2. expand only the best few partial sequences;
3. reject dominated partial routes by time + accumulated corridor value + repeat cost;
4. stop at a strict call budget;
5. let GraphHopper connect the anchors.

The planner should never enumerate all corridor permutations.

### P2 — corridor-prize loops

The research framing here is Arc Orienteering: road sections carry value, traversal has cost, and the route has a time budget.

The classic Orienteering Problem maximizes collected value under a budget; Arc Orienteering attaches value to traversed edges/sections. Scenic Routes Now demonstrates an approximate dynamic-programming approach for a time-dependent AOP over a large road network.

OpenGravel should not implement a general exact AOP solver. The practical version is:

- generate a reachable corridor set;
- estimate connector costs cheaply;
- run a bounded beam/greedy search over 2-4 corridor prizes;
- route only the surviving sequences through GraphHopper;
- canonical-score the real returned paths;
- preserve the existing seeded round_trip as fallback.

Source:
- https://arxiv.org/abs/1609.08484

### P2 — similar-character discovery

Do not use an LLM to invent roads.

Represent known-liked corridors using the evidence OpenGravel already understands:

- curvature/bend density;
- backroad share;
- surface mix;
- grade/elevation;
- junction density/flow;
- traffic context;
- speed character.

Find nearby road/corridor candidates with similar measured vectors, then route through them.

This can use ordinary nearest-neighbor search over normalized features. The rider-preference posterior from PR #29 can determine which dimensions matter most without changing the evidence itself.

### P2 — Free Ride network-time branch search

Free Ride should not generate whole routes every few GPS fixes.

At stable decision windows:

1. identify upcoming network branches within a bounded time horizon;
2. score nearby library/unknown corridors as opportunities;
3. request at most one or two bounded branch alternatives;
4. verify return/continuation cost;
5. publish only one interruption-worthy suggestion.

This is where a library-derived road graph becomes especially useful: it tells Free Ride where interesting decisions may exist instead of searching a geometric cone blindly.

## PAunpavedroads-SE.gpx

The earlier read-only extraction found roughly 495 parseable fragments and about 501 km of source polyline despite malformed XML.

Treat this file as **corridor-discovery input**, not as a current road database.

Recommended ingestion:

1. tolerant fragment extraction;
2. coordinate validation;
3. remove zero-length/obvious duplicate fragments;
4. map-match plausible fragments against the current self-hosted graph;
5. retain original + matched geometry and source provenance;
6. split into bounded corridor units;
7. current route generation;
8. current access/closure/surface verification through normal OpenGravel evidence.

Do not label a route "gravel" merely because it touched a line from this file.

For a first live experiment, each of the 495 fragments can be its own LibraryCorridorSource. That works well with the default max-one-window-per-source diversity guard.

## Jev / TypeSafe role

Jev stays after deterministic truth and before presentation, in shadow until it earns influence.

Useful experiments:

### Choice

Input: two or three eligible candidates with compact measured evidence and no provider/profile names.

Question: which route best matches the rider's stated character?

Use it for blinded comparisons, not legality.

### Score

Input: one candidate's measured evidence.

Ask for semantic dimensions that are hard to express with a single deterministic number, such as:

- flowing vs technical;
- relaxed vs busy;
- cohesive vs patchwork;
- worthwhile detour.

Store the score separately from canonical evidence.

### Noul

Use for the marginal-decision question:

"Is candidate B's character improvement worth 12 extra minutes compared with A?"

This is a much better place for semantic judgment than "pick the route."

The rider's explicit feedback should always be retained beside Jev output so the experiment can measure calibration rather than assume it.

## Relationship to frontier routing

Frontier selection and library generation solve different problems.

Frontier routing asks:

> Given the candidates we found, which small set preserves the important trade-offs?

Library corridor generation asks:

> What different route-space should we spend calls exploring?

The correct order is:

    objective / rider intent
          |
    bounded generators
          |
    GraphHopper paths
          |
    canonical evidence
          |
    Pareto/frontier
          |
    low-regret reduction
          |
    geometry diversity
          |
    bounded personalization
          |
    optional semantic judgment

Do not use the preference model or Jev to modify measured facts. They influence search allocation or bounded selection only.

## Next implementation slices

### R1 — wire one shadow corridor call

Add a server experiment dependency that can supply LibraryCorridorSource records for a request.

For eligible point-to-point plans:

- resolve normal lanes;
- substitute one corridor probe for balanced/scenic;
- hold provider-call count constant;
- run the resulting candidate through the same road-authority and candidate pipeline;
- record adherence and experiment diagnostics;
- do not expose the treatment candidate by default.

The browser's private local library should not be uploaded wholesale just to support this experiment. A first developer corpus can be server-side/static. A later client-assisted version can send only the selected bounded corridor anchors/corridor fingerprint needed for that plan.

### R2 — replay harness

Create a deterministic replay report containing control and treatment candidate metrics and blinded geometry IDs.

The report should answer:

- did the probe actually traverse the intended corridor?
- did it add a new frontier region?
- how many extra minutes did it cost?
- was it geometrically distinct?
- did the rider prefer it?

### R3 — baseline departure/rejoin

Build a generator that takes one baseline candidate plus one library corridor and identifies feasible A/B replacement points.

This should be implemented before mosaics.

### R4 — loop anchor beam

Build a normal closed via route generator for timeboxed loops. Do not modify GraphHopper round_trip internals.

Keep the existing round_trip candidate as a control/fallback.

### R5 — missing links and mosaics

Only after replay data proves corridor probes add rider value should OpenGravel spend more calls connecting multiple corridors.

## Kill rules

Stop or simplify the experiment if any of these persist after tuning:

- corridor adherence is poor despite multiple anchors;
- via routing causes frequent U-turns/backtracking;
- the generated candidate rarely adds a new frontier region;
- rider-blinded preference does not beat the replaced generic lane;
- call latency is materially worse without rider benefit;
- source quality metadata becomes more complex than the route-quality evidence itself.

If via-point behavior causes U-turns, the next change should be heading/pass-through semantics or a narrow GraphHopper request extension, not an engine fork.

## What not to build yet

- no GraphHopper fork;
- no general-purpose exact orienteering solver;
- no vector database for GPX routes;
- no route embedding model;
- no LLM-generated road graph;
- no automatic "recorded = liked" labels;
- no persistent GraphHopper edge IDs;
- no production Jev route authority;
- no extra rider-visible mode called Library Routing.

This belongs inside the existing Planner, Free Ride, Quick Ride and Advisor experiences.
