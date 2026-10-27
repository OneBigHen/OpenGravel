# Mobile map UX: proposed interaction and visual specification

**Status:** proposal for implementation, 2026-10-27. Source reviewed at
`37254edcbc3ee5795c5ed3c85c05e8859d937715`. This document is not a new
authoritative design lock. The owner asked for a cleaner bottom bar and a
complete visual/implementation handoff; record owner direction before
superseding conflicting rules in `DESIGN.md`.

## 1. Product objective

Help a motorcyclist get from an open map to a good ride with the smallest
reasonable amount of visual and interaction overhead. Emulate the clarity of
general navigation, the depth of outdoor mapping, and the specificity of
motorcycle planning while retaining OpenGravel's identity and architecture.

Principles:

1. The map is the primary workspace, not decorative background.
2. One dominant bottom surface per task; never stack competing floating bars.
3. Make the most likely next action obvious. Reveal advanced detail when useful.
4. Keep originals, drafts, provenance, and unknown values honest.
5. Riding controls stay glanceable, reachable and stable, with no claim of
   proven safety until real riders and physical devices are tested.
6. Preserve local-first use, offline distinctions and core functionality.

## 2. Evidence from the current repository

This is a code review, not a new running-app or device test:

- `src/ui/nav/PrimaryNav.tsx` renders Plan, Explore and My rides plus a
  separate Settings link. It measures the bottom bar and publishes
  `--og-tabbar-measured-h`; `src/ui/nav/nav.css` currently lays out four phone
  items and a docked bar. `AppBar.tsx` shares navigation on non-planner pages.
- `PlannerWorkspaceFrame.tsx` renders `PrimaryNav` and uses `data-trip` when
  the compact trip card is active. `src/ui/planner/gmaps-layout.css` already
  hides that navigation in the **phone trip state**, zeroes `--og-tabbar-h`,
  and extends the sheet to the edge. Do not implement the behavior a second
  time or assume every compact/tablet state does exactly the same thing.
- `DESIGN.md` says the tab bar and Plan sheet float with map between them,
  while `nav.css` / `gmaps-layout.css` and `compact-sheet.spec.ts` describe
  or assert docked/flush behavior. Treat this as a documentation/code
  discrepancy to resolve deliberately, not proof of a specific production
  defect. `DESIGN.md` wins over older design documents when rules conflict.
- `src/ui/sheet/Sheet.tsx` is an existing shared non-modal sheet with drag,
  click and keyboard handling. `PlannerWorkspaceDock.tsx` adapts its detents
  to the existing presentation store's `mini`, `peek`, `ride`, `half`, and
  `expanded` states. Preserve these semantics unless migration is tested;
  do not build a second independent sheet or duplicate persistent ride state.
- `PhoneRideSummary.tsx`, `PlannerResultPanel.tsx`, `RouteDecisionCard.tsx`
  and `RouteOptions.tsx` already own significant route-summary and option
  behavior. Inspect their current composition before restructuring.
- `RideFocus.tsx` / `RideMetricStrip.tsx` already render a compact strip,
  a controls sheet and a two-step end action. The ride surface also exposes
  useful zoom and compass controls for gloves, off-route recovery, voice,
  recording status, pause, and other operations. Preserve these even when a
  concept image leaves them out for clarity.
- `ExplorePanel.tsx` composes `ExploreMap`, route rows and filters;
  `RouteDetail.tsx` provides route evidence and actions. Reuse their data,
  source attribution and navigation behavior.
- The previous desktop browser review could not render a live map, so it did
  not establish a map outage or verify this phone layout. The repo's current
  code and tests are a better starting point, but still need a live visual run.

## 3. Proposed navigation and state contract

| User context | Primary bottom surface | Exit and continuity |
| --- | --- | --- |
| Idle map | Compact Map / Explore / My rides navigation; a small relevant home action area if needed | Settings is reachable through a named top-level menu; loop, Free Ride and Record remain discoverable. |
| Search or selected place | One search/results or place sheet | Back closes the transient view and restores the previous map and navigation. |
| Route planning, preview or compare on a phone | A single contextual route sheet, no separate global tab bar beneath it | Back returns to the map or previous step. Preserve a resumable draft; never clear or recalculate silently. |
| Ride Focus | The existing compact ride instrument strip and controls sheet | No browse tabs over the ride; keep existing two-step End and pause/resume behavior. |
| Explore / My rides / Settings | Navigation appropriate to the page and breakpoint | Navigation, Settings and Back remain discoverable and keyboard/screen-reader accessible. |

**Three-item navigation is proposed**, not a claim about current code. Replacing
Plan with Map must not make route planning ambiguous; moving Settings out of the
bar requires an accessible Settings entry on *every* surface. If a user leaves
an active draft, show an honest resume affordance and follow existing persistence
rules; do not create a second source of truth.

The proposal refines the current phone trip behavior rather than introducing it
from scratch. Tablet landscape and desktop need their own layout rules; do not
hide essential navigation simply because the phone sheet is contextual.

## 4. Screen behavior

### Map home

- Give `Where to?` the strongest non-map hierarchy. A search result opens its
  place view; only an explicit Directions/Add stop/etc. command edits the ride.
- Provide quick entry to loop planning and Explore; keep Free Ride and Record
  reachable by a named action or menu without making the default map busy.
- Prefer Layers and Locate as the two default floating map controls. A compass
  appears when needed; phone zoom may use gestures **when not riding**. Keep
  glove-appropriate ride zoom and compass from the existing Ride Focus.
- No invented 'current location': support denied, unavailable and delayed GPS.

### Route preview and comparison

- The collapsed sheet presents ride title/destination, time, distance, a
  truthful short surface/road character line, a compare affordance if multiple
  real candidates exist, and the primary Start action.
- Expand to see stops, preferences, route evidence, preparation and editing.
  Avoid nested glass cards and redundant summary strips. Do not hide an active
  error, cancel button, navigation refusal or edit-tool state.
- Compare rows show only available candidates, their measured characteristics,
  time/distance and relevant tradeoff. Selection updates the map and the map
  selection updates the same candidate. Use checks/patterns in addition to color.
- The existing sheet supports click/keyboard/pointer interaction. Preserve focus
  restoration and a reachable alternative to swipe; avoid sheet/body/map gesture
  conflicts. The full detent may occupy the viewport; the map visibility target
  applies to relevant preview states, not a fully expanded editor or keyboard.
- Avoid duplicate search, summary, navigation and map controls.

### Explore and route detail

- Let search and compact filters narrow real catalog data. Map/list selection
  stays in sync and the chosen route, source and useful metrics remain clear.
- Keep credit, source, condition freshness, map attribution, GPS-denied and
  missing-data states. `Near me` must be explicit about the needed location.
- Use existing route detail to preserve comments, conditions, GPX, sharing and
  the original-route story. A new map/list presentation must not erase them.
- Images are concepts, not actual community route geometry or surface facts.

### Riding

- Preserve the existing guidance lifecycle and `RideFocus` view model; no
  replacement ride session. Stable, glanceable maneuver + map + strip.
- Keep two-step End inside controls, explicit pause/resume, voice, recording,
  off-route recovery, camera/zoom/compass and error feedback. The generated
  image's omissions do not authorize removing them.
- Support night with a dark basemap, not just dark panels. Meet current
  contrast targets against the actual map and glass combinations.

### iPad and desktop

- Use the code's existing phone `< 761px`, tablet `761–1180px`, desktop
  `≥ 1181px` and short landscape query unless the owner approves changes.
  `useCompactPlanner` also excludes certain short landscape screens; check it.
- iPad landscape favors a compact left rail with map visible. Desktop preserves
  its working navigation and planning rail; no phone-bottom-sheet clone.
- Keep route selection, keyboard navigation, safe areas and attribution intact
  when changing orientation or resizing.

## 5. Visual system and responsive constraints

- Start with `src/app/tokens.css`: Plus Jakarta Sans and Outfit, current day /
  night tokens, `--og-glass` and `--og-glass-dense`. Refine token use rather
  than appending a new incompatible palette or repeated override layers.
- Dense glass for readable sheets; solid fallback for unsupported blur or
  reduced-transparency preference. No nested blur, decorative glow, gradient
  buttons or permanent texture over the map.
- Honor current 4/8/12/16/24/32 spacing scale and existing accessible typography;
  controls are at least 48 × 48 CSS px, riding controls 56 × 56, with breathing
  room. Input text is at least 16px on iOS to avoid unwanted viewport zoom.
- Support `env(safe-area-inset-*)`, dynamic viewport and virtual keyboard without
  double-counting the measured tab-bar height. Preserve map camera padding,
  route framing and attribution as overlays change.
- Every icon-only control has a stable name, keyboard focus and visible state;
  respect reduced motion and test large type/200% zoom. Target WCAG 2.2 AA
  where applicable; real testing is needed before asserting compliance.

## 6. Route trust investigation

During a 2026-10-27 live desktop review, the Loyalsock State Forest Loop detail
showed 96 mi, ~3 h 30 min and 24 mi unpaved; after `Ride this`, the planner
showed 92 mi, 4 h 33 min and 57 mi gravel. The map did not render in that remote
browser. The underlying cause and whether geometry changed are **unknown**.

Reproduce against the current code and data before making a claim: compare source
geometry, route/document provenance, matching, duration models, surface data,
units and cached catalog metadata. `RouteDetail.tsx` uses `entry.distanceKm`,
`entry.estimatedTimeMinutes`, `entry.surfaceSummary` / `roadSummary` and
`entry.geometry`; the planner derives its displayed choices from its own
view model. The existence of these different inputs alone does not establish
the cause. Fix any actual issue, otherwise explicitly explain legitimate
differences; preserve original track and unknown classifications.

## 7. Acceptance evidence

At minimum capture before/after views for idle map, selected place, route
preview, compare, expanded sheet, Explore, Ride Focus, GPS/error, and offline
states. Check 320 × 568, 375 × 667, 390 × 844 and the owner's 440px device,
day and night; iPad/desktop and short landscape. `scripts/og-shots/README.md`
documents the actual capture tool and its environment requirements.

Preserve the tests for map gestures, sheet detents, route selection, ride
start/end/recovery, recording, GPX, offline and location-denied cases. When a
purposeful visual contract changes, update its assertion deliberately with a
replacement that validates the new behavior; do not simply delete it.
Automated fixture screenshots are not real-provider, GPS, physical-device,
sunlight, or hands-in-gloves acceptance. Report each separately.
