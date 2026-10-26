# Rider journey audit — read-only walkthrough (DeepSeek worker)

Status: research note. **No code was changed by this audit.** The only commit is this file.

## What this is

Five rider journeys were walked through the source, as a motorcyclist with gloves on a
phone, against `docs/vnext/design/maps-for-riders.md` (the interaction contract) and the
core invariants in `CLAUDE.md`. Entry points: `src/app/PlannerClient.tsx`,
`src/app/ExploreClient.tsx`, `src/app/RideClient.tsx`, `src/app/RidesClient.tsx`.

Method and limits, stated up front:

- Everything below is read from code. **No browser, device, or screenshot was used**
  (workers may not build, serve, or run Playwright), so tap counts are the taps the code
  requires, and layout claims come from the stylesheet rules that apply at 320/375/390 px
  (`max-width: 760px`, `max-width: 1180px`).
- Where a claim depends on rendering that could not be observed, the item says so.
- Nouns follow the code: planner = `/`, Explore = `/explore`, Ride = `/ride`,
  My rides = `/rides`.

## Tap counts (code-derived, phone, location already granted)

| Journey | Taps | Contract target |
| --- | --- | --- |
| (a) open → Gas → a station → Directions → Start ride | 4 | ≤ 4 (`§6`) |
| (a) same, first run with location not yet granted and refused | 4 to a dead end, then ≥ 3 more to set a start by hand | — |
| (b) open → 2-hour twisty loop | **5** (Loop → 2 h → Ride style → Curvy → Make my loop) | ≤ 4 (`§6`) |
| (b) via press-and-hold "Loop from here (1 h)" | 1, then ≥ 4 to change it to 2 h and twisty | — |
| (c) Explore list → route → ride it | 2 screens of navigation + 2 taps (card → *Plan this ride* → *Start ride*), plus a replan wait | "one obvious action" |
| (d) riding → gas ahead as a stop | 4 (Menu → Add a stop → Gas → Go) | — |
| (d) riding → end ride | 3 (Menu → End ride → Save ride) | — |
| (e) finish → find it in My rides → GPX | 1 (*View in My rides*) + 2 (row → Export) + 1 (a variant) | — |

Detail worth noting for (a): four taps only holds when the location lookup succeeds.
`usePlaceFlow.tsx:88-107` sets the destination and returns early when the start could not
be located, so the sheet comes back with no route at all and no `Start ride` to press.

## Ranked issues (top 30)

Severity: **P1** = the rider is blocked, misled, or the product claims something untrue.
**P2** = friction, jargon, or an inconsistency that costs taps or confidence.
**P3** = polish with a real cost at the roadside.

### P1

1. **P1 — (a),(b),(c) The phone has no map tool bar, so `Draw` / `Add stop` and their instructions are unreachable on the map.** `src/ui/planner/phone-plan.css:16` hides `.og-editbar` inside the map slot; the dock only renders that bar on the desktop tier (`src/ui/planner/PlannerWorkspaceDock.tsx:431`), while the frame puts it in the map slot for every non-desktop width (`src/ui/planner/PlannerWorkspaceFrame.tsx:198`), and the armed-tool hint is deliberately suppressed whenever the bar exists (`PlannerWorkspaceFrame.tsx:90-93`). *Fix: render one 48 px armed-instruction row ("Tap the map where the stop goes", plus Done/Cancel while drawing) inside the phone sheet head whenever a placement tool or the pen is armed.*

2. **P1 — (a),(b),(d) No zoom control on a phone in either the planner or the ride, though the ride's own contract says a gloved rider needs one.** `phone-plan.css:16` hides `.og-map__zoom`; the ride rail's own doc comment claims "a two-halves zoom pill (pinch is unreliable in a glove)" (`src/ui/ride/RideFocus.tsx:33-35`) but the rail ships only compass / re-center / overview / mute (`RideFocus.tsx:1084-1150`). *Fix: ship the 56 px zoom halves on the ride rail and a 48 px zoom pair on the planner's phone cluster (the host calls and the `map-zoom-in`/`map-zoom-out` controls already exist in `src/ui/map/MapControls.tsx`).*

3. **P1 — (a),(b),(c),(d) On a phone the planner never shows a word about what planning is doing.** `src/ui/planner/phone-plan.css:54` (and `src/app/theme-glass.css:386-393` for the idle sheet) make `.og-planner__status` screen-reader-only, and the glance strip that also states progress is hidden on phones (`phone-plan.css:19`), so "Finding your ride…", "Ride ready." and "Planning failed — your previous ride is still shown." (`src/application/planner/planner-view-model.ts:907-932`) never reach the rider; the only cue is a dimmed map. *Fix: keep one visible line of that status in the phone sheet head.*

4. **P1 — (a) The place card's `Share` shares a Google Maps link from a rider app.** `src/ui/place/usePlaceFlow.tsx:180` builds `https://www.google.com/maps/search/?api=1&query=…`; the clipboard path toasts, the native-share path says nothing at all. *Fix: share a plain "Name — 40.123, -75.456" (or an OpenGravel link) and confirm with a toast either way.*

5. **P1 — (b) Two of the seven search chips do not search.** `src/ui/place/TopSearch.tsx:14-15` defines "Twisty roads" and "Gravel"; `usePlaceFlow.tsx:117-120` turns those two into a map-layer toggle with a 4-second toast ("Twisty roads layer on. Zoom in to see roads.") while the other five run a geocode query — so a rider who taps "Twisty roads" looking for a twisty *ride* gets a layer. *Fix: make those two chips start a ride intent (loop with Curvy / Gravel), or label them as layers.*

6. **P1 — (b) A 2-hour twisty loop costs 5 taps, against the contract's ≤ 4.** Loop chip (`src/ui/planner/IntentComposer.tsx:468-476`) → the 2 h chip (`src/ui/planner/RideStyleControls.tsx:260-305`) → the "Ride style" disclosure (`RideStyleControls.tsx:384`) → "Curvy" (`RideStyleControls.tsx:80`) → "Make my loop" (`src/application/planner/planner-view-model.ts:507`). *Fix: one "Twisty loop" quick action that lands the loop at 2 h with `curvy` already chosen.*

7. **P1 — (c) "Plan this ride" on an Explore route does not ride it: it makes a copy called "<name> copy" and drops the rider on the planner to plan again.** `src/ui/explore/RouteDetail.tsx:470`, `src/app/ExploreClient.tsx:194-204`, `src/application/explore/catalog.ts:757`; the copy carries points but no committed route, so a replan must finish before `Start ride` can be pressed. *Fix: open the planner with the route already selected and `Start ride` as the visible action, and stop writing "copy" into the title.*

8. **P1 — (d) The ride sheet closes itself 8 s after the last touch, including while the rider is reading the gas list.** `src/ui/ride/RideFocus.tsx:225` (`SHEET_AUTO_CLOSE_MS`) and `RideFocus.tsx:464-470`; only pointer/key input resets the clock (`RideFocus.tsx:459-462`), so a static read of `RideDetour`'s station list (`src/ui/ride/RideDetour.tsx:196-215`) removes the list mid-decision. *Fix: hold the sheet open while a result list, the stop confirm, or a picker is showing.*

9. **P1 — (d) During a ride the only stoppable places are "Gas" and "Food" within 120 mi ahead of the rider.** `RideDetour.tsx:42` (`LOOK_AHEAD_METERS = 120 mi`), `RideDetour.tsx:45-50` (`StopKind = "fuel" | "food"`), `RideDetour.tsx:96-110`. There is no "somewhere else" stop, and a place the rider can see on the map cannot be added from the sheet. *Fix: one row that opens the same place search the planner has, seeded with "along this ride".*

10. **P1 — (b) The idle phone first screen has no way out except picking a place or Loop.** At `data-idle="true"` the sheet handle is hidden (`src/app/theme-glass.css:382-384`) and every composer child except the two rows and the Loop pill is hidden (`theme-glass.css:413-417`), so ride style, saved places and Refine are unreachable until a destination or a loop exists; `theme-glass.css:434-442` also shrinks the only start control to a 28 px "From …" row. *Fix: keep the handle (or add one "More" row) so the first screen can still be expanded.*

### P2

11. **P2 — (d) Ending a ride uses five different words for one flow.** "End ride" (`RideFocus.tsx:1324`), "Finish this ride?" (`:1237`), "Save ride" (`:1259`), "Discard ride" (`:1271`), "Keep riding" (`:1279`), "Finish without saving" (`:1288`). *Fix: End ride → Save / Discard / Keep riding, and use "End" or "Finish" — never both.*

12. **P2 — (d) Roadside copy is product jargon: "Cancel route", "Keep riding as Free Ride", "Road suggestions".** `RideFocus.tsx:1334-1335` and `RideFocus.tsx:1431`. *Fix: "Stop following this route", "Keep recording", "Suggest roads nearby".*

13. **P2 — (a),(b) The same idea has two names on adjacent screens: the chip says "Twisty roads", the ride style says "Curvy".** `TopSearch.tsx:14` vs `RideStyleControls.tsx:80`. *Fix: choose one word for the rider and use it everywhere.*

14. **P2 — (a) The place card is crowded and unfinished, and it renames its own start action.** `src/ui/place/PlaceSheet.tsx:49-55` renders Directions + Add stop + start + Save + Share; `usePlaceFlow.tsx:178` calls the same command "Start here" for a dropped pin and "Use as start" for a searched place; `PlaceSheet.tsx:48` prints "Distance needs your location · Drive time after Directions". *Fix: Directions as the only primary, the rest under one "More" row, one name for the start action, and nothing said about a number that is still being fetched.*

15. **P2 — (a) "No places found here. Try moving the map." is untrue.** The chip search runs once against a bias snapshot (`usePlaceFlow.tsx:115-140`); panning afterwards does not re-run it, because the request is only fired by the chip's press. *Fix: offer "Search this area" after a pan, or say "Tap Gas again to search where you moved the map."*

16. **P2 — (b) A loop's two most important decisions hide behind a disclosure whose value is "Balanced · Mixed".** `RideStyleControls.tsx:138-140` builds that string and `RideStyleControls.tsx:373-390` keeps road character and surface inside it; "Balanced" never says it means *road type*. *Fix: spell the summary in the rider's words ("Twisty roads · Paved") or show the road-character chips inline for a loop.*

17. **P2 — (b) Both loop entry points take decisions the rider did not make.** The "Loop" quick chip silently sets the start to the rider's location and can raise a location prompt (`IntentComposer.tsx:316-329`), and a held map press can only make a one-hour loop, with the length baked into the label (`src/ui/map/PlannerMap.tsx:911`, `Loop from here (1 h)`). *Fix: label them ("Loop from my location") and let the length be chosen after the loop exists.*

18. **P2 — (a),(b),(d),(e) Glove-sized targets fall below 48 px on the surfaces the rider touches most.** Idle quick pills 44 px (`theme-glass.css:484-495`), idle start row 28 px (`theme-glass.css:434-442`), idle pin chip 46 px (`theme-glass.css:465-471`), My rides filter chips 36 px (`theme-glass.css:1706-1708`). *Fix: 48 px minimum everywhere the design system says 48.*

19. **P2 — (b),(a) The tools panel is named in internal vocabulary.** "Refine route · Stops, avoid areas, roads, draw" (`src/ui/planner/RefineSection.tsx:37-38`), "Shaping points" (`src/ui/planner/StopsPanel.tsx:361-362`), "road rule" (`RefineSection.tsx:64`), "Arrival intent" (`StopsPanel.tsx:419`). *Fix: "Change this ride", with rows a rider would say out loud — or keep the panel off the phone entirely.*

20. **P2 — (a),(b) A phone shows two destination boxes at once.** The floating "Search here" bar (`src/ui/place/search-home.css:19-23`, `TopSearch.tsx:31`) stays mounted while the composer's own "Where to?" row appears as soon as a ride exists (`src/ui/planner/PlaceSearchField.tsx:93`, `:305`); both write the destination slot. *Fix: one destination field per screen.*

21. **P2 — (a),(b),(c) A slow gloved tap lands in a dead band, and a slightly slower one opens a modal.** `src/application/map/interaction.ts:64-65` sets `TAP_MAX_MS = 350` and `LONG_PRESS_MS = 450`; `interaction.ts:268` discards any release older than 350 ms without movement, and `interaction.ts:301-315` turns 450 ms into `map-long-press`, which opens the "Plan here" dialog (`PlannerMap.tsx:781-790`). The only confirmation that a hold registered is `navigator.vibrate` (`src/infrastructure/map/maplibre/host.ts:1723-1727`), which iOS Safari does not provide. *Fix: treat any press without movement up to ~600 ms as a tap, and show the pin before the dialog where there is no haptics.*

22. **P2 — (c) Explore's road detail sheet exposes internal taxonomy, including a raw identifier.** "Class", "First seen", "Last seen", "Lineage history", `from <parentId>` and an evidence table: `src/ui/explore/RouteDetail.tsx:140-200` (lineage heading `:160`, `from ${entry.parentId}` `:168`), repeated for road discovery in `src/ui/explore/ExplorePanel.tsx:222-262`. *Fix: keep the rider facts (name, surface, length) and put lineage behind "Where this came from".*

23. **P2 — (c) Explore states absence twice and then ends a dead end in a policy sentence.** `ExplorePanel.tsx:133-134` prints "Curvature unknown" and "Surface unknown" on every card, and `ExplorePanel.tsx:747` says "No roads match these filters. Unknown geometry is not treated as nearby." *Fix: say unknown once for the list, and end the dead end with "No roads match. Clear filters."*

24. **P2 — (c) Explore asks for twelve filter decisions in two filter sections, some of them duplicates.** Source / Distance / Surface / Sort / Region / "PA riding area" / "Curvy routes only" / ride-time lens / "Near me" (`ExplorePanel.tsx:563-660`), then a second section with "Surface band", "Near me (within 30 mi)" and "Use my location for road distance" (`ExplorePanel.tsx:716-742`), while three distance chips sit above both (`ExplorePanel.tsx:309`, `:537`). *Fix: search + three chips + one Filters sheet.*

25. **P2 — (e) In My rides the title is a live text input inside a row of five or six controls, and a separate "Rename" button does the same job.** `src/ui/rides/RidesLibrary.tsx:606-616` (input; Enter renames) with `:736-747` (Rename button) and `:672-748` (Open / group share / Export / View details / Delete / Rename); a gloved tap or a scroll that starts on the name focuses a text field and opens the keyboard. *Fix: static title plus one row menu (Open / Rename / Export / Delete).*

### P3

26. **P3 — (e) "Export" offers five GPX variants and a paragraph about track-versus-route.** `src/ui/rides/ExportMenu.tsx:83-95` ("GPX track", "GPX route", "Source track GPX", "Original file", "Recorded ride GPX") and `ExportMenu.tsx:196-201` (the explainer). *Fix: one "Download GPX" action with the variants behind an "Options" disclosure.*

27. **P3 — (e) My rides' type filters are named in internal vocabulary.** `RidesLibrary.tsx:43-44`: "Catalog derivative" and "Shared derivative". *Fix: "From Explore" and "Shared with me".*

28. **P3 — (e) The same provenance reads two ways.** `src/ui/planner/PlannerWorkspaceFrame.tsx:61` says "Opened from My rides" for `derived`; `RidesLibrary.tsx:121` says "Copied from another ride". *Fix: one string, one meaning.*

29. **P3 — (e) The finish card offers no export, and its My rides link exists only when a recording landed.** `RideFocus.tsx:1210-1220` (`ride-summary-rides` is conditional on `navigation.recordingId` / `savedSummaryRideId`). *Fix: always offer "My rides", and put "Download GPX" on the finish card.*

30. **P3 — (d) The ride map's default places overlay is happy-hour venues.** `src/ui/places/RidePlacesMap.tsx:18` (`kinds: ["happy_hour"]`) and `:63` (`enabledByDefault: true`). *Fix: default the overlay off, or to fuel.*

## Also noted (below the top 30)

- Timestamps carry seconds and an "Updated" label: "Today, 10:15:32 AM" (`RidesLibrary.tsx:80-88`, `:652`).
- "Offline pack: not saved / unknown" in ride details (`RidesLibrary.tsx:659`).
- Saving a ride requires inventing a name first: "Name this ride to save it", Save disabled until then (`src/ui/planner/RideActions.tsx:288`).
- A failed first "Directions" still toasts "Directions set" with a 4 s undo, even though no route exists (`usePlaceFlow.tsx:94-105`, `src/ui/place/RiderToast.tsx:9`).
- The unsaved-draft confirmation talks about internals: "Your unsaved draft will remain separate." (`RidesLibrary.tsx:675`).
- The Explore route page's "Elevation" section is a count, not a profile: "N measured points" (`src/ui/explore/RouteDetail.tsx:498-501`).
- An iOS "Add to Home Screen" aside covers the map for the first 10 s of a ride (`src/app/RideClient.tsx` rendering `RideInstallHint`; window in `src/ui/ride/install-hint.ts`).
- The readout picker offers "Lean β" and an "Off-road" preset (`src/application/ride-metrics/registry.ts:936`, `:1020`).

## What already works (do not regress)

- The ride surface's maneuver card, finish summary and 56 px rail are the best-built part
  of the app (`RideFocus.tsx:1084-1150`, `src/app/globals.css:11755`).
- The no-session path is honest: `/ride` with no ride says "No ride in progress" and offers
  exactly one action (`RideFocus.tsx:615-647`).
- Unknown stays unknown in the route card's surface badge and the glance strip
  (`planner-view-model.ts:119-146`, `src/ui/planner/MapRideGlance.tsx:81-94`); nothing in
  this audit asks for that to be loosened.
- The planner's failure copy is already plain: "No legal route to this destination — try
  another point." (`planner-view-model.ts:496`).

## Unverified

- Whether the 28 px / 36 px / 44 px targets are actually reached at 320/375/390 px —
  derived from media queries, not measured in a browser.
- Whether the idle first screen really hides the sheet handle in every phone browser
  (several rules depend on `:has()` support).
- Whether the Explore → planner replan reads as a wait (no timing measured).
- The music row, live location sharing and the safety panels were read but not audited.
