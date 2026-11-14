# L7: Big trips read as days and sections

**Rider sentence:** "A BDR or a long trip reads as days and sections, with fuel and camps."
**Worker:** Sonnet for the page; DeepSeek V4.1 Flash for the section table in the builder. **Size:** M.
**Needs:** L3 merged.
Rules: `.fable/briefs/lib-0-rules.md`. Plan sections 3.1 and 5.1 (stage 5).

## Why
About 170 records are trips, not afternoon rides: 17 BDRs and 12 BDR-X routes, TAT sections, the Great Ohio
Adventure Trail (1,126 mi), the Texas backcountry route (1,849 mi), 134 records of 250 mi or more, 604
multi-state records. As one row with one number they are useless. BDR records carry section names in
`gpx.track_names` and easier and expert alternates in `alternates[]`. This is not the frozen long-trip planner
(`src/application/long-trip`); do not import or change it.

## Build
1. **Builder: `sections`** on every `trip` detail. When the record's GPX has several named tracks, each track
   is a section (name, miles, start, end, its own line in the pack as `<id>#<n>`). Otherwise cut the line every
   150 mi at the nearest point to a stop from `ancillary.fuel` or `lodging` when one lies within 10 mi of the
   cut, else at the plain distance; name those "Miles 0 to 150". A cut section is labelled a suggested split,
   never a "day" the source did not name.
2. **Fuel gaps.** Only when the record has fuel stops with coordinates: the longest stretch between them in
   miles, worded "Longest stretch between listed fuel stops: 118 mi (the source's list)". With no fuel list:
   "Fuel stops not listed." Never infer fuel from our own data here.
3. **Trip page** (the ride page with three additions): a "Sections" list (name, miles, type, "Open section");
   each section opens as its own ride page with the same credit and "Part of <trip>"; the map shows the whole
   trip with section ends marked; alternates listed under their section as "Easier way" and "Expert way" with
   the source's note.
4. **Policy.** A trip whose source is `link` (BDR today) shows the whole page from the record's text and stops,
   draws no line, and its primary action is "Get the track at ridebdr.com". When the owner names BDR and the
   tracks are fetched, the same page draws them with no code change.
5. **Explore:** the Big trips chip and section list each trip once; states touched are shown as "CO · 5 states".

## Files
`scripts/route-library/build-pack.ts`, `src/application/route-library/sections.ts`,
`src/ui/explore/routes-detail/TripSections.tsx`, `src/ui/explore/routes-detail.css` (at most 70 more lines),
fixture: one multi-track trip and one 300-mile single-track trip with two fuel stops.

## Pass/fail
- `npx vitest run tests/unit/route-library tests/unit/ui` passes, with cases: named tracks become sections in
  file order with measured miles; a 400 mi single line cuts into three with one cut pulled to a fuel stop 6 mi
  away and none pulled to one 14 mi away; section ids are stable across builds; the fuel-gap sentence appears
  only with coordinates; a `link` trip has sections text but no lines and the source button.
- Real build: paste the count of trips, the count with named sections against suggested splits, and the section
  table for the Great Ohio Adventure Trail and one BDR.
- Shots at 390 x 844 and 320 x 568, Day and Night: a trip page top, the Sections list, one section page, a
  link-only BDR page. Section rows 56 px, names never clipped mid-word at 320.
- `npm run typecheck`, `npm run lint`, `npm run css:budget` pass. No file under `src/application/long-trip`
  changes (state the `git diff --stat` line).
