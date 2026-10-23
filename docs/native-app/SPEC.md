# OpenGravel iPhone v1: product and UX spec

What the rider sees and how it behaves. Cards cite sections here, for example "SPEC §4.2". Visual details (colors, type, spacing) live in DESIGN-SYSTEM.md, which is produced in Phase 1. Until it exists, use the OGDesign tokens as they are.

---

## 1. Who and why

- **Rider:** a motorcyclist on paved backroads and gravel, with the iPhone mounted on the handlebar and the map always on. They often wear gloves and a helmet, sometimes with a Bluetooth headset (Cardo or Sena).
- **Job:** find a great ride (curvy, quiet, the right amount of gravel), trust what the app says about it, then ride it without fiddling with the phone.
- **Edge over other apps:** honest route comparison (curvy miles, surface mix, backroad share, with "not known" shown as not known), the most beautiful map, a calm riding screen, and planning on the laptop that lands on the phone.

## 2. Principles (apply to every card)

1. **Glanceable while moving.** On the riding screen, everything important reads in under a second at arm's length.
2. **Gloves first.** While riding, tap targets are at least 60×60 pt. Elsewhere they are at least 44×44 pt. No swipes required while moving.
3. **Honest.** Unknown stays unknown. Never imply a road is open, legal, paved or safe without evidence.
4. **Calm.** One primary action per screen. No modals that block the map while riding. No sign-in.
5. **Fast.** The map appears within 1 s of launch. A route answer within 5 s, or the app says it is still working.
6. **Respect the device.** Dark style at night, low frame rate when idle, no background work outside a ride.
7. **Accessible.** VoiceOver labels on everything, Dynamic Type up to the largest accessibility size (the riding screen caps its type and says so in the design system), reduce motion respected, contrast at least 4.5:1 for text and 3:1 for map line contrast against the base.

## 3. App structure

```
Launch → Map home (Plan tab)
Tabs (bottom): Plan · Explore · Rides        ← hidden during a ride
Settings: gear button top-right on Plan
Ride: full-screen cover over everything, exit only through "End ride"
Deep links: opengravel://ride/{id}, opengravel://pair/{code}, opengravel://share/{token}
```

- The map is shared across Plan and Explore (one `OGMap` instance) and keeps its camera between tabs.
- Sheets use three detents: **peek** (one line plus primary action), **half**, **full**. The map stays interactive above the sheet.

## 4. Screens

Each screen lists its states. Every state has a snapshot test and the copy shown here.

### 4.1 Plan: composer

- **Rows:**
  - Start ("Current location" default, search, or a dropped pin).
  - Destination, or Loop mode with a ride-time picker of 1 to 6 h in 30 min steps.
  - Optional stops (up to 8), each removable.
- **Ride style:**
  - Roads: Fast · Balanced · Curvy · Backroads.
  - Surface: Paved · Mostly paved · Mixed · Dirt OK.
  - Switches: Avoid highways, Avoid tolls.

  The composer remembers the last choice. On peek it shows a one-line summary ("Curvy · Mostly paved · No highways").
- **Search:** typing shows results within 300 ms of a pause (`/api/geocode`), US-first labels `Name, Town, ST`, current location first. Tapping a result sets the row and frames the map.
- **Map interaction:**
  - Long-press drops a pin and offers "Start here", "Go here" and "Add stop".
  - Pins can be dragged.
  - Pin names come from reverse geocoding.
- **Primary action:** "Find rides". It's disabled until start plus destination, or start plus ride time, are set. A disabled state names what is missing ("Set a destination or switch to Loop").
- **States:** empty, typing, results, no results ("No places match. Try a town name."), location denied ("Location is off. Search for a start or turn on location in Settings."), offline ("No connection. You can still look at saved rides.").

### 4.2 Plan: route choices

- `/api/route-plan` returns up to 3 candidates. They show as lines on the map: the selected one bold, the others thin.
- Each one also gets a card in a horizontally paged row with:
  - name (via road names or "Ride 1/2/3");
  - time and miles;
  - **curvy miles**;
  - **surface mix** bar (paved, gravel, unknown);
  - **backroad share**;
  - one-line weather glance (§4.8);
  - an evidence chip for each fact: measured, inferred or unknown.
- Tapping "Why this ride?" opens the evidence detail in half sheet: named curvy roads, surveyed gravel segments, warnings (closures, seasonal roads) with their source.
- **Primary action on the selected card:** "Ride". Secondary actions: "Save", "Share", "Edit".
- **States:** loading (skeleton cards plus "Finding rides…", which becomes "Still working…" after 5 s), one candidate only, none ("No ride fits. Try a longer time or a different surface."), server error ("Couldn't plan right now. Try again."), partial evidence (chips show "not known").

### 4.3 Explore

- Catalog routes (`/api/catalog`) as a list in the sheet and as lines on the map. Lines are drawn only at zoom ≥ 7; at lower zoom they show as clustered pins.
- **Filters:**
  - distance from me;
  - length (short under 60 mi, medium, long over 150 mi);
  - surface (Paved, Mixed, Dirt OK);
  - loop or one-way.

  Sort is nearest first by default.
- **Detail:** map framed on the route, stats (miles, estimated time, curvy miles, surface mix, source and license attribution), photos if present, "Plan from this" (opens Plan with the route as geometry and its checkpoints), "Save", "Export GPX".
- **States:** loading, empty filter result ("No routes match these filters." plus "Clear filters"), offline (cached list if any, otherwise the offline copy).

### 4.4 Rides (library)

- **Sections:**
  - From laptop (inbox, §4.6);
  - Saved;
  - Recorded.

  Each row has a mini map preview, name, miles and date.
- **Actions:** open (shows the route on the map with "Ride", "Edit", "Share", "Export GPX"), rename, delete (with undo toast for 5 s), import GPX (Files picker; tracks and routes, with waypoints kept as stops when under 9), export GPX (share sheet).
- **Recorded rides:** track line, distance, moving time, elapsed time, max speed, date. Export as GPX track.
- **States:** empty ("No rides yet. Plan one, or import a GPX."), import error per file ("Couldn't read *name*: not a GPX track or route."), duplicate import ("Already in your rides.").

### 4.5 Ride (the riding screen)

Full-screen. The phone may be mounted portrait or landscape; both layouts are first-class.

- **Map:** follows the rider, heading-up by default (north-up toggle), with the camera tilted 45° at speed and flat when stopped. Look-ahead zoom: zoom out before long straights, zoom in 300 m before a turn.
- **Top banner (Ferrostar instruction view, replaced with ours):**
  - maneuver glyph at least 64 pt;
  - distance to the turn (largest type on screen);
  - road name.

  Lane hints appear when present.
- **Bottom strip:** arrival time · miles left · time left. Tapping it toggles the "ride overview" camera for 10 s.
- **Current road name** above the puck.
- **Buttons (60 pt minimum):** End ride (asks "End this ride?" with End/Keep riding), recenter (appears after panning), mute voice, overview.
- **Voice:**
  - spoken prompts with road names at 2 mi (rural only), 0.5 mi, 500 ft and at the turn;
  - ducks other audio and resumes it;
  - routes to the connected Bluetooth headset;
  - mute persists per ride.
- **Off route:**
  - after 50 m off the line for 5 s, show "Off route. Finding a way back…" and request a new route from `/api/route-plan` with the remaining stops;
  - with no signal, show "No signal. Keep going; we'll guide you back to your route.", keep the planned line on the map, and draw a rejoin arrow to the nearest point ahead on the route;
  - never re-plan the whole ride's character silently; a reroute keeps the original ride style.
- **Places along the ride:** gas and food pins within 1 mi of the route (§4.7). Tapping one shows the name, distance ahead and "Add as stop" (reroutes).
- **Arrival:** "You've arrived" with ride stats and "Save recording" or "Discard".
- **Screen and power:**
  - screen stays awake during a ride;
  - if `thermalState ≥ .serious`, drop the map to 30 fps and pause hillshade animation, and tell the rider once ("Phone is hot; the map is saving power.");
  - battery under 15 % shows a single quiet banner.
- **Live Activity and Dynamic Island** (§4.9) start with the ride.
- **States:** acquiring GPS ("Finding you…"), riding, off route (with signal), off route (no signal), rerouting failed ("Couldn't find a way back. Follow the line to rejoin."), arrived, GPS lost (keep the last known position with "GPS signal weak").

### 4.6 Laptop → phone (pairing and inbox)

- **One-time pairing:**
  - on the web planner (Settings → "Connect your phone"), the server issues a pairing code shown as a QR code plus 8 characters, valid for 10 minutes;
  - the phone scans it (Rides → "Connect laptop" or the system camera via `opengravel://pair/{code}`);
  - the server stores a device pair. No accounts and no personal data; each side keeps a random device token.
- **Sending:** the web planner shows "Send to phone" on any planned or saved ride. The ride (geometry, stops, ride style, name) goes into that phone's inbox.
- **Receiving:** the app fetches the inbox on launch, on foreground, and on pull-to-refresh. New items appear under Rides → From laptop with a badge on the Rides tab. Opening one imports it into Saved and acknowledges it, and the server deletes it after 30 days or on acknowledgement.
- **Unpair:** from either side, in Settings.
- **Copy:** "Plan on your laptop, ride on your phone." / "Connected to *Laptop name*." / "This code expired. Make a new one on your laptop."

### 4.7 Places along the ride

- `/api/places/along` for the selected route, categories gas and food only in v1. Icons follow DESIGN-SYSTEM.md.
- In Plan they are shown when the selected route is longer than 40 mi. In Ride they are always shown within 1 mi of the route.
- A place card shows the name, category, miles ahead along the route, the detour time if the server provides it, and "Add as stop".

### 4.8 Weather glance

- One line per route card from `/api/weather` over the ride window: "Dry all ride", "Rain likely after 3 PM", "Below 40 °F early". Tapping it shows an hourly strip for the ride window.
- If the endpoint fails, hide the line. Never show a guessed forecast.

### 4.9 Live Activity and Dynamic Island

- **Lock screen:** maneuver glyph, distance, road name, arrival time.
- **Compact island:** glyph plus distance.
- **Expanded island:** adds road name and arrival.
- Updates on maneuver change and at most every 5 s otherwise. It ends at arrival or End ride.

### 4.10 Settings

- **Units:** miles (default) or km.
- **Voice:** on/off, verbosity (Turns only / Turns + roads).
- **Map:** Auto / Day / Night, Satellite toggle (if a free imagery source is approved; hidden otherwise).
- **Laptop pairing:** status, Unpair.
- **Server:** advanced, hidden behind 5 taps on the version number; default is the production origin.
- **About:** OpenStreetMap attribution and licenses, open-source licenses list, version.
- **Privacy:** "Your rides stay on your phone. Only the route you ask for is sent to OpenGravel's server."

## 5. Map

### 5.1 Basemap

- Our own style, "OpenGravel Day" and "OpenGravel Night", on self-hosted OpenStreetMap vector tiles (PMTiles), with hillshade from free elevation tiles.
- The style must make these readable at a glance:
  - road curviness (via the rider layer, §5.2);
  - paved vs unpaved (unpaved roads drawn dashed or textured, always distinct from paved at every zoom ≥ 9);
  - terrain;
  - water;
  - towns.

  Labels stay quiet so the route line dominates.
- **Attribution:** "© OpenStreetMap contributors" visible on the map at all times. Tapping it opens the full credits.

### 5.2 Rider layers (from `/api/map-layers`)

| Layer | Look | Default |
|---|---|---|
| Curvy roads (rated) | warm color ramp by curvature rating | on in Plan and Explore, off in Ride except on the route |
| Surveyed gravel | distinct texture or dash | on |
| Closures and seasonal roads | hazard pattern with source on tap | on |
| Route line | selected: thick, high-contrast casing; others: thin, 60 % opacity | always |

### 5.3 Camera and performance

- 60 fps target while panning. Idle map renders nothing new.
- Style and tiles are cached by URLCache, 500 MB cap.
- Map launch to first render: under 1 s with a warm cache.

## 6. Data on the phone

- **Saved ride:**
  - id, name, created/updated, geometry (polyline6), stops, ride style;
  - source (planned / catalog / laptop / GPX import);
  - the last route-plan candidate summary.
- **Recording:**
  - id, start/end, a track of fixes (lat, lon, alt, speed, course, time);
  - summary.

  It's saved every 30 s during a ride so a crash loses at most 30 s.
- **Pairing:** device token, laptop name, paired date.
- **Ride session state** for "Resume ride?" after the app is killed mid-ride.

  On relaunch within 2 h, offer "Resume your ride to *destination*?" (Resume / End).
- Nothing leaves the phone except the API calls in ENGINEERING §5.

## 7. Performance and power budgets

| Measure | Budget |
|---|---|
| Cold launch to interactive map | ≤ 2.0 s on iPhone 13 or newer |
| Route plan request to first card | ≤ 5 s at p90 (server permitting); loading state always shown |
| Riding battery use | ≤ 12 % per hour at 70 % brightness, screen on, GPS on (measured on the owner's iPhone) |
| Memory during a 2 h replay | no growth over 50 MB after the first 10 minutes |
| Crash-free rides | 100 % across Phase 4 real rides |

## 8. Accessibility checklist (every screen card)

- VoiceOver: every control has a label and hint, and map pins are reachable as elements.
- Dynamic Type: layouts reflow to `.accessibility5` without truncating actions.
- Reduce motion: no camera fly animations, only cuts or fades.
- Color is never the only signal: surface uses pattern as well as color, and evidence chips carry text.
- `XCUIApplication().performAccessibilityAudit()` passes for the screen.

## 9. Out of scope for v1

- Group rides.
- Fuel briefing.
- Accounts and sync beyond laptop pairing.
- Android.
- Offline map downloads, CarPlay and Apple Watch (these are v1.1).
- In-app purchases.
- Social feeds.

## 10. Voice and copy

- Short and plain. Second person. No exclamation marks. No jargon ("route candidate", "provider", "evidence object").
- Numbers: "2.4 mi", "1 h 20 min", "3:45 PM".
- Unknowns: "Surface not known", never "Surface: unknown" in capitals and never left blank.
- Errors say what happened and what to do next, in one sentence each.
