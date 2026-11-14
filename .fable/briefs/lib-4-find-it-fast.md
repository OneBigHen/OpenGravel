# L4: Find a good ride in three taps

**Rider sentence:** "I find a good ride in three taps: near me, by state, by type, by name."
**Worker:** Sonnet. **Size:** M. **Needs:** L1 merged; better after L2a (one card per road).
Rules: `.fable/briefs/lib-0-rules.md`. Layout: `.fable/LIBRARY-PLAN.md` sections 3.1 and 3.2 (first sketch).

## Why
After L1 the list is "what is in view" plus chips. With 5,800 rides the list view needs a front page that
answers the questions riders actually ask, and one search box that understands a ride name, a state and a town.

## Build
1. **Explore front page** (list view, no search typed, no chip on), sections in this order, 5 rows each with
   "See all": Near you (rides starting within 75 mi, best first; grows to the nearest 20 when fewer than 5; when
   location is off the section is one row, "Turn on location, or pick a state below"); Best in <the rider's
   state, else the last state browsed, else Pennsylvania> (score 5 then 4); Famous roads (ids from
   `src/application/route-library/famous-roads.ts`, 40 ids picked from the score-5 set: Tail of the Dragon,
   Cherohala Skyway, Blue Ridge Parkway, Beartooth Highway, Going-to-the-Sun Road, Million Dollar Highway,
   Pacific Coast Highway, Natchez Trace, Kancamagus, Pig Trail and so on; an id missing from the pack is
   skipped); Big trips; Browse by state (grid of state name and count, 3 across at 390, 2 at 320, most rides
   first); Trails and riding areas.
2. **A filtered list** for every chip, state, "See all" and search: title with a count ("Twisty in North
   Carolina, 212 rides"), rows best first, pages of 30. Filters in one sheet (phone) or popover (desktop):
   Type (the five), Length (Under 30 mi, 30 to 90, 90 to 250, 250+), "Standout only", "Loops only", "Has a track
   to follow", State. Sort: Best (default), Nearest, Shortest, Longest. All of it in the URL; Back restores it.
3. **Search:** one box, results as you type from the index (name words, state names and abbreviations, source
   names; exact name start first, then all words present, best score first). Below the ride results, up to 3
   places from the existing geocoder (`/api/geocode`, debounced 300 ms): choosing "Asheville, NC" opens the map
   view centred there with "Rides near Asheville". Check that the geocoder answers outside PA/NJ; if it is
   boxed to our coverage, say so in the PR and widen only its Explore call.
4. **Old filters retired:** the curated and personal rides join the same list and filters (their own source
   filter stays: From Explore, Yours, Imported). Remove the now-unused selects (PA riding area, region) and
   their CSS; `?area=` and `?region=` links keep working by mapping to State.
5. **Thumbnails unified:** every row uses the line-shape thumbnail (decision already logged in L1: library
   rides); extend it to curated rows and add one decision-log line saying so.
6. Records with no place show in state lists and search with "Not on the map yet".

## Files
`src/ui/explore/ExplorePanel.tsx` (split it: `ExploreFront.tsx`, `ExploreResults.tsx`, `ExploreFilters.tsx`),
`src/application/route-library/search.ts`, `famous-roads.ts`, `src/application/explore/query.ts`,
`src/ui/explore/explore.css` (must shrink: net CSS for this package is zero or negative), `DESIGN.md` (one line).

## Pass/fail
- `npx vitest run tests/unit/route-library tests/unit/application/explore tests/unit/ui` passes, with cases:
  search "dragon" puts Tail of the Dragon first; "nc twisty" and "North Carolina" both give North Carolina rides;
  a 6,000-row search answers in under 30 ms; Near you grows to 20 when the radius holds fewer than 5; a
  multi-state ride appears under each of its states; `?area=` legacy links land on the right state list; every
  filter round-trips through the URL.
- `tests/e2e/critical/explore-find.spec.ts` (390 x 844, fixture pack): from a cold `/explore`, reach a Standout
  twisty ride page in 3 taps or fewer by (a) Near you, (b) Browse by state, (c) typing a name. Location denied
  still shows the front page with no blank section.
- Shots at 390 x 844 and 320 x 568, Day and Night: front page top, front page scrolled to Browse by state, a
  filtered list, the filter sheet open, search with ride and place results. No dead space at the top; state grid
  two across at 320 with no clipped names (use "N. Carolina" style short names only if a full name clips).
- `npm run css:budget` passes with the total not higher than before this package.
- `npm run typecheck`, `npm run lint` pass; existing Explore e2e specs pass or are updated in the same PR with
  the reason stated.
