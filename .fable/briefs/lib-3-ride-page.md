# L3: A ride page worth the trip

**Rider sentence:** "The ride page tells me if this ride is worth the trip."
**Worker:** Sonnet. **Size:** M. **Needs:** L1 merged; shows more once L2a and L2b land (render what is present).
Rules: `.fable/briefs/lib-0-rules.md`. Layout: `.fable/LIBRARY-PLAN.md` section 3.2 (third sketch) and 3.3.

## Why
After L1 a library ride opens in the existing ride page through an adapter, so it shows a name, a line, a
summary and a credit. The record holds much more: why it scored, rider comments (364 records), stops (114),
season, permits, access, track year, other sites that list it, longer rides it belongs to.

## Build
The ride page reads `GET /api/route-library/rides/<id>` beside the catalog entry when the entry has
`referenceTrack`, and adds these blocks in this order. A block with nothing to show is not rendered.
1. **Eyebrow:** quality word and type ("STANDOUT · TWISTY"); "Loop" when flagged.
2. **Numbers:** miles and estimated time as today.
3. **Truth lines** (reuse the existing truth-line styles): surface wording from `facts.ts`; "Track from 2011.
   Check roads first." when `old`; "Rough line: only the outline of this ride is known." when `rough`;
   "Measured 144 mi; the source says 79 mi." when `mismatch`.
4. **Weather line** for the start, as the page does today; an active alert is always shown in full.
5. **Actions:** "Follow this track" (primary; absent when rough or no line), then Save, Share, GPX in one row.
   GPX links to `/rides/<id>/gpx`; when the policy is `link` the button reads "Get the GPX at <source>" and
   opens the source page. A ride with no line: primary is "Open at <source>".
6. **About this ride:** summary, then "Why it is here" (the score reason) in secondary ink.
7. **Riders say:** up to 3 comments, each quoted with author, month and year and a link; "All comments at
   <source>" when a thread URL exists. A source rating reads "4.6 of 5 from 23 riders on <source>".
8. **Stops:** fuel, camping, lodging, sights as rows with name and note; a stop with coordinates gets a dot on
   the map; each row names its source.
9. **Good to know:** season, permit, access, difficulty; each is the quote with "the source says", or
   "Season not stated".
10. **Also on / Part of / Includes:** one line per site with its credit and link; related rides as links.
11. **Credit footer:** "Route by <author> · <source>" with the link (the 2026-11-12 rule), then
    "Report a problem with this ride", a `mailto:` or the existing feedback endpoint (`/api/feedback`) carrying
    the ride id.
Trail bundles draw all their segments; the page title area says "Trail system" and the miles read "about 68 mi
of trail" (a sum, never a ride length).

## Files
`src/ui/explore/RouteDetail.tsx` (compose only; put the new blocks in `src/ui/explore/routes-detail/*.tsx`),
`src/ui/explore/routes-detail.css` (at most 180 lines; raise the budget by exactly that),
`src/app/ExploreRouteDetail.tsx` (fetch), `src/application/route-library/client.ts` (ride fetch and types).

## Pass/fail
- `npx vitest run tests/unit/route-library tests/unit/ui` passes, with render cases from the fixture pack: the
  dirt road shows comments and stops with their sources; the no-track riding area shows "Open at <source>" and
  no Follow button; the rough track shows the rough line and no Follow button; the link-only road's GPX button
  names the source; a record with every fact `null` renders no "Good to know" values other than "not stated";
  the string "legal" never appears for a record whose legal status is `null`.
- `tests/e2e/critical/explore-country.spec.ts` gains: open the dirt fixture ride, the credit link has the source
  URL, GPX downloads a file whose metadata contains the credit sentence, Save puts it in My rides with the credit.
- Shots at 390 x 844 and 320 x 568, Day and Night: a Standout twisty road, the dirt road scrolled to "Riders
  say", the riding area, the trail bundle. No clipped line at 320; buttons 48 px; one green button per screen.
- `npm run typecheck`, `npm run lint`, `npm run css:budget` pass.
