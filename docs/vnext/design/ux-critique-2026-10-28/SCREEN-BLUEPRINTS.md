# Screen blueprints: composition, coordinates and interaction

These are **proposed layout targets**, not screenshots or assertions of current pixel geometry. CSS pixel coordinates below refer to a 440 × 956 logical viewport with dynamic `safe-area-inset-*`; never hard-code them as fixed absolute offsets. `DESIGN.md` owns final style tokens and breakpoints. This handoff specifies **information order, visual hierarchy and measurable constraints**.

## Global geometry and visual system

- Breakpoints: **phone <761px**, **tablet 761–1180px**, **desktop ≥1181px**. Add tested compact short-landscape rule (`max-height:500px`), not a separate arbitrary device taxonomy.
- Phone horizontal safe gutters: **16 CSS px** on regular devices, **12px** minimum at width 320. Top search has at least `safe-area-inset-top + 12px` offset.
- Primary tab bar: **dock to bottom**, 3 items (Map/Explore/My rides); target **68–72px** visible height plus safe-area bottom. This is an estimate; `PrimaryNav` already measures actual height. Use measured geometry for the map and sheet.
- Idle overlay hit targets: **48×48px minimum**; active riding: **56×56px minimum**, preserve existing controls. Icon glyphs can be smaller than hit targets.
- Spacing: **4/8/12/16/24/32**; dense text readability and real 200% scaling take priority over maintaining a rigid screen. Follow `tokens.css` for color, radii, glass and typography.
- **One surface owner** in the lower viewport per context. The idle home actions and dock may share an intended visual grouping; a route-preview sheet must **replace**, not stack above, the tab bar.
- Sheet detents: use existing `peek/half/full` and planner `mini/peek/ride/half/expanded` mapping. Do **not** create a second independent detent store.
- Maintain MapLibre attribution, iOS home indicator, keyboard focus and centerline fit inside the **unobscured map polygon**, not merely the full canvas bounds.
- Prefer fluid constraints (`max-width`, `min-height`, measured DOM rectangles) over fixed CSS pixel heights.

## A. Mobile idle Map: 440 × 956

Target priorities: **Where to? → Plan loop / Free Ride / Record → Explore**. Map itself remains useful and tappable.

| Region | Target logical geometry | Presentation |
|---|---|---|
| Search | `x=16`, `y=safeTop+12`, `w=408`, `h≈52` | One dense-glass field “Where to?”; named Menu button at right, inside same visual band |
| Quick chips | `x=16`, `y=search.bottom+8`, one horizontal row `h=36–40` | 2–4 immediately useful items (e.g., Gas, Coffee, Layers/Ask if warranted); horizontally scroll; distinguish searching places from toggling overlays |
| Map tools | `right=16`, one vertical instrument stack; `48×48`, `gap=8` | Prioritize Locate and Layers. Secondary zoom/compass/3D can live in Layers or appear contextually; preserve accessibility and desktop convention |
| Idle actions | Immediately above nav, approx `80–96` high including breathing room | Plan loop primary; Free Ride and Record secondary; never leave disabled actions without a reason |
| Nav | `left=0`, `right=0`, `bottom=0`, target `68–72 + safeBottom` | Map / Explore / My rides, no fourth tab; active selection indicator and accessible label |
| Map | Fills behind controls | No giant hero card, no lengthy “nothing planned” copy, no nested glass cards; touch gestures work outside actual buttons |

### Proposed wireframe (conceptual only)

```text
┌───────────────────────────────────────┐
│ [ Search where to?          ] [Menu]  │
│ [Gas] [Coffee] [Ask] [Layers] →       │
│                                       │
│           LIVE MAP CANVAS             │
│                             [Layers]  │
│                             [Locate]  │
│                                       │
│                                       │
│ [ Plan loop ] [ Free Ride ] [ Record ]│
├───────────────────────────────────────┤
│      Map        Explore     My rides  │
└───────────────────────────────────────┘
```

Map tools should not be duplicated by chips (e.g., two visible Layers entry points) unless deliberate A/B evidence shows a benefit. The wireframe shows possible alternatives, **not an instruction to display both simultaneously**.

**Transitions:**
- Tap “Where to?” → search surface with focus and results; map remains useful.
- Tap point → contextual actions, choose destination/start/add stop subject to current intent.
- Tap Plan loop → short loop composer with duration/style and explicit Make my loop.
- Free Ride → existing ride/recording lifecycle as implemented.
- Record → existing recording entry; explain preconditions if unavailable.
- Back from search → original map viewport and draft preserved.

## B. Search and selected place

- Search should not masquerade as a generic command textbox if it only geocodes places. Clearly separate **Ask** (advisor) from place search; don’t silently mix intents.
- Results: one list of place name, locality/road and known distance. Avoid repeated distance, unrelated provider metadata, or “open now” if unavailable.
- Selecting a place opens **one** place sheet with clear actions: Directions, Add stop (when route exists), Save/Share where supported.
- Input focus must not hide first result behind soft keyboard; Esc/Back/close restores focus to search activator.
- A map long-press must not trigger the native browser context menu or accidentally dismiss the sheet. Preserve map gesture rules.

## C. Mobile route preview: tab bar replaced by contextual sheet

Proposed *peek* sheet height **~210–250px**, adaptive to content, large text and viewport. The complete preview should have a **full-width Start ride** CTA and actual route data; if Start is unavailable, explain why in the visible context.

```text
┌───────────────────────────────────────┐
│ [From   →  To / Loop]            [×]  │
│                                       │
│           ROUTE FITS MAP              │
│        chosen line = plum             │
│       alternative lines = gray        │
│                                       │
│ ─────────  drag handle  ───────────── │
│  To Hawk Mountain           [Options] │
│  1 h 42 m         63 mi              │
│  Curvy · Mostly paved · 2,100 ft ↑    │
│  [ Compare routes ] [ Save ]          │
│  [          Start ride          ]     │
└───────────────────────────────────────┘
```

- Only show facts supported by current route candidate. If surface or elevation unknown, omit or state “unknown”; never fill from stylistic defaults.
- Header and actions are visible without scrolling at typical target. The expanded sheet holds detailed options, waypoints, avoid areas, sketch, elevation/grade, stops, weather and provenance.
- `Back` in options → preview; `Back` from preview → previous map/search context while preserving resumable draft; `Clear` requires its own explicit action.
- Don't render two independent Start actions on a phone. Desktop inspector behavior may differ, but **only one dominant CTA per region**.
- In comparison, rows show **real** fastest / curviest / alternatives when supplied, time and distance delta, factual tradeoff; pressing list row or map line updates same selected candidate.
- A changed preference triggers explicit recalculation/review; maintain last-good route during failure. The active preview must not vanish during loading.
- Route “Ride this” from catalog must retain original geometry unless user opts to modify; track provenance must remain visible in details.

## D. Editor and detailed options

- Use existing shared sheet with named modes: **Preview, Compare, Edit, Options**. These are view states, **not four persistent route documents**.
- One consolidated “Ride options” view can group Road character, Surface, Familiarity, Traffic/Avoidance, Bike and Departure. Use current `PlannerOptionRows` and `RideStyleControls` before writing replacements.
- Edit opens a dedicated waypoint/route editor, then returns to Preview with updated candidate status.
- Avoid a full-screen control wall while the rider needs to place a point on the map: temporarily minimize sheet, show currently armed tool + Cancel, and keep route fit relevant.
- No hidden/disabled controls without reason; no fake comparison when only one candidate exists.
- The fully expanded sheet can cover the map by explicit user action; the *default planning/preview state* should respect the map visibility policy in `DESIGN.md`.

## E. Explore: discover a route, see it on the map, take action

### Phone
- Search and ≤1 visible quick filter row above list/map.
- An explicit **Map/List** presentation mechanism, or a sheet with clear map/list detents. Do not display a cramped permanently split pane.
- Compact **≈96px** route rows: left 80–96px square thumbnail, center/right title and two clear data lines.
- Suggested visible order: **route name → distance • estimated duration → meaningful surface/curvy fact**. Provenance muted below. Do not cram every measured curve/dirt value in the same line.
- Selecting a card highlights the precise route preview line and fits it with safe insets; choosing the line should select its card when supported.
- Filter/sort/search query, list position and selected route context survive viewing a detail and Back.
- Filter unavailable state explains whether surface/curvature evidence is missing, rather than simply disabled gray.

### Desktop
- Search/filters/list rail target **360–420px**, map takes remaining width. Do not use a forced 50/50 split on narrow desktop that cripples both.
- Selected route has distinct map emphasis and detail/CTA; avoid launching a second full-page journey just to discover route basics.
- Road discovery and Things/Places must not crowd the Ride list indiscriminately. Scope via clear task-specific lenses.

### Hike variation
- **Hike mode isn't a themed motorcycle tab.** Replace “ride” vocabulary with trail/hike distance, grade, elevation, trail eligibility and relevant preparation.
- Refactor shared discovery presentation via an activity adapter **only if** behavior tests demonstrate parity; do not shove both datasets through motorcycle-specific shape assumptions.
- Current known issue: mobile Hike card blocks top-of-map touch targets. Target a **small collapsible status/action row** under search or outside the gesture-critical map area; expand into sheet when editing.
- Current known issue: desktop Hike inspector includes motorcycle language/actions. Replace with hike-specific Plan on trails / Start hike / Trail metrics and actual destination semantics.

## F. Active Ride / active Hike

- Preserve maneuver at top, full useful map, compact metrics strip at bottom, right-side 56px instrument controls, visible recording status and existing two-step End.
- The “Controls” sheet should contain logical groups (Pause/Resume, recording, route management, maps/voice/safety) rather than an undifferentiated wall.
- Night **basemap** and chrome change together; preserve selected-line contrast and readable numbers on black backgrounds.
- Active navigation receives no browsing tab bar. Only active-session controls are foregrounded.
- Lost GPS/network → show precise last fix and recovery affordances; never silently end the session or assume rejoin from original start.
- For hiking: breadcrumb and trail router state must be independent from motorcycle GraphHopper and route-scoring semantics.

## G. My rides and Settings

**My rides**: reinforce three tasks: Resume saved, View recorded, Import GPX. Display actual storage model: rides stored on this device, with export/backup guidance; do not misleadingly imply sharing is cross-device sync. On populated library, display compact thumbnails, type/status, date, distance and one primary action. Preserve delete confirmation and undo.

**Settings**: group Appearance/Map, Ride or Hike preferences, Bikes/gear, Offline maps, Integrations, Privacy/data and Advanced. Retain Spotify, telemetry consent, export/delete and local data warnings. Mark downloadable regions, installed tiles, offline route service, and provider-dependent functions as **separate** readiness states. Don't promise a full offline ride based on saved tiles alone.

## H. Tablet and desktop, not a stretched phone

**Tablet 1194×834 landscape:** map-first. Compact planning rail **360–440px** on the left (max 560 if needed per current design), no full-width phone-style bottom sheet covering critical map area. Provide a single obvious nav system. Avoid duplicating search or entire toolbar. Respect keyboard and iPad split-screen responsive widths.

**Desktop ≥1181px:** 400px planning rail + flexible map. When a route exists, an inspector **~300–340px** may appear only if remaining map width stays usefully wide; otherwise collapse results into planning rail/sheet. The current inspector portal should remain a single source of data, not a second route store.

At **320×640**, favor short labels, fewer visible chips, scrollable detail and unoccluded primary action. In compact landscape (`height≤500`) consider a top toolbar and contextual side panel instead of a 70%-height bottom sheet.

## Copy and microinteraction guidelines

- Use verbs tied to rider intention: **Plan loop, Get directions, Compare routes, Edit route, Start ride, Save route, Import GPX, Download offline area**.
- Avoid “Change this ride” as a generic entry if the immediate task is really Options or Edit; use a specific label.
- “Map”, “Explore”, “My rides” remain primary navigation on phone. “Menu” should be named, not a mystery icon.
- Disabled state copy should say **why**; async buttons show progress and a safe Cancel/Retry where supported.
- Avoid “safe”, “legal”, “open now”, “paved”, “offline ready” unless a current source supports the exact claim.
- Accessibility: focus restores after closing menus/sheets; user can reach alternatives without swiping, 200% text and screen readers announce selection independently of color.

## Measured pass/fail, not eye-test alone

- No overlapped controls in screenshots at 320×640, 390×844, 440×956, 1194×834 and 1440×900.
- No unintended horizontal scroll or invisible touch target; map attribution is visible.
- A route's complete geometry fits in the **visible portion** of the map after sheet and header reservations.
- At default phone preview, 60% map visibility target while planning **unless current approved spec explicitly permits exception**; active ride ≥80% useful map. Expanded sheet is opt-in.
- First-time rider can create a route via search or map with zero mandatory advanced-options interactions.
- Every destructive state is two-step/confirmed; every non-destructive Back preserves draft and context.
