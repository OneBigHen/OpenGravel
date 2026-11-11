# OpenGravel round 3: "The ride you saved is the ride you get" (2026-11-11)

Audit of production (40115cb6) in a headless browser, phone 440x956 and desktop 1440x900, light
and dark, rider parked at Rothrock (40.72, -77.89). Code read on `round/next` (d6f4b5a9). No
source file was touched, nothing was built, the scorecard was not run. Sizes are estimates.
Screenshots: `.fable/shots/audit/` (about 150 files, named `<device>-<theme>-<step>.png`).
Not covered: the iPhone shell, real GPS, real sunlight, voice. The N2 handlebar screen on the
branch was not reviewed in depth; its production "before" is what the audit saw.

## 1. Verdict

The front half of the trip (open, search, Loop, read the route) works and the last round fixes
its worst flaws. **The back half breaks trust: what a rider saves, imports or rides does not come
back.** That is the round. Fix those three first, then make the app one instrument (one route
summary, one Save, one theme rule), then add four features that all serve "trust it".

## 2. Audit, ranked by how much it hurts a rider

"Branch" means already fixed on `round/next` and not yet on production: verify after the deploy.

| # | What I saw | Shot | File to fix |
|---|---|---|---|
| 1 | **A saved ride reopens as a different ride.** Saved "53 mi, 2 h 12, 44% gravel"; reopened as "55 mi, 1 h 55, 16% gravel". Seen 3 times of 3 (also 49 mi to 53 mi, and 55 mi to 56 mi with 2% dirt). Opening replans from the request instead of showing the stored line | `phone-light-22e-reopened-saved-31s`, `phone-light-16b-myrides` vs `phone-light-22b-opened-saved-ride`, `phone-dark-22b-opened-saved-ride` | `src/application/library/library-service.ts:621` (`openRide`), planner restore path |
| 2 | **A ride I just finished is nowhere.** Guided ride, End ride, "Ride finished", tap My rides: "No saved rides yet" (or "No recorded rides yet"). The finish card has a faint grey squiggle and no numbers, and "Ride finished" is printed twice | `phone-dark-26b-after-ride`, `phone-dark-26c-myrides-after-ride`, `phone-dark-18-recorded` | `src/ui/ride/RideFocus.tsx:1454`, `src/ui/stores/ride-focus-store.ts` (recording is opt-in at 1954) |
| 3 | **An imported GPX loop cannot be opened.** Import my own exported loop, "Open in planner": "Planning failed. The routing service is unavailable right now", start and destination both "South Water Street". Seen 2 of 2 | `phone-light-22c-import-open-in-planner`, `phone-light-22d-import-open-27s` | `src/ui/rides/RidesLibrary.tsx:767`, `src/application/import/import-service.ts:576` |
| 4 | **Offline is promised in three places and exists in none.** "Save this area for offline" (planner), "Offline maps" (curated ride), Settings: "There are no areas to download right now" | `phone-light-10-share` (row at the bottom), `phone-light-41-ride-page`, `phone-light-50b-settings-full` | `PlannerPreparation.tsx:560`, `RouteDetail.tsx:571`, `RouteOptions.tsx:40`, `OfflineMapsSection.tsx:430` |
| 5 | **The first loop swaps for another.** 54 mi at 6 s, 49 mi later; a third set of numbers after Compare | `phone-light-03-loop-6s`, `phone-light-04b-loop-result`, `phone-light-07-compare` | Branch (N1) |
| 6 | **Share is a privacy form with a red error before I typed.** "Trim from both ends (meters)", unstyled boxes, "A share needs a title to publish", then a raw JSON dump. The shared page said 62.5 mi for a 56 mi ride | `phone-light-10-share`, `phone-dark-10-share`, `desktop-light-10b-share-created`, `desktop-light-10c-share-page` | `src/ui/sharing/ShareSheet.tsx:259,325`; the page itself is Branch (N5): recheck the miles there |
| 7 | **GPX import reads like a specification.** "Source segments and gaps stay separate", "Or open points as a breadcrumb", "Import meaning", "Preserved 1 GPX waypoint as metadata" | `phone-light-19c-import-buttons`, `phone-light-19d-import-meaning`, `phone-light-19e-imported` | `src/ui/import/ImportPanel.tsx` |
| 8 | **Start ride shows a page called "Ride Focus", then a blank map.** "Opening your ride…", then "Loading map…" under "Waiting for a GPS fix…" (4 s on the phone, still blank at 7 s on desktop; headless, so real phones will be quicker) | `phone-light-23e-start-1s`, `phone-light-23f-start-4s`, `desktop-light-23-ride-screen` | `src/ui/ride/RideFocus.tsx:173,788`, `src/app/RideClient.tsx` |
| 9 | **Night planner, day ride.** Phone set dark, Auto: planner is dark, tap Start, the ride screen is bright white at 1:39 PM. Auto means "system" in the app and "sun" on the ride | `phone-dark-22b-opened-saved-ride` then `phone-dark-23g-ride-50mph` | `src/ui/ride/RideFocus.tsx:463`, `src/ui/appearance/appearance.ts:59` |
| 10 | **Saving is two controls and a riddle.** A Save button by Start, and far below a "Name this ride to save it" box; after saving: "Named ride saved. Your active draft remains available." | `phone-light-12b-saved`, `phone-light-14-other-formats`, `desktop-light-12-saved` | `src/ui/planner/RideActions.tsx:296,356` |
| 11 | **Three different route summaries.** Loop (title, big time, Start/Add stops/Save), destination ("BEST RIDE" eyebrow, Options row, wide Start ride), curated "Ride this" (a loop titled "To Sand Mountain Trailhead", no surface line) | `phone-light-04b-loop-result`, `phone-light-37a-destination-first`, `phone-dark-42-ride-this` | `PhoneRideSummary.tsx`, `TripCard.tsx`, `RouteDecisionCard.tsx`, `hooks/useOpenCuratedRide.ts` |
| 12 | **"Weather along the route is unavailable" on long loops.** `/api/weather/route` answers 400; the server caps the line at 2,048 points and the client sends every point (seen in page text and the network log on 60 mi loops, no clean shot) | log only | `src/ui/weather/useRouteWeather.ts`, `src/server/weather/route-weather.ts:51` |
| 13 | **Layers leads with Hiking** (frozen) and lists trails, trailheads, water, shelters, summits and Wind for a motorcycle rider | `phone-light-31-legend`, `phone-dark-30b-layers-scrolled`, `desktop-light-30-layers` | `src/application/map-layers/catalog.ts:365`, `src/ui/layers/MapLayersPanel.tsx` |
| 14 | **Settings is in the wrong order.** Ride/Hike, Ask, cameras and Spotify sit above "My bike"; "I understand and acknowledge this collection" | `phone-light-50b-settings-full`, `desktop-light-50-settings` | `src/app/SettingsClient.tsx`, `src/ui/settings/` |
| 15 | **After Record: "Saved 642 m to My rides"** in a miles app, and "Recorded ride saved" twice | `phone-light-68-record-after` | `ride-focus-store.ts:2681` |
| 16 | **Explore small things.** "105 mapped" beside a 112-ride list; the map credit box hangs open mid-map; thumbnails stay light in dark; the curated page says "Long-trip considerations" (frozen) and its action bar covers the text | `phone-light-40-explore`, `phone-dark-40-explore`, `phone-light-41b-ride-page-full` | `ExploreMap.tsx:119`, `RouteDetail.tsx`, `route-detail.css` |
| 17 | **Compare:** two cards both named "Alternative"; "Back to ride" is cut off by the Roads row | `phone-light-07-compare`, `phone-light-08-after-compare-esc` | `RouteDecisionCard.tsx`, `plan-sheet.css` |
| 18 | **My rides:** the line on the card is red, plum everywhere else; "Import from an older version" on every visit; the empty card sits at the bottom on first load | `phone-light-16b-myrides`, `phone-light-17-myrides-empty` | `RidesLibrary.tsx`, `rides.css` |
| 19 | Desktop loop panel: staircase of time chips, grey "Make my loop" after planning | `desktop-light-04-loop-result` | Branch (N4) |
| 20 | Ride Menu opens on "Share live location"; six round buttons | `phone-light-24c-ride-stops` | Branch (N2) |

To verify, not proven: riding the line at 47 mph for 28 s the card stayed on "Finding you on the
route…" (`phone-dark-23g-ride-50mph`). My position feed is crude; check with `npm run ride-sim`.

**Works well as seen:** place search and the place card, Gas/Food chips with a distance list, the
conditions popover, destination planning (route in 6 to 16 s), Compare, elevation with the surface
bar, weather strip, GPX download, rename, free Record, Explore list and curated pages on desktop.

## 3. Restructure calls (decided; log each in `DESIGN.md` with its PR)

1. **Saved means exact.** Opening a saved, imported or curated ride shows its stored line and does
   not call the router. "Plan it again" is a separate button. (R3-1)
2. **Every ride is recorded.** Guided and free. Ending a ride saves it and shows one ride card.
   My rides tabs become **Saved** and **Ridden**; arriving from a finished ride opens Ridden. (R3-2)
3. **One route summary everywhere:** title, time and miles, the three truth lines, Start, Save,
   Share. Used for loop, destination, curated, saved and imported rides. (R3-4)
4. **Save is one tap.** It saves under an automatic name ("Rothrock loop, 53 mi") and the name is
   editable in place. The name box, "draft" wording and the second Save go. GPX and link live
   behind the one Share button. (R3-4)
5. **Share is one tap too.** Title filled in from the ride, start and finish hidden by default,
   the rest under a closed "Privacy" line. No JSON, no metres, no error before input. (R3-3)
6. **Import is: pick a file, it is in My rides, following its line.** Splitting tracks and
   breadcrumbs appear only when the file has more than one track. (R3-3)
7. **Auto theme follows the sun at the rider's place, in the whole app.** One rule. (R3-4)
8. **Start never shows a title page.** No "Ride Focus" text anywhere a rider can see; the ride
   chrome and the route outline paint at once, the map fills in behind. (R3-4)
9. **Desktop opens on Loop** with the green button live, the same journey as the phone. (R3-4)
10. **Layers show riding things.** Quick sets: Fun roads, Weather, Gas and food, Traffic. Hiking
    set, trail stops and Wind appear only when Planning activity is Hike. (R3-5)
11. **Settings order:** Your bikes, Home, Day/Night, Units and data, Feedback, then one closed
    "More" holding Hike, Ask, cameras, Spotify and usage data. (R3-5)
12. **Remove the three offline dead ends now;** R3-7 brings back one honest control. (R3-5)
13. **Explore opens on "Near you this weekend"** above the list; the curated page drops
    "Long-trip considerations" for a fuel line and keeps two buttons, Ride this and Save. (R3-8)

## 4. New features (four, plus one small line)

| Feature | Why a rider loves it | Package |
|---|---|---|
| **Ride card** after every ride: the line on the map, miles, moving time, dirt miles, climb; saved to Ridden; "Save picture" and Share | Proof of the ride, and it fixes audit #2 | R3-2 |
| **Gate closed / road bad**, one big button while riding. It marks the spot, and your next plans avoid it for 30 days. Private to this device, listed and removable | The app learns your roads; uses the no-go areas that already route | R3-6 |
| **Near you this weekend:** three rider-picked rides within 60 mi, each with Saturday's and Sunday's weather at its start | Answers "where should I ride Saturday" in zero taps | R3-8 |
| **Keep for no signal:** one switch on a saved ride. Map, line, turn prompts and surface work in airplane mode. No offline rerouting: off route it shows the way back to the line | Gravel is where the signal is not (PLAN milestone 8) | R3-7 |
| Fuel line (small): a fourth truth line only when the ride is longer than the bike's usable range: "Fuel: 104 mi ride, 120 mi range. Gas at mile 61" | The data already exists in three places | R3-8 |

Weighed and left out: ride replay animation (the card gives most of the joy for a fifth of the
work), a separate fuel-range screen (the line is enough).

## 5. Packages

| # | Rider sentence | Worker, size | Brief |
|---|---|---|---|
| R3-1 | "The ride I saved, imported or picked opens as exactly that line." | Opus, M | `briefs/r3-1-saved-is-exact.md` |
| R3-2 | "Every ride I take is kept, and ends with a card I want to show someone." | Sonnet screen, DeepSeek module (MacBook), M | `briefs/r3-2-ride-card.md` |
| R3-3 | "Sharing is one tap. Importing a GPX is one tap." | Sonnet, M | `briefs/r3-3-share-import.md` |
| R3-4 | "Every route looks the same, saves with one tap, and Start goes straight to the ride." | Opus, M to L | `briefs/r3-4-one-instrument.md` |
| R3-5 | "Layers and Settings show riding things first, and nothing promises what is not there." | DeepSeek (overflow), S | `briefs/r3-5-tidy.md` |
| R3-6 | "Gate closed: one tap, and I am not sent there again." | Sonnet screen, DeepSeek module, M | `briefs/r3-6-gate-report.md` |
| R3-7 | "This ride works in airplane mode." | Opus leads, DeepSeek tests, L | `briefs/r3-7-no-signal.md` |
| R3-8 | "Explore tells me where to ride this weekend, and each ride page tells me the truth about it." | Sonnet screen, DeepSeek module (overflow), M | `briefs/r3-8-weekend.md` |

Every brief has files and executable pass/fail checks. Every screen PR attaches before/after
`npm run shots`; `npm run css:budget` must not rise; on docker-dev run only typecheck, lint and
the touched unit tests, one heavy job at a time.

## 6. Order and what runs side by side

Lanes (a lane is serial; lanes run in parallel):

- **Planner lane (Opus):** R3-1, then R3-4. Shares `planner-view-model.ts`, `PhoneRideSummary.tsx`,
  `RideActions.tsx`, `auto-plan.ts`.
- **Ride lane:** R3-2, then R3-6, then the ride-screen part of R3-7. All touch `RideFocus.tsx` and
  `ride-focus-store.ts`.
- **Library lane (Sonnet):** R3-3 owns `ShareSheet.tsx` and `ImportPanel.tsx`. Starts after R3-1
  merges, because both change what "Open" does after an import.
- **Tidy lane (DeepSeek, overflow):** R3-5, any time.
- **Explore lane:** R3-8, any time. It owns `RouteDetail.tsx`; R3-5 only deletes one link there,
  so R3-5 lands first.
- **Offline lane (Opus):** R3-7 starts with a one-day spike once R3-1 is in (it needs "saved means
  exact"); its ride-screen part waits for R3-6.

Day one: R3-1 (Opus), R3-2 module (DeepSeek, MacBook), R3-5 (DeepSeek, overflow), R3-8 module
(DeepSeek, overflow, after R3-5). Day two: R3-2 screen, R3-3, R3-4. Then R3-6, R3-8 screen, R3-7.

**If time runs short:** R3-1, R3-2, R3-5 are the round (three trust bugs and the dead ends).
R3-4 and R3-3 are what the owner will notice most. R3-6 and R3-8 are the best new joy per hour.
R3-7 is the largest and may spill into the next round without harm, as long as R3-5 has removed
the false offline promises.

## 7. Risks

- **R3-1 changes what "open" means.** A saved ride stored before this round may hold no line
  (`plannedRoute` is optional). Then it replans once and says so: "Planned again: the saved line
  was not stored."
- **Recording every ride uses storage and battery.** Cap a trace at one point per second; keep the
  existing Discard button.
- **R3-7 is the only package with real unknowns:** which tile sources the service worker may
  cache (Mapbox terms forbid bulk caching; use the Protomaps basemap for kept rides), and iOS
  storage limits. The spike answers both before any screen work.
- **Weekend weather is a forecast.** Show the hour it was read, and "Forecast not available" when
  the Weather Service does not answer, never "dry".
- **Personal reports are not facts.** A report never marks a road closed for anyone else and
  never overrides an official closure; the truth line counts it separately ("1 spot you reported").
