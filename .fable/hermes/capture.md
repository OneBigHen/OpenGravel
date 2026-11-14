og-defect-capture-2026-11-12.md
# OG — defect capture (2026-11-12)

Zac's phone screenshots (8, annotated by hand) + a live audit of the deployed build.
**Capture only — nothing was changed in the app.**

| | |
|---|---|
| Live build | `https://gravel.henning.rodeo` · buildId `9e1c436750e2ff5ac6c3e63fe2871cedcb0ad328` · `/api/health` router `available` |
| Repo checked out here | `~/work/audits/opengravel-vnext` @ `8fc06b1` (branch `fix/sheet-swipe-gesture-hardening`); `origin/main` = `b50f74b` (2026-09-28) |
| **Important** | The live bundle contains features that are **not** in either tree (contours/slope layers, 31-layer catalog). **The live build is ahead of `origin/main`.** Confirm the deploy tree before fixing, or the fix lands in code nobody ships. |
| Simulator / Maestro | **not run** — MacBook (192.168.1.62/.61/.230) was unreachable at capture time. Live web app driven instead at 393×852 @3x, iPhone UA, geolocation set to Hatboro. |
| Vision | 8 screenshots read whole + 10 zoomed crops (handwriting separated from app UI). |

Evidence tags: **[SS]** = Zac's screenshot · **[LIVE]** = observed in the deployed build today · **[CODE]** = exact string/function found in the deployed JS bundle · **[NEEDS]** = plausible but not reproduced; confirm on device.

---

## P0 — core ride flow

### OG-01 Loop generation hangs on "Your ride is on its way — one moment."
**[SS]** `upload_ezms71qk.jpg` — Zac wrote **"STUCK"** across the map. Screen shows `Make my loop` + `Your ride is on its way — one moment.` with no spinner, no progress, no route, no error, and no way out other than `Cancel`.
**[CODE]** That copy is the `alternatives-loading` phase string: `D(n) ? "Your ride is on its way — one moment." : null` (`28smby4fggouz.js`). There is no loading indicator bound to the phase, so a slow or failed loop request is indistinguishable from a frozen app.
**Fix:** spinner/progress + elapsed time on the button, a client timeout (~20 s) that resolves to a retryable error, and a cancel that actually aborts the request. Never render a terminal-looking screen with no state.
**Done when:** killing the loop request server-side shows an error within 20 s, and `Make my loop` never sits on that sentence with no motion.

### OG-02 `Start` silently refuses a drawn route
**[SS]** `upload_fk04epat.jpg` — drawing flow with a complete `Your ride` summary (46 min · 16 mi · 2.8 mi of curves). `Start` looks disabled; the only explanation is a footnote at the bottom: **"Tap Done to keep your drawing before you ride it."**
**[CODE]** `SKETCH_PREVIEW_RIDE_REFUSAL` = `"Tap Done to keep your drawing before you ride it."` (`0ull5e-6w2v8x.js`).
**Fix:** the refusal should not exist as a dead end. Either enable `Start` and commit the sketch implicitly, or put the requirement next to the button ("Save your drawing first" with a `Done` affordance in the same row). A refusal string at the bottom of the sheet is not a state.
**Done when:** with a drawn route and no save, pressing `Start` either starts or shows an inline, actionable blocker at the button.

### OG-03 Routes redraw/reroute while you look at the map
**[SS]** `upload_fk04epat.jpg` — Zac: **"The routes don't draw correctly and they reroute a ton as you look at it."**
**[NEEDS]** Not reproduced live (map tiles never rendered in the desktop browser — see OG-26). Reported on device.
**Fix direction:** the drawn route must be a pure render of the current plan. Any replan must be explicit (`Replan`), not a side effect of pan/zoom/settle. Investigate plan identity: if the plan is keyed on viewport centre or a debounced "settled" event, every pan invalidates it.
**Done when:** panning and zooming for 30 s changes the route by zero metres; the polyline is unchanged except for projection.

### OG-04 "No route yet" is a broken error surface
**[SS]** `upload_azb6witt.jpg`, `upload_2celh707.jpg`
- Error text is **clipped mid-word by the floating pill**: visible fragment `The routing servic` behind `No route yet / Retry`. The actual message ("The routing service is unavailable right now.") never renders in full.
- **Two competing retries**: `Retry` in the pill and `Plan again` at the bottom.
- **Stale guidance**: `Tap the map to set your destination.` still showing while start *and* destination are filled (`Palmerton, PA` → `Bowmanstown, PA`).
- Large empty gap between the `×` and `Change this ride`.
**Fix:** one error row at the top of the sheet (icon + full message + one `Retry`), remove the duplicate action, and drive the helper text off actual planner state.
**Done when:** forcing the router offline shows a fully readable message, exactly one retry affordance, and no "tap the map" copy.

### OG-05 Route stats exist before a route does
**[SS]** `upload_fk04epat.jpg` — `Finding roads...` shown *together with* `46 min · Arrive 11:46 PM · 16 mi · 2.8 mi of curves · 339 ft · no gravel found · 1 mi unknown`.
**Fix:** one state machine for the summary — empty → computing (skeletons) → complete → error. Never mix computing and complete.
**Done when:** during a computed route, every stat is a skeleton, not a number.

---

## P1 — the ride you actually saved

### OG-06 No way to ride a saved GPX that starts elsewhere
**[SS]** `upload_2celh707.jpg` — Zac: *"I have tons of GPX routes but if I want to ride any of them and I'm obviously not near them, it should reroute me to them."*
**[LIVE]** `/rides` has `Import GPX`, `No saved rides yet`, `Plan a ride`, `Find a ride`, `More import options`. Nothing offers "get me to the trailhead".
**Fix:** on any imported/saved route, if the route start is more than ~2 mi from the rider, show a first-class **"Ride to the start · N mi"** action that plans a connector, then hands over to the route itself. Same for Explore cards that are 25–295 mi away — the app already knows the distance ("10 mi away").
**Done when:** import a GPX starting 40 mi away → one tap produces a connector leg + the route, as a single ride plan.

### OG-07 Two duration formatters, two different units
**[SS]** `upload_semzg0sp.jpg` — top pill `55 mi · 1 h 52 m`, sheet `1 h 52 min`.
**[CODE]** Both exist in `28smby4fggouz.js`:
`aO = e => t<60 ? "${t} min" : "${h} h ${mm} m"` and `e_ = e => 0===n ? "${t} h" : "${t} h ${n} min"`.
**Why it matters:** "m" next to elevation in metres and distances in miles reads as metres.
**Fix:** one formatter, minutes always spelled `min` (or `h:mm`), applied to pills, sheets and cards.
**Done when:** `grep` finds one duration formatter and no `h … m` output anywhere.

### OG-08 Elevation/units are metric in a US imperial app
**[SS]** `upload_z7x6dd49.jpg` — contour sheet: `160 m contour`, "metres above sea level", "DEM resolution roughly 30–90 m".
**[SS]** same app elsewhere: `339 ft`, `2,201 ft`, `55 mi`, `50°F`.
**[CODE]** `MAP_LAYERS` caveats are hard-coded metric (`src/application/map-layers/catalog.ts`, and live chunk `0z0b5y2093flj.js`).
**Fix:** single unit system from the rider's locale; feet for elevation in the US, and no "metres" in user copy.
**Done when:** a US locale shows ft/mi everywhere including layer copy.

### OG-09 "160 m contour" is a wall of data provenance
**[SS]** `upload_z7x6dd49.jpg` — sheet body, verbatim:
> Derived Terrarium elevation, metres above sea level; 160 m interval at this view. Source survey date unknown.
> AWS Terrain Tiles (Mapzen Terrarium). DEM resolution roughly 30–90 m, varying by source region. Derived contours and slope use a coarser visible-view grid; spacing shown when loaded. Terrain gradient is not road grade. Online only; source survey date unknown.

**[CODE]** That is `source` + `caveat` concatenated from the layer catalog — `caveat` for `contours` and `slope` is 221 chars each in the live bundle, and the phrase "source survey date unknown" appears **twice**.
**Also:** 160 m contour interval at riding zoom is useless (that is ~525 ft between lines).
**Fix:** the info sheet shows one sentence — *what it is, what you can do with it* ("Elevation lines — tighter lines are steeper ground"). Provenance belongs in a `Data sources` page. Delete the duplicate. Make the interval adaptive and stated in ft.
**Done when:** no layer info sheet exceeds two short lines and contains no acronym (DEM, AWS, NRT, MVUM, WZDx).

### OG-10 Layer catalog ships raw engineering text to users
**[LIVE]** 31 layers, each with `source` + `caveat`. Samples from the shipped bundle:
- `Trail closures` → source `"TODO: trail closure sources"`, row renders a permanent **"Not available yet"**.
- `Forest Service roads` → "USFS MVUM · canonical routing authority"
- `Road work` → "USDOT WZDx registry / state DOT · canonical routing authority", "Feed gaps, unknown dates and stale reports remain visible; no report is not proof of a clear road. Requires the routing authority connector. Online only."
- `Public land` → 225-char caveat.
**Fix:** audit all 31; delete unavailable layers from the UI until they work; rewrite caveats as one rider-facing line; move the rest to a Data sources screen.
**Done when:** no user-visible string contains `TODO`, `canonical`, `connector`, `Online only`, `feed`, `registry`, `NRT`.

### OG-11 Rail stats that don't say anything
**[SS]** `upload_semzg0sp.jpg` — `1% gravel · <1 mi unknown`, `↗ 2,201 ft`, `4.8 mi of curves`, unlabeled grey surface bar with a chevron.
**[CODE]** `no gravel found` / `${x}% unknown` / `<1 mi unknown` are generated literally by the surface summary (`0ull5e-6w2v8x.js`), including the branch that yields the contradictory `no gravel found · 1 mi unknown`.
**Fix:** label each stat (`Climb 2,201 ft`), explain or drop "unknown", and give the surface bar a legend. Never print "no gravel found" and "1 mi unknown" in the same row.
**Done when:** every number on that rail has a word next to it that a non-developer reads correctly.

### OG-12 Arrival language is machine output
**[SS]** `upload_semzg0sp.jpg` — pill `55 mi · 1 h 52 m · before sunrise`; sheet `Back 12:50 AM · 55 mi`.
**[CODE]** `arrivesBeforeDawn ? "arrive before sunrise" : difference===0 ? "arrive around sunset" : "${hours} ${before|after} dark"`.
**Fix:** show the clock time the rider cares about (`Back 12:50 AM · before sunrise`), not two different phrasings of the same fact.
**Done when:** one arrival string per surface, always including the time.

### OG-13 Stats duplicated between pill and sheet
**[SS]** distance/duration/arrival appear in the floating pill *and* the sheet `Your ride`, with different formats (OG-07) and different arrival wording (OG-12).
**Fix:** pill = glanceable (distance + duration); sheet = detail. Define which fields live where.
**Done when:** no field is shown twice on one screen with a different string.

### OG-14 Weather line duplicates itself and mixes units
**[SS]** `Chance Rain Showers · 50°F · 54% rain`
**[LIVE]** `/` header chip: `49°` + `Coastal Flood Advisory` (no unit on the temperature on the map path, `°F` on the loop path, `54% rain` reads as a quantity of rain).
**Fix:** `Rain likely · 54% · 50°F` or icon + `54%`; one temperature unit everywhere.
**Done when:** one weather string component is used by the map chip and the loop sheet.

### OG-15 Explore cards disagree with their own detail rows
**[LIVE]** `/explore` — top three cards vs the full listing:
| Ride | Top card says | Full card says |
|---|---|---|
| Ride to Van Sant Airport | `1.6 mi dirt` | `2.1 mi of curves · Mostly paved, 1.6 mi dirt` |
| Lansdale Street Ride | `1.6 mi of curves` | `1.6 mi of curves · Paved` |
Full cards also render **blank stat lines** for `Blackwater Down & Back`, `Shinhopple KOM`, `Spring Green Ridge`, `Pittsburgh 380 Mile Loop`, `Erie, Covered Bridges & Pymatuning`.
**Fix:** one card component, one set of fields; decide the primary stat (curves vs dirt) and keep it consistent; hide the line rather than leaving a gap when data is missing.
**Done when:** every card's numbers match its detail sheet, and no card has an empty stat row.

---

## P1 — navigation sheet (the safety surface)

Zac annotated `upload_obwar4w8.jpg` with the row labels he expected — the sheet is where he was least sure what he was looking at.

### OG-16 Rows clipped at the sheet's top edge
**[SS]** `upload_6rudbvh1.jpg`, `upload_obwar4w8.jpg` — the first visible rows (`Emergency` / `Where am I, call 911`, then `Road blocked` / `Gate closed, road too rough`) are sliced horizontally through the letters by the sheet edge, with no header, grabber or fade. **[NEEDS]** confirm on device.
**Why it's P1:** `Where am I, call 911` is the emergency affordance and it is the thing being cut.
**Fix:** sticky header on the sheet, top inset/padding, scroll fade, and the emergency row pinned above the scroll area.

### OG-17 Rows hidden behind the fixed footer
**[SS]** `upload_6rudbvh1.jpg` — `Navigate from here` / `New route from here` cropped between cards; `Voice guidance`, `Screen`, `More` sit under the fixed `Back to the planner` bar. **[NEEDS]** confirm.
**Fix:** bottom padding equal to footer height; no fixed bar over scrollable content.

### OG-18 Recording state is contradictory and the destructive action isn't styled
**[SS]** `upload_6rudbvh1.jpg` — one card says **"Not recording. The track was discarded; ride statistics are kept."** while offering **`Keep recording`** next to **`Stop following this route`** with no visual difference between them.
**Fix:** pick a state. If not recording: `Start recording` (primary) + `Stop ride` (destructive, red, confirm). Explain what is kept/lost in one short line.

### OG-19 Turn instruction truncates
**[SS]** `Turn right onto West Monument Aven…` — the street name, i.e. the part that matters, is what gets cut.
**Fix:** two-line instruction with the street name on line 2, or full name without truncation.

### OG-20 Live metrics slot shows a placeholder
**[SS]** bottom bar: `—` above `Speed`, then `0.5 mi` / `Dist left` / `10:58 PM` / `Arrive`. **[NEEDS]** confirm it isn't a genuine zero.
**Fix:** hide the metric until the first fix, or show `0 mph`. Never a bare dash with no unit.

---

## P2 — polish / trust

### OG-21 Layer count badge is unlabelled
**[SS]** `4`; **[LIVE]** `3` → clicking a layer makes it `4`, and the panel says `4 active`. A bare number on a layers button is read as "4 new things".
**Fix:** drop the badge or make it a dot; the panel already says how many are active.

### OG-22 Layer that never finishes loading
**[LIVE]** enabling `Contour lines` sets the row status to `Loading…` and it was still there two checks later (the row's `data-status` stayed `ready` while the text said Loading).
**Fix:** bind row status to real request state, with a timeout and a visible "couldn't load" state.

### OG-23 Screenshot-level jank in the map chrome
- `Not saved yet` floating label sits over the map with no context. **[LIVE]**
- Filter chips (`Gas Lodging Food Coffee Moto shop`) run to the right edge with no scroll hint; `Coffee` is clipped in Zac's build. **[SS]**
- Map labels clip at the screen edge (`…ding`, `Prussia`, `arple wnship`) and run under the Dynamic Island. **[SS]**
- Two identical `Hatboro` labels on one screen. **[SS]**
**Fix:** edge padding for labels, safe-area insets, and a scroll affordance on the chip row.

### OG-24 `My rides` empty state is a menu, not a next step
**[LIVE]** `Import GPX · No saved rides yet · Plan a ride · Find a ride · More import options` — five equal-weight actions for a rider with nothing saved.
**Fix:** one primary (`Import a GPX` / `Plan a ride`), rest behind a link. Add "riding a route someone sent you" as the headline case (links to OG-06).

### OG-25 Explore renders the whole catalogue
**[LIVE]** `/explore` puts **105 rides** in the DOM at once (plus a duplicated "Near you this weekend · 3 rides" block on top), and takes >4 s to hydrate from `Loading Explore…`.
**Fix:** window/virtualise, paginate by distance ring, and drop the duplicate summary block.

### OG-26 Map never leaves "Loading map…" (web)
**[LIVE]** In desktop Chrome at iPhone metrics, both `/` and `/explore` sat on `Loading map…` indefinitely (WebGL available, no visible error). May be environment-only — **confirm in the WKWebView app before filing as a bug.** Either way, a permanent "Loading map…" with no timeout or error is its own defect.

### OG-27 Copy fragments that read as unfinished
Live strings worth a second look while in there: `Tap Done to keep your drawing before you ride it.`, `no gravel found`, `Not saving yet`, `Route from Roost GPX locker · author not named`, `Trail closures — Not available yet`.

---

## What I could not do
- **No Maestro run.** MacBook was offline (all three addresses). The existing flow `apps/ios/maestro/plan-and-start.yaml` covers the happy path only. Add flows for: loop generation failure (OG-01), forced router error (OG-04), sketch-then-start refusal (OG-02), ride-sheet row visibility (OG-16/17), GPX-from-afar (OG-06). Suggested assertions are in the fix brief.
- **No device screenshots** of the ride screen beyond what Zac sent, so OG-16/17/20 are marked **[NEEDS]**.

## Suggested order for the fix lane
1. OG-01, OG-02, OG-04, OG-05 — the flow can't be trusted otherwise.
2. OG-03 — the one Zac described as "reroute a ton"; needs a repro on device first.
3. OG-06 — the feature he actually asked for.
4. OG-07/08/09/11/12/13/14 — one copy-and-units pass.
5. OG-16/17/18/19 — navigation sheet.
6. Everything else.

Companion: `CLAUDE-FIX-BRIEF.md` (ready-to-run prompt with acceptance checks).
