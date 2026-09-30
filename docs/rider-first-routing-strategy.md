# Rider-first routing strategy — the OpenGravel Ride Arc

Status: research-backed product/routing direction  
Date: 2026-09-30  
Scope: existing Planner, Quick Ride, Free Ride, Advisor and Ride Focus modules

## Product thesis

OpenGravel should not try to be "Google Maps with a curvy button."

It should become the fastest way for a motorcyclist to turn **time + mood + bike + destination (optional)** into a ride that feels deliberately composed.

The internal model is a **Ride Arc**:

    ESCAPE  ->  CORE RIDE  ->  RETURN / ARRIVAL

Each phase has a different job.

- **Escape**: get through low-value urban/suburban friction efficiently.
- **Core ride**: maximize contiguous riding quality, not raw turn count.
- **Return / arrival**: protect the rider's time promise and finish cleanly.

This is not a new rider-facing mode. It enriches the modules OpenGravel already has.

## Why this is the differentiator

Current motorcycle products prove demand for:

- curvy/scenic routing;
- automatic round trips;
- route shaping;
- offline riding;
- road/trail discovery;
- minimal navigation;
- safety and current access information.

They also reveal the unresolved gap: route quality and navigation quality are often treated as separate products, and globally maximizing "curvy" can create routes that are technically bendy but annoying to ride.

Recent rider discussions repeatedly describe:

- tiny side-street doglegs;
- bad rerouting after leaving the planned line;
- excessive manual waypoints;
- navigation apps that are good planners but weak while actually riding.

OpenGravel can win by making **coherence, trust and low rider workload first-class route objectives**, not polish added after pathfinding.

## Competitive lessons

### Garmin zūmo

Useful ideas:

- one adventurous-routing control;
- round trips by distance or duration;
- direction bias;
- curve/speed-change rider alerts;
- route shaping.

Lesson: riders understand "how adventurous?" better than a panel of routing parameters.

### TomTom Rider

Useful ideas:

- separate turn and hill intensity;
- "Plan a Thrill";
- round trips built around chosen areas/stops.

Lesson: motorcyclists value character enough to accept longer routes.

### calimoto

Useful ideas:

- one-click round trip;
- winding/twisty profiles;
- recent routing work explicitly avoids larger cities and stop-and-go friction.

Lesson: city avoidance is not a cosmetic preference. It is part of what "fun" means.

### Kurviger

Useful ideas:

- Fastest / Fast and curvy / Curvy / Extra curvy;
- automatic round trips;
- explicit avoidances for motorways, main roads, narrow roads and unpaved roads;
- closures and elevation context.

Lesson: strong planning control is valuable, but OpenGravel should infer more of this from rider intent instead of exposing an expert console by default.

### Porsche ROADS

This is the closest product lesson to Ride Arc.

ROADS describes its scenic navigation as getting the driver out of heavy-traffic areas quickly, then considering speed, road types, environment, curvature and slope. Its route generator takes time and direction and creates a scenic round trip.

Lesson: **an enjoyable route is phase-dependent**. Efficient urban escape and scenic core riding are not contradictory objectives when applied to different parts of the ride.

### Beeline Moto

Useful ideas:

- Fast / Fun / Relaxed;
- Compass mode for light guidance;
- tracking without destination;
- tiny, glanceable navigation;
- audio and simple visual alerts before maneuvers.

Lesson: while riding, less interface can create a better product than more map.

### Scenic

Useful ideas:

- curvy destination routing;
- distance/direction round trips;
- customizable detour behavior;
- offline maps;
- glove-oriented interaction.

Lesson: route fidelity and reroute policy should be rider-controllable without constant interaction.

### REVER

Useful ideas:

- curated road catalog;
- different planners for twisty paved and off-road use;
- route recording/discovery.

Lesson: curated road knowledge is useful as candidate-generation input, but splitting planning engines can produce inconsistent navigation behavior. OpenGravel's provider-neutral candidate/evidence pipeline is the cleaner architecture.

### Detecht

Useful ideas:

- crash detection;
- safety contacts;
- planning, discovery and tracking integrated around the ride.

Lesson: safety can be part of the experience without becoming the routing algorithm.

### onX Offroad

Useful ideas:

- land/access context;
- open/closed status;
- high quality topo/aerial layers;
- snap-to-trail planning.

Lesson: for dual-sport/adventure riders, confidence that a road is legal/open can matter more than another few percent of "fun score."

## The core routing model

### 1. Author the objective, not engine knobs

The rider expresses:

- destination or loop;
- time / return-by;
- mood / road character;
- surface tolerance;
- bike capability;
- novelty preference.

OpenGravel derives a route objective internally.

Do not expose:

- GraphHopper profile names;
- custom-model multipliers;
- frontier weights;
- Jev scores;
- corridor-prize values.

### 2. Search several kinds of route-space

Use a bounded generator portfolio.

Initial generators:

1. efficient baseline;
2. twisty/flow profile;
3. library-derived corridor probe;
4. surface/adventure probe when explicitly relevant;
5. later: departure/rejoin replacement;
6. later: missing-link connector;
7. later: two/three-corridor loop beam.

Hold routing-call budgets constant during experiments.

### 3. Measure current truth again

Every returned path must go through the same canonical evidence:

- access;
- closures;
- surface;
- road class;
- curvature;
- traffic;
- junction friction;
- terrain/elevation;
- novelty;
- time cost;
- evidence confidence.

A GPX/library hit never proves current quality.

### 4. Add route coherence before recommendation

A motorcycle route should be judged on how it **flows as a route**, not just the properties of its roads.

The new pure diagnostic module:

    src/domain/route/coherence.ts

measures:

- maneuver density;
- explicit U-turns;
- geometry reversals;
- short maneuver legs;
- alternating short left/right doglegs;
- road-name change count;
- endpoint directness.

These stay diagnostics first. After replay/ride testing establishes thresholds, severe pathologies can become a pre-ranking quality gate.

This directly targets the common "curvy router sent me down a side street and back" failure.

## Ride Arc

### Phase A — Escape

Goal:

> Spend as little rider attention as practical reaching worthwhile riding space.

Optimize primarily for:

- low travel time;
- low urban friction;
- low maneuver density;
- predictable roads;
- minimal stop/sign/signal churn.

Do **not** waste route budget forcing twistiness through subdivisions.

A short highway/arterial segment can be correct if it buys substantially more high-value core riding time and the rider has not excluded it.

Diagnostic:

    escapeEfficiency =
      minutes until first sustained high-value corridor

The UI should express this naturally:

> 11 min out · 58 min backroads · 13 min home

### Phase B — Core ride

Goal:

> Maximize uninterrupted minutes on roads worth riding.

This is where corridor discovery, personal preference and frontier routing should spend their intelligence.

Prefer:

- sustained curvature;
- continuous road character;
- long useful gravel sections rather than tiny unpaved connectors;
- calmer/backroad context;
- lower junction workload;
- rider-liked character;
- meaningful novelty;
- current legal/open access.

Penalize:

- doglegs;
- repeated road reversals;
- intersection farming;
- tiny novelty detours;
- fragmented "good" sections connected by excessive filler.

Primary experimental metric:

    worthwhileMinuteRatio =
      estimated minutes in high-value core corridors
      ----------------------------------------------
                    total ride minutes

Do not expose a fake 0-100 "fun score."

### Phase C — Return / arrival

For a loop:

- continuously protect the return-time reserve;
- as the reserve shrinks, stop offering optional discoveries;
- if a closure/reroute consumes the buffer, switch to return-first behavior.

For A -> B:

- stop chasing route character when doing so creates an ugly approach to the destination;
- prefer a simple, legible final arrival.

## The route library becomes a road-memory graph

PR #33 is the first primitive.

Long term, treat saved/imported/recorded geometry as **corridor observations**, not just whole rides.

Each corridor can carry separate facts:

    Corridor {
      geometry
      provenance
      last observed / imported time
      current map match
      current evidence
      rider preference evidence
      familiarity / recency
      source confidence
    }

Important semantic split:

- ridden = familiar;
- liked/favorited = preference evidence;
- imported = search hint;
- trusted catalogue = search hint;
- current road evidence = route-quality truth.

This gives OpenGravel a personal "roads worth considering" graph without training a giant model or uploading raw lifetime GPS history.

## Loop routing: bounded Arc Orienteering

Quick Ride's real problem is not shortest path.

It is:

> Under a time budget, collect the best set of road sections and return on time.

This maps to the Arc Orienteering family of problems, where value is attached to road arcs and total route cost is bounded.

Do not build an exact general solver.

Practical implementation:

1. generate reachable corridor prizes;
2. estimate cheap connector costs;
3. keep only the best few partial sequences in a beam;
4. reject sequences that cannot preserve return reserve;
5. route surviving anchor sequences through GraphHopper;
6. measure the actual route with canonical evidence;
7. Pareto/filter/reduce to at most three real choices.

Initial beam:

- max corridor prizes per loop: 3;
- max partial sequences per depth: 6-10;
- max full GraphHopper route calls: 3-4;
- existing seeded GraphHopper round trip remains fallback/control.

## Point-to-point: escape + corridor + arrival

For A -> B, build the same concept without a loop:

    A
     \
      efficient connector
             \
          worthwhile corridor(s)
                    \
                  clean arrival
                         \
                          B

This should outperform a single global "twisty" weighting because the router is allowed to be efficient where efficiency buys more worthwhile riding later.

## Departure-and-rejoin should precede mosaics

Given a strong baseline route:

    A ----- baseline ----- X ===== boring ===== Y ----- B

Search one worthwhile corridor around X/Y:

    A ----- baseline ----- X -> GOOD CORRIDOR -> Y ----- B

Advantages:

- tiny search space;
- preserves stops;
- easy rider explanation;
- good regression behavior;
- lower call cost;
- directly useful for an existing favorite route.

This should be the next generator after the one-corridor P0.

## Missing-link discovery

Two good corridors nearly connect:

    known good A ===== ? ===== known good B

Ask the router to solve the connector.

Then judge the connector on its own evidence.

This is a powerful way to discover roads the rider has never used without asking a model to hallucinate where good roads might be.

## Similar-character discovery

Build normalized road/corridor vectors from measured evidence:

- sustained curvature;
- road class/backroad character;
- surface;
- elevation rhythm;
- junction density;
- traffic;
- speed environment.

Use nearest-neighbor retrieval to find geographically reachable corridors that resemble roads the rider explicitly likes.

No LLM or vector database is required in P0.

## Fast personalization

Keep the signed pairwise model from the rider-preference work.

Do not turn its signed means into positive-only frontier weights.

Correct near-term order:

    deterministic candidates
        -> eligibility/evidence
        -> generic Pareto/frontier
        -> geometry/coherence diversity
        -> bounded signed rider utility
        -> optional semantic judgment
        -> presentation

The learned model should become useful after a handful of informative A/B choices, then learn weakly from real behavior:

- explicit comparison: strong;
- explicit more-like-this: strong;
- selected route: weak;
- Free Ride Take: weaker;
- merely riding a road: no preference inference;
- ignoring a suggestion: no negative inference.

## Jev / TypeSafe

Jev should judge semantic questions only after deterministic facts exist.

Useful shadow evaluations:

### Choice

Among these already-eligible routes, which best matches the requested ride character?

Blind provider/profile identity.

### Score

Measure semantic qualities such as:

- flowing vs technical;
- cohesive vs patchwork;
- relaxed vs busy;
- worthwhile detour.

### Noul

Ask marginal questions:

> Is the improvement in riding character worth 12 extra minutes?

Never use Jev for:

- access;
- closure;
- legal status;
- surface truth;
- route geometry validity;
- final pathfinding.

## Free Ride: opportunity radar, not notification spam

Free Ride should act like a quiet copilot.

At a stable network decision point:

1. inspect the road network 5-15 minutes ahead;
2. identify one high-value branch/corridor opportunity;
3. verify access/surface/current time budget;
4. compare it against continuing straight;
5. show exactly one offer only if the difference is meaningful.

The rider sees:

    Better road in 0.8 mi
    +7 min · mostly new
             [ Take ]

If ignored, disappear.

Do not punish or nag.

A Free Ride suggestion is worthwhile only when it changes the next decision.

## Navigation should disappear while riding

Rider-facing principle:

> Detailed before the ride. Glanceable during the ride. Rich again after it.

Research on navigation workload consistently favors auditory or multimodal guidance over visual-only interaction, and destination-entry/navigation interactions are among the higher-demand in-vehicle tasks.

OpenGravel should therefore be audio-forward while moving.

### Ride Focus

Default moving screen:

- large next maneuver;
- distance to maneuver;
- route line and immediate context;
- three customizable stats;
- one important warning/opportunity at a time.

Avoid:

- persistent POI clutter;
- dense labels;
- panels that require reading;
- map controls needed during ordinary riding.

### Progressive detail

Far from maneuver:

- route + next-turn summary;
- stats dominate.

Approaching maneuver:

- maneuver grows;
- secondary map detail fades.

At decision:

- direction + road name + distance;
- spoken cue;
- optional haptic/paired-device cue later.

After turn:

- return immediately to calm state.

### Audio

Use staged prompts rather than constant speech:

- preparation;
- imminent turn;
- exceptional warning.

Do not narrate ordinary map context.

### CarPlay

The native navigation implementation should follow the platform's navigation model:

- CPMapTemplate as the root navigation surface;
- CPNavigationSession for active guidance;
- CPManeuver for upcoming instructions and travel estimates;
- dashboard/instrument-cluster guidance when available.

The phone and CarPlay should render the same ride state, not run separate navigation logic.

## Rerouting is a trust feature

A rider who intentionally leaves the route should not be punished.

Reroute policy:

1. preserve current destination/time constraints;
2. prefer rejoining ahead, never returning to an obsolete start;
3. preserve worthwhile upcoming corridors when reasonable;
4. if the rider repeatedly rejects the route, stop forcing it;
5. never silently replace a rider-authored GPX line when route fidelity was requested.

Measure:

- time to detect off-route;
- time to first usable replacement;
- distance ridden backward because of bad rejoin;
- preserved planned corridor share;
- rider cancellation/rejection.

This is more important to rider trust than another map layer.

## Trust layer

For dual-sport/adventure routes, show confidence explicitly.

Distinguish:

- mapped gravel;
- inferred/uncertain surface;
- current authoritative closure;
- seasonal restriction;
- unknown access.

Never collapse unknown into "probably open."

The system should be willing to say:

> Great road, access uncertain

instead of silently routing it.

## Map strategy

The map should serve decisions, not demonstrate graphics.

Priorities:

1. route hierarchy;
2. road surface/quality;
3. terrain shape;
4. closures/access;
5. fuel/critical services;
6. useful discoveries;
7. aesthetic 3D detail.

High-definition terrain/aerial imagery is valuable when stopped/planning. Ride Focus should aggressively simplify at speed.

## Product experience

### Quick Ride

The hero interaction:

    How much time?
    [45m] [1h] [90m] [2h]

    What sounds good?
    Curves · Backroads · Mixed · Surprise

    [ Ride ]

Then show at most three genuinely different results.

A route card should explain the ride, not the algorithm:

> 74 min
> 12 min out · 49 min good roads · 13 min home
> Mostly paved · 18 mi you haven't ridden lately

### Planner

For riders who know where they are going:

- destination;
- optional stops;
- current explicit preferences;
- route preview with real tradeoffs.

Do not require manual waypoint sculpting to get a good route.

### Advisor

Advisor should operate on intent:

> "Give me 90 minutes, paved, somewhere northwest, I want flowing roads."

It should produce/modify RideIntent and search objectives, not directly emit a route geometry.

### Library

Make roads reusable, not only rides:

- Favorite this road;
- More like this;
- Avoid this road;
- Surface wrong;
- Access wrong.

One post-ride tap should create far more value than a five-star rating form.

## Candidate presentation

Three choices maximum, and each must answer a different rider question.

Typical set:

- **Best ride** — strongest overall fit;
- **Quicker** — preserves most quality with less time;
- **Explore** — more novel/different character.

For explicit mixed/adventure intent:

- **More dirt** can replace Explore.

Do not expose fixed roles when the underlying routes are not materially different.

## Quality gates

### Route coherence gate

Initial shadow thresholds:

- any explicit U-turn -> investigate;
- any geometry reversal -> investigate;
- >14 meaningful maneuvers / 10 mi -> high workload diagnostic;
- 2+ short alternating turn pairs -> dogleg diagnostic.

Do not promote these to hard policy until replay and real rides show acceptable false-positive rates.

### Quick Ride

A good short ride should:

- start in seconds;
- require no waypoint cleanup;
- have a high worthwhile-minute ratio;
- keep return ETA inside tolerance;
- avoid maneuver spam;
- contain no obvious doglegs/reversals;
- expose surface/access uncertainty honestly.

### Free Ride

A suggestion must:

- be ahead;
- require no U-turn;
- materially improve the next 5-15 minutes;
- preserve time reserve;
- fit bike/surface constraints;
- respect suggestion cooldown/workload.

### Point-to-point

A fun route must prove that its added time buys meaningful core riding.

A 20-minute detour for one 90-second curvy side road is a failure.

## Benchmark strategy

OpenGravel needs a permanent PA/NJ motorcycle-routing corpus.

### Route groups

- suburban escape;
- dense urban edge;
- Bucks/Montgomery/Chester paved backroads;
- Delaware River corridors;
- NJ Pine Barrens mixed routes;
- central-PA mountain paved;
- state-forest mixed/adventure;
- long A -> B destination rides;
- repeated/local-history-heavy cases.

### Engines/providers

Compare:

- current OpenGravel GraphHopper;
- OpenGravel corridor/frontier experiments;
- Valhalla motorcycle as an external benchmark;
- selected BRouter motorcycle profiles where practical.

Do not migrate engines merely because one wins isolated routes.

### Blind rider evaluation

For every case:

1. hide engine/profile;
2. show route shapes/tradeoffs;
3. rider chooses preferred route;
4. ride selected cases physically;
5. record post-ride Great/Fine/Not for me;
6. mark specific good/bad road sections.

Primary experiment outcome:

    preference rate at equal routing-call budget

Secondary:

- worthwhile-minute ratio;
- urban escape time;
- added minutes;
- maneuver density;
- dogleg/reversal flags;
- route overlap;
- surface/access confidence;
- reroute recovery;
- return-time error.

## GraphHopper strategy

Stay on GraphHopper 11 for current production work.

GraphHopper 12's unreleased custom-model parameter feature is strategically valuable: server-defined bounded parameters can be overridden per request without repeating the whole custom model. When 12 ships stable, benchmark it as a cleaner implementation of dynamic probe parameters.

Do not depend on unreleased 12 behavior now.

GraphHopper's current LM/hybrid restrictions remain important: dynamic weighting should be penalty-oriented and monotonic relative to the prepared profile.

Structural corridor anchors remain the better tool for exploring arbitrary known-good road sections.

## Valhalla

Valhalla's current motorcycle costing is useful as a benchmark because it exposes dynamic:

- use_highway;
- use_trails;

alongside normal auto costing controls.

It is not a replacement for OpenGravel's evidence/frontier architecture. Use it to reveal blind spots.

## North-star metrics

Avoid engagement metrics like "screen time."

Product metrics should represent ride quality:

- rides started with no waypoint editing;
- rider preference at equal call budget;
- worthwhile-minute ratio;
- median urban escape minutes;
- avoidable maneuver density;
- dogleg/reversal incidence;
- reroute recovery time;
- actual vs promised return time;
- Great/Fine/Not-for-me;
- number of explicit road corrections required;
- percentage of suggestions accepted when shown.

The ideal product increases miles ridden while decreasing minutes spent operating the app.

## Implementation order

### R0 — now

- PR #33: library corridor probes.
- PR #34: exact bounded frontier representative selection.
- this branch: route-coherence diagnostics and full Ride Arc strategy.

### R1 — equal-budget corridor experiment

Wire one injected/server-side corridor source into planning in shadow.

Control:

    efficient + balanced/scenic + curvy

Treatment:

    efficient + curvy + corridor

Preserve explicit surface/adventure lanes.

### R2 — coherence replay

Run every candidate through coherence diagnostics.

Build a report of:

- U-turns;
- reversals;
- maneuvers/10 mi;
- short alternating turn pairs;
- canonical score;
- rider choice.

Establish thresholds from data.

### R3 — departure/rejoin

Replace one weak baseline section with one strong corridor while preserving the remainder.

### R4 — Ride Arc phase metrics

Add phase diagnostics:

- outbound escape minutes;
- core worthwhile minutes;
- return/arrival minutes;
- prompt density by phase.

Start as reporting only.

### R5 — loop beam

Replace some seeded round-trip calls with bounded corridor-prize anchor sequences.

Keep seeded round_trip as control/fallback.

### R6 — Free Ride network search

Use upcoming network decisions and corridor value rather than only geometric projection.

### R7 — personalized selection

Apply the signed local rider model to the small valid representative set.

### R8 — Jev shadow trials

Run Choice / Score / Noul on blinded structured candidate summaries and compare against explicit rider feedback.

Only grant influence where calibration beats deterministic baselines.

### R9 — navigation workload

Make Ride Focus/audio/CarPlay progressively reveal exactly the information needed for the next riding decision.

## Things not to build

- no "AI route" mode;
- no giant preference model;
- no social feed requirement;
- no gamification that competes for attention while moving;
- no exact continent-scale orienteering solver;
- no GraphHopper fork until bounded search experiments prove a real engine limitation;
- no fake surface/access certainty;
- no fourth/fifth rider-facing route when three meaningful choices do not exist;
- no 3D visual work that delays route/reroute correctness.

## Definition of success

OpenGravel is succeeding when a rider can decide at 5:10 PM:

> I have 75 minutes. Give me a good ride.

and by 5:11 PM be moving on a route that:

- gets out of boring traffic quickly;
- spends most of the available time on worthwhile roads;
- contains no stupid routing tricks;
- fits the bike and requested surface;
- feels increasingly personal after only a few choices;
- can recover cleanly when the rider ignores it;
- gets the rider home when promised;
- requires almost no screen interaction while moving.

That is the experience to optimize.
