# OpenGravel next round: "First tap to the bars" (2026-11-11)

Read from code on `round/next` (40115cb6 = production). I also drove production in a headless
phone and desktop browser parked at Rothrock (40.7200, -77.8900) and looked at the pictures.
Nothing was built, no source file was touched, the scorecard was not run. "Estimate" means not
measured. Before pictures from that run sit in
`/tmp/claude-0/-root/cdf5a3f3-8b5a-4fb0-9f4d-6a1b338e3cfb/scratchpad/shots/` (temporary: copy them
into `.fable/shots/next-before/` before the session ends, or re-shoot with section 3's recipe).

## 1. Verdict

**Stop widening. Make the one trip the owner will actually take (open, Loop, read the route, send
it to the phone, ride) look and behave like a finished instrument.** The last round made the map
beautiful. This round makes the *journey* impressive, because today each step of it has one thing
that breaks the spell, and all of them show on the live site:

1. **The first loop is the wrong loop.** At Rothrock, 6 s after "Make my loop" the phone shows a
   66 mile "Best Ride" that is 1% gravel and runs up I-99. About 20 s later it is swapped for a
   61 mile loop that is 21% dirt. The desktop does the same and the Best Ride card jumps to third
   place. Cause: the first answer is always the fastest profile, whatever was asked
   (`src/application/planner/candidate-lanes.ts:180-183`, `plan-service.ts:816`).
2. **The handlebar screen is not one glance.** Seven buttons on the right edge, one of them the
   frozen Emergency button (`src/ui/ride/RideFocus.tsx:1258-1372`). Menu opens on a "Share live
   location" form (a frozen feature) and GPS diagnostics. The ride knows nothing about the surface
   ahead: the ride session never receives the surface runs the planner holds.
3. **The truth is there but whispered.** The surface band on the route is a 3 px stripe that only
   starts at zoom 12 (`src/infrastructure/map/maplibre/style.ts:512`), so at loop zoom the line is
   plain plum. The phone surface bar renders about 160 px wide, not full width. The bike check and
   the closure check run on every plan (`rider-road-eligibility.ts`, `plan-service.ts:945`) and
   the rider is never told.
4. **The laptop loop panel is broken.** Ride-time chips stack as a staircase beside their label,
   and "Make my loop" turns into a grey slab after planning, which `DESIGN.md` §2 forbids
   (`src/ui/planner/ride-style.css:152-172`, `IntentComposer.tsx:148`).
5. **Laptop to phone does not exist.** The share page is an unstyled outline with a raw JSON dump
   and no way to ride the route (`src/app/share/[token]/page.tsx`).

The biggest single "wow" inside one round: **one tap on Loop, and within about 6 seconds a real
gravel or twisty loop is on the map, with three honest lines under it, and the same route on the
bars showing "Gravel in 0.4 mi".** That serves three PLAN bars at once: Free and fast (first route
in 5 s, honestly this time), Ride screen, and the "trust it" half of Routes. Milestones touched:
5, 9, 11, part of 12, and W2/W4 from the last list.

## 2. The round: six work packages, ranked by what the owner will notice

Sizes and day counts are estimates. Every screen PR attaches a before/after `npm run shots`
gallery and updates the CI baselines with a `DESIGN.md` log line; every routing PR attaches
`npm run scorecard -- --set tuning` (wins not lower than 6, trust failures 0).

| # | Rider sentence | Files | Pass/fail | Worker, machine, size |
|---|---|---|---|---|
| N1 | "One tap on Loop and the first loop I see is already the gravel or twisty loop I asked for. It does not swap for a different ride while I am looking." | Server: `src/application/planner/candidate-lanes.ts` (`resolveLanes`, the `!includeAlternatives` branch), `src/server/planning/plan-service.ts:660-700,816`. Client: `src/application/planner/auto-plan.ts`, `src/ui/planner/hooks/usePlannerAutoPlan.ts`, `IntentComposer.tsx:621` (the Loop pill), `planner-view-model.ts` (`statusFor`, role label while `primary-ready` / `alternatives-loading`), `usePlannerAnswerLifecycle.ts` | `npx vitest run tests/unit/planner/candidate-lanes.test.ts tests/unit/planner/auto-plan.test.ts tests/unit/planner/planner-view-model.test.ts`; new live case in `tests/real-router/` (Rothrock, 2 h, Mixed loop: first answer is at least 10% unpaved and back in 8 s; Curvy from Waterville: first answer is on `motorcycle_twisty`); critical browser test: cold load to a drawn loop in **1 tap**; scorecard: wins not lower, trust 0, first-route seconds 75th percentile not above 6.5 | Sol for the server half (Sonnet if quota is out), Opus for the client half. docker-dev. M |
| N2 | "On the bars I see the next turn, the surface coming up, three numbers and three big buttons. Nothing else." | `src/ui/ride/RideFocus.tsx`, `src/ui/ride/ride.css`, `RideMetricStrip.tsx`; new `src/application/ride-session/surface-ahead.ts`; `ride-focus-handoff.ts` and `src/application/persistence/ride-focus-pointer.ts` (carry surface runs the way `SpeedLimitSpan` is carried), `ride-focus-view-model.ts`, `src/application/map/build-ride-scene.ts` | `npm run ride-sim`; `npx vitest run tests/unit/ride-session`; new `tests/e2e/critical/ride-handlebar.spec.ts` at 440 x 956: at most 3 buttons in the right rail, every ride control at least 56 px, opaque chrome covers at most 20% of the screen, Menu opens with no form field visible; shots `active-ride` phone and desktop, both themes | Sonnet for the screen, DeepSeek for `surface-ahead.ts`, the handoff and tests; Opus reviews. docker-dev. L |
| N3 | "Under every route, three honest lines: how much is dirt, whether my bike can do it, and what was checked today. And I can see the gravel on the line itself." | New `src/application/planner/ride-truth.ts`; `planner-view-model.ts` (`routeCards`), `PhoneRideSummary.tsx`, `RouteDecisionCard.tsx`, `plan-sheet.css:193-195`, `route-results.css`; server `plan-service.ts:~945` and `src/application/roads/engine-road-evidence.ts` (a compact bike-fit fact from `roadRuns`); map `style.ts:495-515` | `npx vitest run tests/unit/planner/ride-truth.test.ts` (6 routes x 3 bikes; unknown or unavailable never reads open, clear or fine); shots `route-choices` and `loop-planned` with a fixture that holds one closed and one unconfirmed road; browser check: surface bar width is the sheet width minus padding at 440 px; tapping it moves the map | DeepSeek for the pure module and tests, Opus for the screens. docker-dev. M |
| N4 | "On the laptop the loop panel is one tidy column and the button is always green and live." | `src/ui/planner/ride-style.css:152-172,272`, `composer.css`, `gmaps-layout.css`, `RideStyleControls.tsx:290-330`, `IntentComposer.tsx`, `PlannerResultPanel.tsx`, `src/ui/nav/AppBar.tsx:20` | `npx playwright test tests/e2e/critical/desktop-rail.spec.ts`; new assertions at 1440 x 900: loop-time chips sit on at most 2 rows and never beside a taller label, the plan button is never `disabled` with a grey fill, the Best Ride card is first, Start ride is fully inside the panel; desktop baselines `plan-idle`, `loop-planned`, `route-choices` | Opus. docker-dev. S to M |
| N5 | "Plan on the laptop, click Send to phone, scan, tap Start." | New `src/ui/sharing/SendToPhone.tsx`, new `src/application/sharing/qr.ts`; `src/ui/planner/RideActions.tsx`; `src/app/share/[token]/page.tsx` and `share.module.css` (a real page with "Ride this"); reuse the Explore "Ride this" path | New `tests/e2e/critical/send-to-phone.spec.ts`: desktop plan, open Send to phone, read the link, open it in a 440 px window, same distance, "Ride this" then Start enabled; `npx vitest run tests/unit/sharing`; browser test sees zero third-party requests for the QR | DeepSeek. docker-dev or `fleet run auto`. M |
| N6 (stretch) | "Ask for twisty, get twisty." | ROUTING-PLAN step 2 as written: `ride-formula-rules.ts`, `request-builder.ts:718`, `provider.ts:298`, `curvy-search.ts`, `scripts/scorecard/run.ts:117`; delete `OGV_RIDE_FORMULA` and the formula scorer | Scorecard: curvy wins up by 2 or more, total not lower, trust 0; `grep -rc OGV_RIDE_FORMULA src scripts .env.example` prints 0 | Sol only, after N1's server half. docker-dev. S |

**Who can run beside whom** (one heavy job on docker-dev; the scorecard and any `shots` build count as heavy):

- **Ride lane (N2)** touches only `src/ui/ride/`, `src/application/ride-session/`, `build-ride-scene.ts`. Runs beside everything.
- **Sharing lane (N5)** touches only sharing files and `RideActions.tsx`. Runs beside everything.
- **Planner screen lane, one after another, one owner (Opus): N4, then N3's screens, then N1's client half.** They share `planner-view-model.ts`, `PhoneRideSummary.tsx`, `PlannerResultPanel.tsx`, `IntentComposer.tsx`.
- **Routing lane, one after another: N1 server half, then N6.** Both touch the planner's request path. N1's server half and N3's pure module can start on day one beside N4.
- Suggested day one: N4 (Opus) + N1 server (Sol) + N2 `surface-ahead` (DeepSeek) + N5 (DeepSeek on the overflow machine). Day two: N3, N1 client, N2 screen, then N6 if quota allows.

**Order if time runs short:** N1, N2, N3 are the round. N4 is the cheapest visible fix and should
not be dropped. N5 is the best demo moment per hour. N6 moves to next round with no harm.

## 3. The headline demo

One page, six pairs. "Before" is production today. "After" is this branch run locally
(`npm run build`, `npm start` on a free port, router through
`ssh -N -L 8989:127.0.0.1:8989 docker-stable`, production's switches from `scripts/scorecard/run.ts:37`).
Use a Playwright script with fixed geolocation, 440 x 956 and 1440 x 900, like `.fable/shoot.mjs`.
Coordinates are approximate; snap them to the named place.

| # | Place and state | Before shows | After must show |
|---|---|---|---|
| 1 | **Rothrock**, phone, day. Rider at Pine Grove Mills (40.7200, -77.8900). Tap Loop. Three frames: 2 s, 6 s, 30 s | Two taps; at 6 s a 66 mi I-99 loop, 1% gravel; at 30 s a different ride | One tap; by 6 s a loop into the state forest with a two-digit dirt share; the 30 s frame is the same loop, eyebrow changed from "First look" to "Best ride" |
| 2 | **Rothrock**, phone, same loop, sheet at half | One short grey bar, one line | Three truth lines, full-width bar, tan gravel visible on the plum line at this zoom; second frame after tapping the bar: map on the longest gravel stretch (Bear Meadows / Laurel Run area, whatever the route really uses) |
| 3 | **Rothrock**, phone, **night**, riding, position fed 0.4 mi before the pavement ends | Plain plum line, six round buttons, "Continue" | Maneuver card with "Gravel in 0.4 mi", tan stretch ahead on the line, three buttons, ridges visible in Night terrain |
| 4 | Same ride, Menu open | A name field, a time field and "Share live location" | One grouped list: Pause, End ride, Stops and fuel, Sound, Screen, More |
| 5 | **Michaux**, desktop, day. Start Pine Grove Furnace State Park (about 40.032, -77.305), Loop, 2 h, Dirt OK | Staircase of time chips, grey "Make my loop", Best Ride third | One tidy rail, live green button, Best Ride first with the three truth lines |
| 6 | **Pine Creek**, desktop then phone. Waterville (about 41.311, -77.364) to Slate Run (about 41.473, -77.502), Curvy | Share dialog with a link; share page is an outline and JSON | "Send to phone" dialog with the QR; beside it the phone showing the same route with Start |

Under the pictures, one line of numbers and nothing else: scorecard wins and trust failures,
first-route seconds (75th percentile), and "taps to a loop: 2 → 1". If N6 lands, add its curvy
wins. If a number did not move, print it anyway.

Do not stage anything: if the after loop at Rothrock comes back with little dirt, show it and say so.

## 4. Kill list (not this round)

- **Dead-zone offline ride (milestone 8).** Large, needs the iPhone shell fixed, and a screenshot
  cannot show it. It is the right headline for the round after this one.
- **Graph rebuild with a curve value (routing step 4) and loop skeletons (step 5).** Both large;
  step 4 needs a production swap on a box with full swap and the owner's go. N1 gets most of the
  visible gain of "the first loop is right" without them. Do them next, in that order.
- **Routing step 3 (delete 6,000 lines).** Correct and invisible. It is the next plumbing PR once
  N1 and N6 are in, inside the 1-in-5 plumbing rule.
- **The one-tap "gate closed" report (milestone 12, second half).** Needs routing to honour
  reports. This round only shows what was already checked.
- **New layers (gates, fords, private roads, fuel from OSM).** The map already opens rich; more
  lines add clutter before the journey is clean.
- **Splitting `ride.css` to 900 lines, the 13,000-line CSS target.** N2 may shrink it as it goes;
  `css:budget` must not rise. No migration PRs.
- **TestFlight, Live Activity, CarPlay, anything needing the paid Apple account.**
- **Everything frozen:** hiking, Spotify, cameras, Ask/Jev, wind, sun, long trip, live follow.
  N2 *moves* the Emergency button and the live-share form down into Menu rows; it changes nothing
  inside them.
- **Voice for surface changes, per-bike tyre advice, weather on the ride card, more map styles,
  Explore work, coverage beyond PA and NJ.**

## 5. Taste calls, decided now (write each into the `DESIGN.md` decision log with its PR)

1. **Loop is one tap.** The Loop pill plans a loop straight away from where the rider is, using
   the last ride time they chose (2 h the first time) and direction Any. The time chips stay in
   the sheet, directly under the hero, and changing one replans. This replaces the rule in
   `auto-plan.ts` that a loop waits for "Make my loop". The desktop keeps its button, always live
   and green; after a loop exists it reads "Try another loop".
2. **The first answer is called "First look", in neutral ink, until the search settles.** Plum
   "Best ride" is only ever on the settled pick. If a better loop arrives, the swap happens once,
   with one line under the hero saying what improved ("Now 21% dirt, was 6%"). No swap after the
   rider has tapped a card, the map, Start or Save.
3. **Ride rail on a phone: three buttons, 56 px, in this order from the top: Recenter (tap again
   for the whole route), Stops, Mute.** Menu stays at the end of the bottom strip. No zoom
   buttons and no compass on a phone (pinch; north-up is a Menu row). Emergency becomes the first
   row of Menu in `--og-danger`. Desktop keeps zoom.
4. **Maneuver card: 96 px, distance 44 px Outfit, road name 20 px, and one second line for the
   surface ahead** with a small swatch in the same colours as the surface bar: "Gravel in 0.4 mi",
   "Pavement in 2.1 mi", "Surface not known for 1.3 mi". When the ride has no surface data (GPX,
   reroute not yet answered) the line is absent, never guessed. Not spoken this round.
5. **Exactly three truth lines, always in this order: surface, bike, checked.** Each starts with
   an 8 px dot: `--og-primary-text` only for known-good, `--og-warn` for not confirmed,
   `--og-danger` for over the limit or closed, `--og-ink-2` for unknown. Text is ink. Wording:
   "Fine for *Bike name*: 12 mi gravel, 0.8 mi rough track" / "Not checked for your bike: 2 mi
   unknown surface" / "Checked 9:14 AM: 4 sources, no closures on this route" / "Closure check
   did not answer". The bike line names the roughest stretch and a tap flies the map to it.
6. **The chosen route stays plum; the surface is an inner stripe**, about half the line's width,
   drawn from zoom 8 up (today 12). Unknown stretches keep plain plum, as now. Same three hues as
   the bar. The ride map uses the same stripe.
7. **Send to phone is a desktop-only secondary button beside Save.** It opens a solid dialog (no
   map behind it, so no glass): QR at 240 px on `--og-surface` with ink modules, the link as text
   under it, and "Remove link". No privacy-trim step, because it is the rider's own phone, but the
   link is revocable. The QR is drawn in the browser; no outside service.
8. **Desktop:** tagline in the top bar goes; Best Ride is always the first card; Road familiarity,
   Traffic, Avoid highways and Avoid tolls fold under one closed "More options" line that
   summarises them; Start ride sits in a fixed foot of the result panel.
9. **Words:** "First look", "Best ride", "Try another loop", "Send to phone", "Ride this". No
   exclamation marks, no "smart", no "AI".

## 6. Risks I see (honest list)

- **N1 may be slower.** A loop on the rider's own profile runs three seeds
  (`provider.ts:111-120`). If first-route seconds pass 6.5 at the 75th percentile, keep the
  profile change and drop the first answer to one seed; do not go back to the fastest profile.
- **N1 does not make loops better, it makes them honest sooner.** Loop quality is still the
  random-turning-point engine until routing step 5. Say so on the demo page.
- **N2 is in two very large files** (`RideFocus.tsx` 2,245 lines, `ride.css` 3,063). Sonnet, not
  DeepSeek, for the screen; the brief names line ranges.
- **N3's bike line depends on `roadRuns`**, which is dropped for pathological routes
  (`route-provider.ts:346-358`). Then the line must read "Not checked for your bike", never "Fine".
- **N5 is sized M, not S as PLAN says**, because the share page has to become a real page first.

## 7. Briefs

`.fable/briefs/next-1-first-loop.md`, `next-2-handlebar.md`, `next-3-ride-truth.md`,
`next-4-desktop-rail.md`, `next-5-send-to-phone.md`, `next-6-twisty.md`.
