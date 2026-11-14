# L8: Trail systems and riding areas are places

**Rider sentence:** "A trail system is a place I can ride to, with its permit and season."
**Worker:** Sonnet. **Size:** M. **Needs:** L2b and L3 merged.
Rules: `.fable/briefs/lib-0-rules.md`. Plan sections 1 (point 3), 3.1 and 3.3.

## Why
About 900 records are not lines to follow: 186 trail bundles (Michigan DNR ORV trails, Nevada OHV networks, up
to 56,605 points of separate segments), about 470 RiderPlanet riding areas and 58 Minnesota DNR trails with no
track, 240 single-track records. 842 are "designated OHV" on the source's word; permits are quoted (Michigan
ORV licence on 159, California sticker on 83, Minnesota registration on 58). Shown as rides they mislead: a
bundle's "miles" is a sum of segments, and nobody follows a park from start to end.

## Build
1. **Area page** (kind `area`; the ride page with a different top): eyebrow "TRAILS" or "RIDING AREA"; title;
   "About 68 mi of trail" for a bundle (a sum, labelled) or nothing for an area with no track; the truth lines:
   "Open to motorcycles, the source says", the permit quote, the season quote or "Season not stated", trail
   width or difficulty only when quoted. No time estimate. No "Follow this track".
2. **Map:** a bundle draws all its segments as thin dashed plum lines with no start or end markers; an area with
   only a point draws one dot and a soft ring; an area with no place shows no map and says "Not on the map yet".
3. **Actions:** primary "Ride to the trailhead" when the record has a place (`pp` `trailhead` or `area`) and a
   router covers the rider (the existing ride-to-start flow; basic-route label rules from L5 apply); otherwise
   primary "Open at <source>". Secondary: Save, Share, and GPX of the trail network where the policy allows.
4. **Explore:** the Trails chip and the "Trails and riding areas" section list areas with a place first. Card:
   name, "Trails" or "Riding area", state, the permit in four words or fewer when quoted ("MI ORV licence"),
   credit. On the map an area is a dot at every zoom from 7 up; its segments draw only on its own page (a
   56,000-point network must never load into the browse map).
5. **Never routed over.** Area segments are never handed to the router as shaping points and never appear in
   "near your route" (L6 already limits itself to kind `road`).

## Files
`src/ui/explore/routes-detail/AreaHeader.tsx`, `src/ui/explore/RouteDetail.tsx` (choose the top by kind),
`src/ui/explore/RoutesMap.tsx` (area dots), `src/application/route-library/area.ts` (wording),
`src/ui/explore/routes-detail.css` (at most 60 more lines).

## Pass/fail
- `npx vitest run tests/unit/route-library tests/unit/ui` passes, with cases: a bundle never shows a time or
  "Follow this track"; the miles sentence says "of trail"; a record with legal status `null` shows no access
  line at all; the permit line is the quote, uncut, on the page and at most four words on the card; an area
  with no place renders without a map; bundle segments are absent from the state line file (assert on the pack).
- `tests/e2e/critical/explore-country.spec.ts` gains: Trails chip, open the fixture bundle, segments drawn,
  "Ride to the trailhead" present with a fixture router and absent without one.
- Shots at 390 x 844 and 320 x 568, Day and Night: a Michigan-style bundle page, a riding area with a dot, a
  riding area with no place, the Trails list.
- Real pack check (attach): the five largest bundles each open in under 2 s on a throttled phone profile, or
  say which did not and by how much.
- `npm run typecheck`, `npm run lint`, `npm run css:budget` pass.
