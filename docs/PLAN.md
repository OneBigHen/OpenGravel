# OpenGravel master plan: 90 days, 2026-11-10 to 2027-02-08

Checked against `origin/main` at `536bee5` (#204, one newer than the brief's #203), the live site and the production box, on 2026-11-10. Winter is the off-season in Pennsylvania, so the target is simple: be ready for the first warm weekend of spring.

## 1. Verdict: keep the angle, sharpen it, and stop adding things

**Keep:** motorcycle gravel and back-road riders, free and open. **Sharpen to one sentence:** *the best way to find and ride a gravel or twisty loop in the Mid-Atlantic, and trust it.*

Three changes to the proposed angle:

1. **The real problem is breadth, not missing features.** The app already has more features than Calimoto. On 2026-10-28 alone 20+ PRs merged, and the product grew a whole hiking mode (27,594 trails, its own router) which is exactly the Gaia/AllTrails fight the angle says to avoid. Nothing in the core promise is proven yet. For 90 days: freeze everything outside the core loop and go deep.
2. **Offline is core, not nice-to-have, but only for the ride you are on.** Gravel is where the signal isn't. An app that goes blank in a state forest loses the rider's trust for good. Do not build region downloads or offline planning; build "this ride works in airplane mode".
3. **Rider reports come last and stay tiny.** Crowd reports need a crowd, and today there is roughly one rider. Official closures and seasonal gates are already built and switched on (Game Commission, DCNR, NJ wildlife areas, Forest Service, work zones). Prove those, then add a one-tap personal report that changes *your own* next route.

**"Excellent" means these five bars. All are measured by running something.**

| Bar | Pass when |
|---|---|
| Routes | On 20 real rides, OpenGravel beats the fastest-route baseline on 16 or more, with **zero** trust failures (private, gated, closed, too rough for the bike, dead-end spur, U-turn) |
| Ride screen | 10 recorded rides replayed through the simulator: every turn announced in time, no false "off route", reroute within 10 s, map is at least 80% of the screen, controls at least 56 px |
| Dead zone | Plan a ride, save it, switch to airplane mode, finish the ride with map and turn prompts, in Safari and in the iPhone app |
| Free and fast | First route on screen in 5 s (75th percentile); $0 a month in third-party bills on the default setup; no account |
| Real ride | Installed from TestFlight; the owner plans on the laptop, rides it on the bars, and answers a 5-question ride-day form with no "had to stop and fiddle" |

## 2. Honest audit

**Works today (verified):**
- Production is live on `536bee5`, health OK, both routers up. Coverage is Pennsylvania plus New Jersey only (router box `-80.59,38.78` to `-73.91,42.28`).
- Planner with four ride styles, loops, dirt loops (on in production), draw-a-route, avoid areas, GPX in/out, share links, 112 real rider routes in Explore (`data/catalog/routes.json.gz`).
- Web ride screen with turn cards, voice, reroute, recording, screen kept awake (`src/ui/ride/RideFocus.tsx`, `src/application/ride-session/`).
- "Will my bike make it" has a real base: a garage with per-bike gravel and rough-track limits, enforced as a hard rule (`src/application/planner/rider-road-eligibility.ts`).
- Closures and seasonal gates from five official sources, on in production (`src/server/planning/road-authority.ts`).
- Gates: CI on GitHub is green on main (lint, types, 6,434 unit tests, 185 architecture tests, build). Deploy script smoke-tests and rolls back by itself (`infra/deploy/release.sh`). Design rules are locked in `DESIGN.md` with one token file.

**Half-built (code exists, rider gets little or nothing):**
- **Routing quality is unproven.** The last full benchmark (`docs/vnext/research/ride-formula-benchmark-2026-10-04.md`) was 5 wins, 7 losses, 16 ties, and several "gravel" A-to-B trips came back with 0% dirt. Later fixes helped loops. Three routing experiments still run in "shadow" or off in production (ride formula, fun generators, atlas generators). The better road graph (`graph-schema-v2`) is a design doc only.
- **Offline.** An in-browser offline router, region packs and tests exist (`src/domain/offline/`, `src/infrastructure/offline/`), but production health reports offline regions as **missing**. Nobody can download anything.
- **iPhone app.** A Capacitor shell that loads the website, plus a native navigation package and a lock-screen Live Activity. Signed with a free Personal Team and re-signed every 6 hours, so **TestFlight is impossible until the owner joins the paid Apple Developer Program**. The Live Activity has never been seen on a real phone. Offline inside the shell is probably broken (`apps/ios/capacitor.config.ts` has app-bound domains off, which iOS needs for the offline shell). Device acceptance issues #9, #10, #11 have been open since September.
- **Rider reports.** Storage and moderation exist (`src/server/contributions/`), but there is no report button on the ride screen and reports do not affect routing.
- **Proof tooling.** No GPX ride simulator (only a fixed-speed walker, `src/infrastructure/ride/fixture-position-source.ts`). No screenshot baselines (zero `toHaveScreenshot`), so CSS can still drift. The nightly "acceptance" workflow has failed 40 runs in a row at its first step. Browser tests show 14 of 138 timing out on busy machines.

**Dead weight: freeze now (keep running, no new work, bug fixes only if they break the build):**
- Hiking mode and trail catalog (about 50 files plus a second router on a production box whose swap is 96% full).
- Spotify, traffic cameras, AI "Ask" and the Jev judges, wind arrows, sun lighting, long-trip, live follow, emergency card.
- The native SwiftUI rewrite plan and its 51-card board (PR #97), CarPlay (#46), PRs #98, #99, #165: close them.
- The 26-mission acceptance pack and its nightly job: switch the schedule off.
- `CLAUDE.md` on main is stale. It tells every agent to read six October "closeout" documents first, so cheap workers burn their context on history. Replace it with one page.

**Brief corrections:** the policy is named `…VNEXT_1` in code but reports version `…VNEXT_2`. The old giant `globals.css` and `theme-glass.css` are gone; there are now 35 CSS files (20,044 lines) on one token file.

## 3. Roadmap, in rank order

Three lanes run side by side: **Routing** (R), **Ride and phone** (P), **Look** (L). One milestone in progress per lane. "CI" means GitHub's runners, which are free for this public repo and keep heavy runs off docker-dev.

| # | Lane | Milestone and what the rider sees | Why it beats Google / Gaia | Pass/fail check | Worker · machine · size |
|---|---|---|---|---|---|
| 1 | R | **Route scorecard.** A one-page report: 20 real rides, us against the fastest route and against what riders actually rode | Nobody else can show this | `npm run scorecard` exits 0, writes the report, and two runs give identical results | Codex Sol · docker-dev · M |
| 2 | P | **Ride simulator.** Real GPX rides replayed through the navigation code | Finds missed and late turns before a rider does | `npm run ride-sim` passes 5 scenarios on 10 tracks, in CI | DeepSeek · docker-dev · M |
| 3 | L | **One clean front door.** Open the app: search, Loop, Ride. Hiking, music, cameras and Ask move to Settings | Google-simple first screen with a rider's options one tap away | Browser test: cold load to a planned route in 3 taps or fewer; shots gallery for phone and desktop, both themes; then record screenshot baselines | Sonnet · docker-dev, CI · M |
| 4 | R | **Zero trust failures.** Never routed down a private drive, a gated forest road, a closed road, a dead-end spur or a track too rough for your bike | Google sends cars up private lanes; Gaia does not route for you | Scorecard trust column is 0 on the 20 rides and on a 20-ride hold-out set | Codex Sol · docker-dev, Windows PC if the graph is rebuilt · L |
| 5 | P | **Handlebar ride screen.** One next action, glove-size targets, readable in sun, nothing else | Google's ride view is for cars; Gaia is a map viewer, not a turn-by-turn ride screen | Simulator filmstrip plus automatic checks: map 80% or more, controls 56 px or more, contrast 7:1, one primary action; owner picks from a gallery | Sonnet · docker-dev, Mac for iPhone shots · M |
| 6 | P | **TestFlight (internal).** Install from TestFlight, no more 6-hourly re-signing | Getting it on the phone at all | Build number listed by App Store Connect; Maestro plan-and-start and free-ride flows pass on the simulator | Opus via `fleet run mac` · MacBook · M (needs the owner's Apple enrolment) |
| 7 | R | **Gravel that is really gravel.** Ask for dirt, get dirt; ask for twisty, get twisty | The core reason to choose this app | Scorecard: 16 or more wins of 20, hold-out within 2 rides of that; every shadow flag is switched on or deleted | Codex Sol · docker-dev plus Windows PC · L |
| 8 | P | **Dead-zone ride.** "Save for offline" on any ride; airplane mode still works | Google cannot keep a custom route offline; Gaia charges for offline maps (confirm by hand) | Browser test: plan, save, go offline, reload, simulated ride finishes with map tiles and prompts. Same on the iPhone simulator with the network off | Codex Sol · docker-dev, MacBook · L |
| 9 | P | **Laptop to phone.** A QR code on the desktop route; scan it, tap Start | No account needed | Browser test: desktop plan, open its link in a phone-size window, same route, Start is enabled | DeepSeek · docker-dev · S |
| 10 | L | **Rider map style, free.** Our own day and night map: gravel drawn as gravel, twisty roads stand out, quiet clutter. No Mapbox needed | Google shows no road surface. This is the "most beautiful, free" ask | Shots at 5 fixed places, 3 zooms, 2 themes; browser test sees zero Mapbox requests on the default setup; owner picks in a blind A/B | Sonnet · docker-dev · M |
| 11 | R | **Will my bike make it?** One line per route: "Fine for your bike: 12 mi gravel, 0.8 mi rough track, 2 mi unknown", worst stretch one tap away | Neither rival knows your bike | Unit tests over 6 routes and 3 bikes; shots of the line | DeepSeek · docker-dev · M |
| 12 | R | **Gates and closures you can see, plus one-tap report.** "Checked today: 5 sources" on the route; a big "gate closed / road bad" button while riding that reroutes your next plan | Fresher than either rival where it matters | Live-router test with a known closure; browser test: report a road, plan again, the road is avoided | DeepSeek for the screen, Codex Sol for routing · docker-dev · M |
| 13 | R | **Mid-Atlantic coverage** (stretch): add NY, MD, DE, WV, VA, which covers the Mid-Atlantic BDR | More of where the owner's riders go | Router reports the new box; 10 new regional rides with zero trust failures; planning time still inside the bar | Codex Sol · Windows PC build · L (needs an owner call on production memory) |

Rough timing: weeks 1–2 do 1, 2, 3 and start 6. Weeks 3–6 do 4, 5, 9. Weeks 6–10 do 7, 8, 10. Weeks 10–13 do 11, 12, then 13 if memory allows.

## 4. The autonomous loop (nothing new to build)

Uses what is on main from #203: `AGENTS.md`, and `paseo.json`, which sets up every new worktree by itself.

1. **The plan** lives in one file, `docs/PLAN.md` (this document). Opus turns the next milestone into at most 8 GitHub issues. Each issue has one rider-facing sentence, the named files, and a pass/fail command.
2. **Pick up.** An Opus session starts workers in Paseo worktrees off `origin/main`: DeepSeek V4.1 Flash (OpenCode or Pi) for bounded jobs, `delegate sol --wt <slug>` for routing and hard bugs, Sonnet for screens. At most 2 light workers plus 1 heavy at a time; overflow goes out with `fleet run auto`.
3. **Prove.** On docker-dev a worker runs only typecheck, lint and the unit tests for the files it touched, then opens a PR. **GitHub CI is the gate of record**: full unit tests, architecture tests, build, and (added in task 3) the browser tests. Routing PRs must attach a scorecard run. Screen PRs must attach a before/after shots gallery, and after milestone 3 must pass the screenshot baselines.
4. **Review.** Opus checks the evidence against the issue's pass/fail line and merges. Opus cannot waive a gate. Two failed attempts by a cheap worker means one attempt by Codex Sol; if that fails too, the issue is parked with a note. No retry loops.
5. **Ship.** Twice a week at most. Opus sends the owner one message: what changed in rider words, three screenshots, the scorecard line. The owner says go; `release.sh` deploys and rolls back by itself if the smoke test fails.

**The owner is pinged only for:** ship-day go or no-go; one taste pick a week at most, always as side-by-side pictures; money, accounts and hardware; a ride-day form roughly every three weeks.

**Rules that stop churn** (go into `AGENTS.md`):
- Work-in-progress limit: 3 open PRs. Nothing new starts while a PR is more than 3 days old.
- Frozen areas (section 2) are off limits.
- No new documents. Handoffs go in the PR description. Only `docs/PLAN.md` and the scorecard result are updated.
- No new "shadow" switches. A routing change is turned on or deleted in the same PR, decided by the scorecard.
- Taste is decided once, written in the `DESIGN.md` decision log, and never re-asked. A change to an approved screenshot without a log line fails review.
- A flaky browser test gets one rerun, then moves to a non-blocking job with an issue. Never "rerun until green".
- At most 1 PR in 5 may be plumbing. Every other PR must start with a sentence a rider would understand.

## 5. Route scorecard spec

**The 20 rides** (one checked-in file, `tests/scorecard/rides.json`):
- 12 from the 112 real rider routes: 6 dirt loops and 6 twisty paved rides, spread across the state. The rider's own track is the ground truth.
- 4 dirt trips already used in `scripts/ride-formula-benchmark.ts` (Pine Grove Furnace, Rothrock, Lock Haven to Slate Run, Williamsport to Waterville).
- 4 everyday A-to-B rides from `tests/real-router/routing-quality-corpus.ts`.
- A second set of 20 from the same catalog is the **hold-out**. It is run only on ship days, so nobody can tune to it.

**Who is compared, legally and for $0:**
- **OpenGravel:** the same code path as the live planner (`planRide`).
- **Fastest baseline:** our own router's fastest profile. This is the honest stand-in for Google, and is labelled that way. No Google API calls and no scraping: Google's terms restrict storing and reusing their results, and it is not worth the risk for a public project.
- **Google, by hand:** the report prints an official Google Maps directions link for each ride. Once a quarter someone opens the 20 links and types in Google's time and miles (20 minutes). Those numbers sit beside ours.
- **The rider's own line (scorecard v2):** for the 12 rides that came from a real rider's track, the track is put onto our roads with the app's road matcher and measured with the same code. It is a ruler, not a contestant: it never plans anything and is never scored as "match the rider". It only proves the measure can tell a rider's favourite road from the fastest one.
- **Gaia, by hand, once:** a capability checklist with screenshots, because Gaia has no routing service to call: does it propose a gravel loop, show surface, speak turns, work offline for free, know my bike, know closures, and what does it cost.

**Measured per ride, same code for every contestant** (reuse the yardsticks in the benchmark script):
1. Good miles: dirt miles in gravel modes. In curvy mode, the planner's own bend miles (the same measure that ranks routes in the app: long sweepers count; junction corners, town streets, ramps and roundabouts do not). v1 counted raw tight corners, which a zig-zag through a street grid could farm.
2. Busy-road share.
3. Extra time against the fastest route (loops: distance from the requested time).
4. Rider match: how much of the real rider's track our route found (shown, not scored).
5. Trust failures: private or no-access road, gate without permission, closed on the ride date, beyond the bike's limit, sand, dead-end spur over 300 m, U-turn.
6. Unknown-surface share (shown; unknown is never counted as gravel) and planning seconds.
7. Router calls per plan and first-route seconds (how long until the first route came back), with the 75th percentile. The plan's cap is 6 calls.

**Scoring:**
- **Win:** zero trust failures, inside the time budget (A-to-B: at most 35% over fastest; loops: within 15% of the asked time), good miles at least 1.5 times the baseline and at least 3 miles more, busy share no more than 10 points worse. For loops, good-mile share of 35% (gravel) or, for curvy, 30.80%: 75% of the median share of the riders' own tuning lines (set once from what riders rode, not from what our router returns, and frozen with the `rides.json` hash in `scripts/scorecard/frozen-threshold.ts`; a test fails if the file changes without a deliberate `npm run scorecard -- --freeze-threshold`).
- **Loss:** any trust failure, over budget, or fewer good miles than the baseline. Anything else is a tie.
- **Headline:** "16/20 wins, 0 trust failures, +N good miles for +M minutes".
- **Yardstick check:** the rider's own line must beat the fastest route on good miles on at least 10 of the 12 tracked rides, or the run exits with code 2 and says the measure is not measuring fun.
- **v1 beside v2:** the report prints the old v1 headline next to the v2 one, so nobody can say the goalposts moved quietly.
- **Rule:** a routing PR may not lower wins or raise trust failures.

Cost: about 630 router requests (the planner alone makes up to 53 per plan today) and 9 minutes, run one at a time against the existing router through an SSH tunnel. Fixed request IDs keep loops repeatable.

**First v2 run (2026-11-10, tuning set):** v2 says 10/20 wins, the old v1 yardstick said 4/20, trust failures 0. The yardstick check **failed**: the rider's own line beat fastest on good miles on 8 of 12 tracked rides (needs 10). On four of five Curvy loops the plain fastest loop reaches 31 to 55% bend share, about the same as the riders' own lines (27 to 67%), so the planner's bend measure cannot yet tell a rider's favourite road from the fastest one. Until that passes, read the Curvy wins as unproven. Router calls per plan: 75th percentile 37 (cap 6); first-route seconds, 75th percentile 5.5.

## 6. Top risks, and what not to build

1. **Breadth creep returns.** It is the proven failure here. The freeze list and the WIP limit are the fix. Owner confirmed on 2026-11-10: hiking is frozen for 90 days.
2. **The production box is full.** 8 GB, swap 96% used, app plus two routers. Milestone 13 cannot land there as is. Stopping the hiking router would free about 1 GB.
3. **Apple.** No TestFlight without the paid programme. Public release of a web-wrapper app can be rejected as too thin, so stay on internal TestFlight for these 90 days. The Mac has about 14 GB free and is on a small charger.
4. **Maps bill and terms.** The best-looking maps today come from Mapbox's free tier through a non-Mapbox renderer. A public launch can exhaust the quota, and the terms should be read. Milestone 10 removes the dependency.
5. **Rider route licence.** The 112 catalog routes say "licence not specified by the source". Fine for scoring; get the group admin's OK before making a public splash with them.
6. **Tuning to the test.** 20 rides is small. The hold-out set and the owner's ride days are the guard.
7. **Cheap workers in huge files** (`host.ts` 3,408 lines, `ride.css` 3,071, `ride-focus-store.ts` 2,733). Name the files in every issue, and give routing core to Codex Sol.
8. **Flaky gates.** If CI's browser job is unreliable, agents will learn to ignore red. Quarantine flakes in week 1.

**Do not build:** the native SwiftUI rewrite, CarPlay, Android, anything for hiking, group rides, fuel briefing, a social feed, accounts or cloud sync, more AI, 3D flyover, street-level photos, more weather layers, a second router engine, nationwide coverage, region-wide offline packs, another test framework, another design-token migration.

## 7. First three tasks for tomorrow

**Owner, 10 minutes:** (a) join the Apple Developer Program, $99 a year, because approval takes days; (b) say yes or no to freezing hiking for 90 days.

### Task 1: Route scorecard v1 (run with `delegate sol --wt og-scorecard`)

```
This codebase is yours. Repo: OneBigHen/OpenGravel, branch from origin/main. Read AGENTS.md first.
Goal: `npm run scorecard` produces a one-page report comparing OpenGravel with the fastest-route
baseline on 20 real rides. Measurement only: do not change routing behaviour.
Build on what exists: scripts/ride-formula-benchmark.ts (planRide entry point and yardsticks: dirt
share, Franco curvature, busy share, minutes), tests/real-router/routing-quality-corpus.ts, and
data/catalog/routes.json.gz (112 real rider tracks; reuse the catalog's own polyline decoder).
Deliver:
1. tests/scorecard/rides.json: 20 tuning rides + 20 hold-out rides (12 catalog rides, 4 dirt trips
   from the benchmark script, 4 corpus A-to-B rides per set), each with start, end or loop minutes,
   mode (gravel | dual-sport | curvy), a fixed request ID, and the rider track where one exists.
2. scripts/scorecard/: per ride and contestant (OpenGravel, fastest profile) compute good miles,
   busy share, extra time, rider match, unknown-surface share, planning seconds, and trust failures
   (private/no access, track grade or smoothness beyond the bike, sand, road-authority closure,
   dead-end spur over 300 m, U-turn). Apply the Win/Tie/Loss rule in docs/PLAN.md section 5.
3. Output scorecard-out/latest.json and a self-contained index.html: headline line, one row per
   ride, an SVG sketch of each route, and a Google Maps directions link per ride (link only; never
   call Google). Add scorecard-out/ to .gitignore.
4. Unit tests with small fixtures for the dead-end, U-turn and Win/Tie/Loss functions.
Router: use GRAPHHOPPER_URL through `ssh -N -L 8989:127.0.0.1:8989 docker-stable`, strictly one
request at a time. Copy gravel-atlas-v3.sqlite from docker-stable:/var/lib/opengravel/ into your
worktree's ignored data folder (read-only copy; never write to production). Use production's
switches: OGV_DIRT_LOOP_GENERATORS=on, OGV_ATLAS_GENERATORS=off, OGV_RIDE_FORMULA=shadow,
OGV_FUN_GENERATORS=shadow, OGV_ROAD_AUTHORITY=on.
Pass/fail: `npm run scorecard -- --set tuning` exits 0; two runs give the same wins, ties, losses
and trust counts; npm run typecheck, lint and the new unit tests pass; no existing file under src/
changes behaviour. Do not run `npm run build` or the full test suite on docker-dev; open a PR and
let CI run them. PR description: today's headline ("Wins X/20, trust failures Y") and the three
worst rides in plain English.
```

### Task 2: Ride simulator gate (DeepSeek V4.1 Flash, OpenCode or Pi in a Paseo worktree)

```
Repo: OneBigHen/OpenGravel, new worktree from origin/main. Read AGENTS.md first.
Goal: `npm run ride-sim` replays rides through the real navigation code and fails on bad guidance.
Use the framework-free code in src/application/ride-session/ (navigation-engine.ts,
position-pipeline.ts, navigation-route.ts, reroute.ts). Model your position source on
src/infrastructure/ride/fixture-position-source.ts. Do not change any file under src/.
Deliver:
1. tests/ride-sim/: a replay position source that feeds timestamped fixes from a track at real
   speeds, with optional seeded GPS noise.
2. 10 tracks under tests/fixtures/ride-sim/, built from routes with turn instructions in
   tests/fixtures/route-plan (add small ones if needed; no network at test time).
3. Five scenarios per track: clean follow; 8 m GPS noise; a missed turn; 30 s with no GPS;
   a 2-minute stop.
4. Assertions: each turn is announced exactly once, at least 150 m or 8 s before it; nothing is
   announced after the turn is passed; no off-route alert in the clean, noisy and no-GPS runs; the
   missed turn raises off-route within 10 s and asks for a reroute; progress never goes backwards;
   arrival fires once.
5. A `ride-sim` vitest project, an `npm run ride-sim` script that prints a pass/fail table, and a
   CI step that runs it.
If a scenario exposes a real navigation bug, do not fix it and do not loosen the assertion: mark
that one case `it.fails` with a one-line reason and list every such case in the PR description.
Pass/fail: `npm run ride-sim` exits 0 in under 2 minutes; npm run typecheck and lint pass; open a
PR and let CI run the full suite. Never run `npm run build` on docker-dev.
```

### Task 3: Clear the runway (DeepSeek V4.1 Flash, small; Opus reviews)

```
Repo: OneBigHen/OpenGravel, new worktree from origin/main. Documentation and CI only: no file
under src/ may change.
1. Copy the master plan to docs/PLAN.md.
2. Replace CLAUDE.md with at most 60 lines: what OpenGravel is (one sentence from docs/PLAN.md
   section 1), the ten "Core invariants" kept word for word, "the plan is docs/PLAN.md", "everything
   else under docs/ is history, not a work order", and the production rules (never deploy without
   the owner; deploy only with infra/deploy/release.sh on docker-stable). Remove the "Read before
   changing code" list, "Current closeout priorities" and "Work log" sections.
3. In AGENTS.md add two sections taken from docs/PLAN.md: "Frozen areas" (section 2) and "Rules
   that stop churn" (section 4). Change "Before calling work done" to: on docker-dev run typecheck,
   lint and the unit tests for the files you touched; GitHub CI runs the full suite and the build.
4. In .github/workflows/acceptance.yml remove the nightly `schedule` trigger and keep manual runs.
   It has failed 40 nights in a row.
5. In .github/workflows/ci.yml add a pull-request job `e2e-critical`: npm ci, install Chromium,
   npm run build, `npx playwright test --project=critical-chromium --retries=1`, upload the report.
Pass/fail: CI is green on your PR including the new job; `wc -l CLAUDE.md` is 60 or less;
`grep -c "schedule" .github/workflows/acceptance.yml` prints 0; `git diff --stat origin/main -- src`
is empty. If browser tests fail in CI, list each failing test in the PR description and move only
those to a separate non-blocking job. Do not delete or skip them silently.
```
