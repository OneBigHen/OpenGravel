# Adventure integration — enrich existing modules, do not create a parallel product

Status: architecture correction / implementation map  
Parent PR: #25  
Authority for integration: this document overrides any earlier suggestion to add a standalone `application/world` or `application/quick-ride` subsystem.

## Product rule

Adventure is **not a new mode, tab, planner, scoring engine, or AI agent**.

It is a richer use of modules OpenGravel already has:

```text
Planner / RideAdvisor
       │
       │ creates normal RideIntent
       v
Canonical candidate pipeline / RoutePolicy
       │
       ├──────────────> RouteDecisionCard / Why this ride?
       │
       v
Ride Focus
       │
       ├── guided navigation
       │
       └── Free Ride
             ├── live-suggestions
             ├── opportunity
             ├── ride-offers
             ├── return-plan
             └── ride-interest

Discover / map-layers / recorded rides
       │
       └── provide better evidence and rendering to the same surfaces
```

The feature should feel new because the existing pieces get smarter together.

## Existing module ownership

| Existing module | Keep its job | Adventure enhancement |
| --- | --- | --- |
| `RideAdvisor` + `application/advisor` | Translate language to a reviewable typed ride proposal | Understand "90 minutes", "more roads I haven't ridden", "mostly paved", "back by 6"; never choose routes |
| `RideIntent` | Canonical authored ride preferences | Add one missing route-affecting preference: novelty |
| candidate pipeline | Eligibility, scoring, diversity, candidate roles | Feed better novelty / urban-friction / scenery evidence; no second score |
| `RoutePolicy` | Deterministic route ranking | Tune a new version only from ride-test evidence |
| `RouteDecisionCard` / explanation | Rider chooses among honest alternatives | Show "new-to-you", low-junction/flow and useful backroad deltas |
| `Free Ride` | Destination-free riding runtime | Becomes the live exploration experience |
| `live-suggestions` | Suggest one worthwhile road ahead | Better novelty/history evidence + time-budget guard |
| `ride-offers` | Whole-ride offer card | User-requested timeboxed loops inherit authored preferences |
| `return-plan` | Head home / easier return / loop planning | Protect back-by/remaining-time buffer |
| `ride-interest` | One useful thing coming up | Prefer new/high-value interests without adding another POI system |
| `Discover` | Normalize interesting places | Rank/map them better; choose optional 3D archetypes from existing categories |
| map layers / MapLibre host | Render map information | Explored-road styling, Adventure Vision, low-poly landmark layer |
| recorded rides / My Rides | Rider history | Source personal novelty and show "new good roads" in existing ride summaries |
| RiderSettings | Cross-ride UI preferences | Only persistent presentation choices; do not hide route authority here |

## What gets deleted from the concept

Do not build:

- `src/application/world/`
- `src/application/quick-ride/`
- a new Adventure tab
- a separate Progress tab
- a separate Adventure scoring engine
- a separate POI/WorldNode provider framework
- a second route-selection authority
- an always-running LLM copilot

Those would all duplicate current boundaries.

## The one real domain gap: novelty

The route stack already supports novelty more deeply than the authored ride model does.

Today:

- `PipelineIntent` already defines `NoveltyPreference`
- `RoutePolicy` already has a `novelty` score component
- route evidence already has a `novelty` key
- Free Ride discovery already takes `noveltyPreference`
- live suggestions already assess novelty
- route explanations already know how to say "more new-to-you road"

But `RideIntent` does not carry novelty.

That creates unnecessary split-brain behavior.

### Proposed narrow domain change

Promote:

```ts
type NoveltyPreference =
  | "prefer-new-to-me"
  | "balanced"
  | "prefer-familiar";
```

into the canonical authored ride intent.

Suggested field:

```ts
interface RideIntent {
  // existing fields...
  readonly noveltyPreference: NoveltyPreference;
}
```

Default:

```text
balanced
```

This is one route-affecting field and must therefore participate in:

- ride validation/default construction
- domain commands/reducer
- undo/redo
- canonical `intentIdentity`
- provider-independent candidate pipeline input
- Advisor proposal changes
- import/migration/defaulting
- tests

Do **not** persist it only in RiderSettings. It affects which route is selected, so it belongs with the ride question.

## RideAdvisor: interpreter, not route brain

The existing Advisor architecture is already right.

Its model currently outputs a bounded schema, place coordinates are resolved outside the model, and the proposal is dry-run through normal RideCommands before Apply.

Keep that boundary.

### Add exactly one Advisor field

```ts
noveltyPreference:
  "prefer-new-to-me" |
  "balanced" |
  "prefer-familiar" |
  null
```

Add the corresponding `AdvisorProposalField = "novelty"` and normal RideCommand.

No score, route geometry, route name, "best route", road safety conclusion, access claim or ETA may come from the model.

### Natural language examples

```text
"I have 90 minutes, curvy, mostly paved."
=> loop
=> budget 90
=> curvy
=> mostly-pavement
=> novelty unchanged
```

```text
"Give me 90 minutes of roads I haven't ridden."
=> loop
=> budget 90
=> prefer-new-to-me
=> preserve road/surface settings unless explicitly changed
```

```text
"Mostly paved, some new roads, home by 6."
=> returnBy 18:00
=> mostly-pavement
=> prefer-new-to-me
```

```text
"Use familiar roads, I just want an easy ride home."
=> prefer-familiar
=> other settings only if explicitly stated
```

### "Surprise me"

Do not invent a `surprise` domain enum.

"Surprise me" means:

- preserve rider-authored constraints
- use normal balanced novelty unless they explicitly ask for new/familiar roads
- let the deterministic planner choose its normal Best Ride
- optionally hide extra preview detail in presentation later

The LLM does not randomize the ride.

### "Scenic"

Do not invent a scenic preference in P0.

The canonical route evidence already includes `scenery`, but no authored policy currently maps "scenic" to a versioned weight vector.

Until that exists through normal RoutePolicy evolution:

- scenic places may be shown by Discover/ride-interest
- scenery may break ties only where existing policy already consumes it
- Advisor should not silently reinterpret "scenic" as another preference

If this becomes a repeated real rider need, add it deliberately to RoutePolicy later.

## AI must remain optional

Quick ride / Free Ride cannot require an AI provider.

Every common request gets a deterministic UI equivalent:

```text
90 minutes
Curvy
Mostly paved
Prefer new roads
```

Those controls directly emit the same RideCommands the Advisor would propose.

Advisor is convenience:

> natural language → existing typed controls

If AI is not configured:

- planning still works
- Free Ride still works
- ride offers still work
- novelty still works
- Discover still works
- progress/history still works

This keeps OpenGravel free and self-hostable.

## Planner: Quick Ride is a shortcut, not a new planner

The existing planner already understands:

- loop shape
- time budget
- back-by time
- curvy/backroads
- surface preference
- route alternatives
- route explanations
- Advisor

So "Quick Ride" should be a compact **preset interaction inside the current planner**, probably adjacent to or inside the existing `IntentComposer` / `RideStyleControls`.

Concept:

```text
QUICK LOOP

[45] [60] [90] [120 min]

[Curvy] [Backroads]
[Paved] [Mixed]
[Prefer new roads]

                 [PLAN]
```

It writes normal RideCommands.

There is no `QuickRideRequest` authority after the button is pressed.

### Back-by

"Back by 6:15" is already `TimeIntent.returnBy`.

Do not create a second return-deadline model.

If a quick loop uses a duration, use the existing budget/tolerance semantics first. The proposed extra "reserve" should be evaluated as policy/UX on top of existing timebox handling, not become another competing clock until ride tests justify it.

## Candidate scoring: use the existing RoutePolicy

Earlier Adventure drafts proposed a second weighted formula.

Delete that idea.

The current RoutePolicy already scores:

- curvature
- backroad character
- surface fit
- elevation
- traffic
- junction friction
- novelty
- closure risk
- time cost
- confidence

That is almost exactly the "middle-aged rider with 90 minutes" problem.

### Enhancement path

Improve the evidence feeding those existing components:

- `novelty`: personal recorded-road history
- `junctionFriction`: signals/junctions/turn burden
- `traffic`: current/provider evidence when available
- `backroad`: road-class/flow evidence
- `scenery`: useful explanatory/context evidence
- `closureRisk`: authoritative access/closure sources

Then version `RoutePolicy` if real ride testing proves weights should change.

Do not add `candidate-score.ts`.

### Fun-minute ratio

Keep "fun minutes" as:

- a diagnostic
- a ride-test metric
- potentially rider-facing descriptive copy

It is not a new ranking authority in P0.

The closest existing structural behavior already exists: Free Ride scores the **middle 70%** of a loop via `coreRidingSection()`, specifically excluding unavoidable local egress/return.

Build on that instead of creating a second "escape score" pipeline.

## Candidate diversity already exists

RoutePolicy already has:

- `diversityLambda`
- `duplicateSimilarityThreshold`
- `maxAlternatives`

The pipeline already assigns material route roles such as:

- Best Ride
- Fastest
- Fast and Fun
- More Twisties
- More Dirt
- Lower Workload

Do not hard-code a new "exactly Best Flow / Most New / More Adventure" route taxonomy.

Instead, improve the current role presentation when novelty is material.

Potential future role:

```text
More new-to-you
```

only if it clears the same materiality rules as More Twisties / More Dirt.

Until then, novelty belongs in "Why this ride?" and chips, not a forced role.

## Free Ride is the Adventure runtime

This is where most of the concept should land.

### Existing Free Ride loop

```text
position
  ↓
live-suggestion query
  ↓
candidate pipeline
  ↓
evidence
  ↓
one opportunity
  ↓
Take / ignore
  ↓
guided route
  ↓
returns to Free Ride
```

That already is a motorcycle exploration loop.

Enhance it rather than create quests.

## Free Ride live suggestions

`live-suggestions.ts` already carries:

- road-character fit
- surface fit
- novelty

`opportunity.ts` already turns those into rider copy:

- Curvier
- More gravel
- New to you

That is Adventure already.

### Needed enhancement

Make the novelty evidence real.

A local ride-history evidence adapter should answer:

> What share of this suggested segment is on worthwhile road the rider has not ridden, or has not ridden recently?

The adapter feeds the existing `LiveSuggestionEvidence.novelty`.

No UI change is required for the first implementation.

Example result:

```text
River Road
left in 0.7 mi
New to you · Curvier · about 6 min
```

## Free Ride ride offers

Whole-ride `ride-offers.ts` already supports:

- shared/catalog ride
- timeboxed loop
- home

That should absorb "Quick Ride while already riding."

### Change loop offers, not the concept

Current automatic loop constants are 45 and 90 minutes.

Do not simply make automatic offers 45/60/90/120; that would create more unsolicited noise.

Instead:

- automatic offers remain sparse
- rider-requested "Give me a loop" can choose 45/60/90/120
- selected time is passed into existing `returnPlanner.plan({ mode: "loop", loopMinutes })`
- the loop inherits the ride's road/surface/novelty preferences

No new planner.

### Offer summary enrichment

Today a loop offer is effectively:

> 45 min curvy loop · Curvy · Back here

Once evidence is present, allow the existing card to say only the strongest facts:

> 58 min loop  
> Curvy · 14 mi new-to-you · Mostly paved

or

> 91 min loop  
> More gravel · Back here

Maximum three chips stays a good constraint.

## Time budget while riding

Time awareness belongs in Free Ride, not AI.

The live runtime already has:

- navigation state
- return planner
- current position
- current route duration
- Home target
- loop planning

Add a deterministic offer guard inside the existing Free Ride module.

Concept:

```ts
interface FreeRideTimeGuard {
  canSuggestDetour: boolean;
  expectedReturnAt: string | null;
  remainingBufferMinutes: number | null;
}
```

This is derived state, not authored authority.

Inputs:

- authored `RideIntent.time`
- current time
- current position
- current return-plan estimate when available
- suggested detour duration

Behavior:

- enough margin → normal opportunity
- small margin → only zero/near-zero-cost opportunities
- margin gone → suppress fun detours
- Head Home remains available

No LLM call.

No "AI decided you should go home."

## Ride-interest: Discovery already has the right UI

The existing ride-interest system merges:

- Discover/Wikimedia
- map-layer stops
- places/events

and intentionally shows one nearest "coming up" chip.

Keep it.

Adventure should improve ranking, not replace the model.

### New-to-you

A place can be considered new-to-you from local visit history, but do not expand `InterestingPlace` into a giant WorldNode schema.

Attach rider-local presentation metadata at the application/view-model edge, for example:

```ts
interface RideInterestPresentation {
  readonly point: RideInterestPoint;
  readonly previouslySeen: boolean | null;
  readonly priorityBoost: number;
}
```

Or keep it entirely inside the scene/ranker if the UI does not need the raw flag.

### 3D landmarks

Use existing categories to choose model archetypes:

```text
bridge       -> covered_bridge.glb when subtype/evidence supports it
viewpoint    -> lookout.glb
architecture -> landmark fallback
history      -> historic_mill.glb only when evidence matches
camping      -> camp.glb
```

This belongs in MapLibre rendering infrastructure.

Do not create spatial assets in Discover data.

The canonical feature stays a place; the renderer decides how richly to draw it.

## Progress lives in My Rides, not a new Progress product

The rider should see progression where ride history already lives.

Enrich existing ride summaries with:

```text
61 mi total
18 mi new-to-you worthwhile roads
6 mi gravel
2 discoveries
```

A My Rides map can optionally show:

- worthwhile roads ridden
- favorite roads
- roads not ridden recently

No separate Progress tab is needed.

Collections can come later as sections within Explore/My Rides if they prove motivating.

## Map layers: exploration is an overlay

Add explored-road rendering to the existing map-layer system.

Possible layer:

```text
Road history
```

or fold it into an Adventure preset.

Rendering state can be computed from:

- normal road geometry
- personal ride-history segment matches
- current-ride segment matches

Map style:

- unridden road: normal base style
- ridden worthwhile road: subtle cool underlay
- new this ride: temporary warm underlay
- current route remains visually dominant

This is a presentation layer only.

It never changes route legality.

## Rider history: one reusable evidence source

The strongest shared investment is not a new UI.

It is a local road-history matcher that can answer for a geometry:

```ts
interface PersonalRoadHistoryEvidence {
  assessGeometry(
    geometry: readonly Coordinate[],
  ): Promise<EvidenceValue<{
    newShare: number;
    recentShare: number;
    familiarShare: number;
  }>>;
}
```

This one evidence source can power:

- planner novelty score
- Free Ride loop discovery
- live suggestion novelty
- route explanation
- pre-ride "12 mi new-to-you"
- post-ride "18 mi new roads"
- map explored-road styling

The implementation should live with existing route/road evidence infrastructure, not in an Adventure namespace.

## AI Advisor + Free Ride relationship

Do not connect them directly at runtime.

Correct:

```text
Advisor (before ride / stopped)
     ↓
normal RideIntent
     ↓
Ride Session
     ↓
Free Ride reads those normal preferences
```

Wrong:

```text
Free Ride
  ↓ every few minutes
ask LLM what to do
  ↓
LLM picks road
```

Reasons:

- unnecessary cost
- variable latency
- poor offline behavior
- more distraction
- model output would compete with deterministic evidence
- difficult reproducibility
- violates existing "AI has no rank authority" architecture

## One cohesive user story

### Before leaving

Rider opens current planner.

They either tap normal controls:

```text
Loop · 90 min · Curvy · Mostly paved · Prefer new roads
```

or type into existing Advisor:

> I've got 90 minutes. Mostly paved, curvy, show me some roads I haven't done.

Advisor proposes those exact settings.

Rider applies.

Normal planner returns its normal candidate bundle.

RouteDecisionCard says:

> Adds 6 minutes for a curvier line and more new-to-you road.

Rider taps Navigate.

### While riding

Ride Focus remains Ride Focus.

No gamification dashboard.

Free Ride / guided ride can surface:

> New-to-you road left in 0.7 mi · Curvier · about 6 min.

Ride-interest can surface:

> Covered bridge 0.8 mi.

If the rider takes a Free Ride opportunity, normal guided routing takes over and then hands back to Free Ride as it already does.

### Near the time limit

Free Ride time guard suppresses optional detours.

Head Home uses the current return planner.

### After the ride

Existing My Rides/recording summary adds:

> 18 mi new-to-you worthwhile roads  
> 6 mi gravel  
> 2 discoveries

The map can highlight the newly ridden segments.

No separate Adventure session exists anywhere in that flow.

## P0 implementation order

### 1. Canonical novelty

Promote `NoveltyPreference` into `RideIntent`.

Wire it through:

- defaults
- validation
- commands/reducer
- identity
- pipeline
- Free Ride discovery
- live suggestion request inheritance
- import/migrations/tests

### 2. Advisor parity

Add novelty to the existing strict schema and proposal command path.

Add eval cases:

- "roads I haven't ridden"
- "new roads"
- "stick to roads I know"
- "mostly familiar"
- preserving novelty when not mentioned

### 3. Planner control

Add one small novelty choice to existing ride-style controls:

```text
Road familiarity
[ New to me ] [ Balanced ] [ Familiar ]
```

Default balanced.

Avoid a gamified label.

### 4. Personal novelty evidence

Build the local ride-history evidence adapter.

Use recorded ride traces and matched worthwhile road segments.

Unknown matching must yield unknown evidence, not zero novelty.

### 5. Free Ride gets the same evidence

Feed that adapter into current:

- Free Ride discovery
- live suggestions
- ride offers where evidence is available

No new card type.

### 6. Explanations

Use existing `RouteExplanation` novelty axis to produce useful comparison copy.

Example:

> Adds 7 minutes for a curvier line and more new-to-you road.

### 7. Time guard

Add deterministic detour suppression to the existing Free Ride store/application seam using authored time intent + return estimate.

### 8. Ride summary

Add new-to-you road mileage to existing completed-ride detail.

### 9. Map rendering

Add explored-road styling to current MapLibre scene/layers.

### 10. 3D landmarks

Only after P0 ride behavior works.

Map existing Discover/map-layer categories onto a tiny reusable GLB set.

## Acceptance test: no duplication

A change fails architecture review if it introduces any of these:

- a route preference not represented in canonical RideIntent or an explicitly non-route UI setting
- a second candidate scorer
- a second route planner
- an LLM-produced route rank
- a new POI authority
- a new ride execution state machine
- an Adventure-only version of navigation
- a second deadline/time-budget model
- a cloud dependency for personal novelty
- a feature that disappears when Advisor AI is disabled

The desired end state is not "OpenGravel plus Adventure."

It is simply **OpenGravel, with a planner that knows your roads and a Free Ride mode that keeps finding good reasons to keep riding.**
