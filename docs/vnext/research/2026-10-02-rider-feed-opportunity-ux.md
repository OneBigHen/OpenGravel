# Rider Feed and Route-Aware Opportunities UX

Date: 2026-10-02  
Branch: `feat/seasonal-road-intelligence`

## Product decision

OpenGravel has two distinct browsing jobs before a route exists, and a third contextual job after one exists.

The top-level Explore experience should therefore expose **two feeds**, not three provider-shaped tabs:

1. **Ride** — motorcycle roads, legal trails, gravel/unimproved corridors, seasonal openings and ready-made rides.
2. **Things** — rider-worthy events, destinations and stops around the rider.

Once a route exists, neither of those broad feeds should be dumped into the planner. The planner gets a separate, route-aware surface:

3. **Along this ride** — a small set of road opportunities, events and stops whose value is specifically improved by the planned corridor.

This replaces the earlier Rides / Roads / Openings information architecture. "Opening" is a property of a road opportunity, not a destination by itself.

## 1. Explore -> Ride (default)

This is what a rider sees when opening Explore.

It should contain only motorcycle-relevant riding content. No concerts, happy hours, generic attractions or restaurants appear in this default feed.

Suggested order:

### Open this weekend

Only when there is something genuinely time-sensitive nearby:

- seasonal Game Lands road is open;
- DCNR forest road is within a published opening window;
- a legal WMA/forest corridor has a narrow access window;
- a good road is closing soon.

The row disappears entirely when there is nothing useful. Never show an empty "calendar" module just because the feature exists.

### Worth riding

Road and trail sections ranked specifically for a motorcyclist:

- verified dirt/gravel/unimproved;
- low maintenance / limited winter service;
- forest / Game Lands / WMA character;
- low traffic;
- curvature and terrain;
- useful continuous length;
- rider novelty;
- evidence confidence;
- connection value to other good corridors.

A road should be shown as a **section worth riding**, not a raw GIS feature.

### Popular riding areas

Clusters rather than hundreds of pins:

- Hamburg / Blue Mountain;
- Pine Barrens;
- Bald Eagle / central PA forest roads;
- known rider corridors derived from the route corpus.

A cluster opens into its best roads, legal-access state and seasonality.

"Popular" should initially mean source-supported popularity (multiple route-corpus overlaps, repeated rider use, provider popular flag, strong multi-source evidence), not invented social popularity.

### Ready-made rides

Existing catalog/community rides stay available but are secondary to the live road intelligence. They answer "give me something finished" rather than "what roads are interesting today."

## Time UI inside Ride

Do not make a month calendar the primary interaction.

Use a compact date lens:

**Now · This weekend · Next weekend · Pick date**

Changing the date re-evaluates road access and opportunity ranking.

The expanded calendar view can exist for planning several weeks ahead, but it is a drill-down from Ride, not a top-level navigation item.

## 2. Explore -> Things

This is a deliberate second feed. It can use a much larger radius because a motorcyclist is looking for a destination to ride to, not the nearest coffee shop.

Default radius: approximately **100 miles**, bounded to 125 miles by the server implementation.

The feed is intentionally small: normally **6–8 cards**, never an endless local-directory list.

Useful item classes:

- motorcycle / car / outdoor events;
- fairs, festivals and unusual local events;
- scenic destinations;
- waterfalls, overlooks, covered bridges and ruins;
- museums or roadside oddities worth riding to;
- popular rider stops;
- strong food / coffee / happy-hour destinations;
- motorcycle shops or gathering spots once that source exists.

Events are capped so a dense event provider cannot dominate the page. Current rank policy allows at most three event cards before other destination types must surface.

## Things ranking

Do not sort by nearest.

A rider-specific destination score should roughly behave like:

```text
rider_value =
    category_value
  + time_relevance
  + popularity
  + rating
  + novelty
  + destination_distance_sweet_spot
  - obvious_low_value_penalties
```

The distance curve is deliberately non-standard:

- <5 miles: little bonus;
- 5–25 miles: useful;
- 25–80 miles: often ideal as a ride destination;
- 80–120 miles: still viable;
- beyond the chosen ride radius: excluded.

This lets a genuinely interesting destination 55 miles away beat a generic venue 2 miles away.

## Things interaction

Opening Things should not silently request precise location.

If geolocation permission is already granted, OpenGravel may populate it immediately after the rider opens the tab. Otherwise show one clear action:

**Find things worth riding to**

After permission:

- show the sparse ranked feed;
- keep a small "100 mi" radius control;
- offer time chips: Today / This weekend / Next weekend;
- show why each item appeared: "Popular stop", "Happening soon", "Worth the ride";
- show distance only as context, not the primary ordering.

Events and places from the Places contract are sourced through the existing server boundary. `events.henning.rodeo` is the intended first-party provider deployment for that contract.

OSM Discover fills durable rider destinations so the feed is still useful when there are few events.

## 3. Planned route -> Along this ride

A planned route creates a different user job:

> I already chose where I am riding. Is there anything close to this ride that makes it better?

Do not replace Explore's global feeds and do not automatically mutate the route.

Add one compact module in the route result / inspector:

**Along this ride**

It should be lazy. No provider calls until the rider opens it.

The first collapsed state may show a single summary when cached data exists:

- "3 good stops near this route"
- "1 seasonal road opens Saturday"
- "Bike night 0.7 mi off route"

When opened, return at most about **five primary suggestions**.

## Route-aware opportunity types

The panel can mix two classes because both answer the same contextual question.

### Road opportunity

Examples:

- a newly open forest road 4 miles from the current line;
- a gravel corridor that can replace a dull paved section;
- a legal dirt connector that turns two good sections into one loop.

Action:

**Route through it**

That becomes an explicit rider intent / preferred road span and triggers the normal planner. The suggestion itself never edits the route.

### Stop opportunity

Examples:

- event;
- scenic overlook;
- diner;
- museum;
- popular rider stop.

Action:

**Add stop**

That uses the existing typed stop command and then replans.

## Route-aware scoring

Once a route exists, distance-from-home should mostly disappear. **Detour cost** becomes the main cost term.

```text
route_opportunity =
    rider_value
  + timing_fit
  + on_route_bonus
  + popularity
  + road_opportunity_value
  - detour_minutes
  - access_uncertainty
```

Suggested interpretation:

- 0–3 min detour: strong bonus;
- 3–8 min: still attractive;
- 8–15 min: only worthwhile items survive;
- 15–25 min: strong penalty;
- >25 min: normally hidden unless explicitly requested.

The server route-opportunity endpoint already uses the existing corridor Discover and Places contracts and returns a bounded ranked result.

## Timing against the planned ride

Events become substantially better when OpenGravel can answer whether they fit the ride.

For a place with a known route mile and event time, derive an approximate arrival using the selected route's duration and distance.

Useful copy:

- "Mile 42 · arrive about 5:20 PM · starts 6 PM"
- "On now · 4 min off route"
- "Closes before you'd arrive"

An event that ends well before estimated arrival should normally be hidden rather than shown with a warning.

This is a deterministic time calculation. An LLM is not needed.

## While actively riding

The full Explore feeds are the wrong UI at speed.

Reuse the existing Ride Interest pipeline:

- Scenic
- Food
- Events

Only show things ahead of the rider, bounded to the corridor and the next portion of the ride. At most one or two strong prompts should compete for attention.

Free Ride remains road-first. Event/food prompts are opt-in through Ride Interest rather than injected into the Free Ride copilot.

## Calendar behavior

"Calendar" is one shared time model, projected differently by context.

### In Ride

Shows opening/closing transitions for roads.

### In Things

Shows events and time-bound destinations.

### With a route

Shows only items compatible with the route corridor and expected ride timing.

A full month grid is optional. The core UX is:

**This weekend / Next weekend / Pick date**

## Data/architecture rules

One provider should not leak its vocabulary into the UI.

Existing seams remain:

- `RoadAuthorityRecord` -> legal / seasonal road truth.
- road evidence / Interesting Road Corpus -> motorcycle road character.
- `InterestingPlace` -> durable destinations.
- `NearbyPlace` -> events / happy hours / provider places.
- `RiderOpportunity` -> sparse rider-oriented projection.
- Ride Interest -> active-ride projection.

The same source data can therefore appear differently without becoming separate truth databases.

Examples:

- A waterfall appears in Things when no route exists.
- After a route is planned, the same waterfall appears only if its detour is reasonable.
- During the ride, it appears only while ahead of the rider.
- None of those appearances change the route until the rider taps an action.

## Minimalism rules

- Ride feed: no generic event cards.
- Things feed: normally 6–8 cards.
- Global Things: no more than 3 events in the leading result set.
- Planned route: about 5 primary opportunities.
- Active ride: at most 1–2 attention-demanding opportunities.
- Empty sections disappear.
- No provider-shaped tabs.
- No automatic route changes.
- No month calendar before the simpler weekend/date lens.
- No continuous location polling merely because Explore is open.

## First implementation target

The current PR should converge on this structure:

```text
Explore
  [ Ride ] [ Things ]

Ride
  This weekend              (only when useful)
  Worth riding
  Popular riding areas
  Ready-made rides

Things
  Today / This weekend
  sparse rider destinations
  events.henning.rodeo + OSM Discover

Planner (route exists)
  Along this ride
    Worth a detour
    events/stops
    seasonal-road opportunities

Ride Focus
  existing Scenic / Food / Events ahead
```

The current experimental separate Openings lens should be folded into Ride before merge.
