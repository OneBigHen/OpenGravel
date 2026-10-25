# Brief: ride screen and whole-app flow overhaul (2026-10-25)

Repo: OneBigHen/OpenGravel (Next.js 16 + React + TypeScript + MapLibre; iOS = Capacitor shell with
native Ferrostar nav + Spotify App Remote). Live: https://opengravel.henning.rodeo. Design system:
`docs/vnext/design/small-screen-v2.md` (read first; it is binding). Deploy: `infra/deploy/release.sh`
on docker-stable (candidate on :3299 first). Heavy builds/Playwright go on powerplex, not docker-dev.

The rider is a motorcyclist with an iPhone on the bars, gloves on, in sun or rain, often using the
site in Safari (not only the installed app). Judge every change by: can I read it in one glance at
45 mph, and can I do the obvious thing with one gloved tap?

## What the owner saw on a real ride (iPhone, Safari, Hatboro PA, 8:41 am)

Screenshot: `/tmp/56A99443-5019-4A18-B8FD-BA1C27E432DB.jpeg`.
1. The top third of the screen is a big white "Off the route. Head back to the line. 250 ft off route"
   card with **Reroute now** / **Details**, plus a second red banner: "The ride changed on another
   screen. Return to Plan to update it." That banner is developer state (a stale tab/revision), not
   something a rider can act on mid-ride.
2. The map is cluttered with basemap POIs (7-Eleven, Bar Nails, Reid Repairs, Municipal Lot, Village
   Pretzels, Ross&Co Kitchen). The route line is a thin black/white casing that is hard to see.
3. Five floating controls on the right (compass, + / −, route overview, sound, red ✕). The ✕ is
   ambiguous: end the ride? cancel the route? clear the plan?
4. Bottom strip: speed shown as "1 / mph / SPEED" stacked; **DIST LEFT —** and **TIME LEFT —** while
   off route; a chevron with no label.
5. **No Spotify** anywhere, though the app has a Spotify integration (native App Remote on iOS, Web
   Playback/Connect path on web).
6. No next-turn card at all while off route; nothing tells the rider which way to go.
7. Overall flow is unclear: where do I cancel the current route, end the ride, switch to Free Ride,
   or go back to planning?

## Goals

### A. Ride screen (src/ui/ride/*, src/app/RideClient.tsx, ride map layers)
- **One top card, always the next action**: maneuver glyph + distance (34 px/700) + street (20 px),
  with a "then" line when relevant. Off route = the same card says "Turn around" / "Head back to
  Main St" with the direction to the route, plus ONE action ("New route from here", ≥56 px). Reroute
  automatically after ~10 s off route at speed (setting), so the rider rarely has to tap.
- **Kill the "ride changed on another screen" banner** on the ride screen. If the ride was edited
  elsewhere, keep riding the version that is loaded and offer the update quietly in the sheet
  ("A newer version of this ride is ready — Switch"), never as an alarm.
- **Bottom strip**: speed (with the speed limit sign when known), distance left, ETA clock time
  ("arrive 10:12") — 24 px tabular, never "—" while a route exists (keep the last known value).
- **Controls**: one right column, ≤3 buttons (Recenter/overview, Sound, Layers-lite). Zoom by pinch.
  Replace the ambiguous ✕ with a labelled **End** button in the strip or sheet.
- **Ride sheet** (swipe up from the strip): End ride · Cancel route (keep riding as Free Ride) ·
  Reroute · Add a stop (gas/food along the route) · Share live location · Ride style · Report. Each a
  56 px row with plain words. "Cancel route" and "End ride" must be obvious and distinct.
- **Map while riding**: hide basemap POI labels except gas (and stops the rider added); thicker,
  high-contrast route line (plum with a white casing, ridden part dimmed); auto night style at
  sunset; north-up/heading-up toggle via the compass.
- **Spotify**: a slim now-playing strip (art, title, play/pause, next) above the bottom strip when
  Spotify is connected — native App Remote in the iOS app, Spotify Connect/Web API on web. When not
  connected, one row in the ride sheet: "Connect Spotify" that returns to the ride after auth. It
  must never cover the maneuver card or the strip; one-tap play/pause with a glove.

### B. Flows across the app
- **Plan → Ride → Finish → Saved** must be one obvious path. Starting a ride from Plan, Explore
  ("Plan this ride"), My rides, and a shared link all land in the same ride screen.
- **Cancel / clear**: on Plan, clearing a route is one obvious control with undo; during a ride,
  "Cancel route" continues as Free Ride; "End ride" goes to the finish summary (Save / Discard).
- **Resume**: reopening the app mid-ride resumes the ride (exists; verify on Safari + iOS).
- **Safari**: offer "Add to Home Screen" once (dismissible) so the ride screen runs full-screen;
  respect safe areas; keep the screen awake during a ride (Wake Lock API where available).

### C. Mechanics
- Off-route detection with hysteresis (no flicker at 50–250 ft in towns); auto-reroute policy;
  wrong-direction detection; GPS-quality wording ("Finding GPS", never "stale" before a first fix).
- ETA updates from real moving speed; distance-left never resets to 0 or "—" mid-route.
- Voice prompts timing at speed; sound toggle remembered.

## Rules
- Plain words, no status badges or developer state in the rider's view; 48 px targets (56 on the
  ride screen); nothing clipped at 320 px; Day + Night; prefers-reduced-motion respected.
- Prove it: Playwright scripts with simulated GPS (on route, off route, back on, finish) screenshot
  at 375×667 and 390×844 in Day and Night; look at every screenshot and iterate. Run the critical
  e2e specs for ride/free-ride/record/ride-spotify(-web) and fix what you break.
- Small, reviewable commits; a PR per area (ride screen, ride sheet + flows, Spotify, mechanics).
