# Claude implementation guide: structure, sequencing and safeguards

> This is **guidance for future implementation PRs**, not authorization to code changes in this documentation PR. Use current main/active branches and real rendered evidence before changing anything.

## 0. Reconcile with the real branch topology

`main@8fb189f` (2026-10-28) already contains #162 (Google-style planner sheet), #163 (search/ride polish), #169–#191 (map, hike, routing features). Open [PR #165](https://github.com/OneBigHen/OpenGravel/pull/165) contains **visual concepts and an older plan**, and [PR #98](https://github.com/OneBigHen/OpenGravel/pull/98) contains an autonomous testing brief. They are complementary, not a reason to rebuild. Compare PR file changes with current main first; pull **conceptual** guidance without introducing stale CSS/markup.

`DESIGN.md` is owner-locked. Its **latest decision log** specifies a docked phone tab bar, route contextual sheet and explicit Hike/Ride context. When new blueprints disagree with a locked rule, write a proposed decision and seek owner approval. Never silently rewrite design authority.

Before work:
```bash
git fetch origin
git status --short
git worktree add ../og-ux-phase-a -b ux/phase-a-surface-state origin/main
cd ../og-ux-phase-a
# inspect open PRs, current files, affected tests before editing
```
Names are examples: do not overwrite existing branch/worktree. Start later phases on freshly updated main or on explicitly stacked, reviewed bases.

## 1. Component ownership map

| Concern | Existing source | Claude should do | Claude must not do |
|---|---|---|---|
| Primary browsing | `src/ui/nav/PrimaryNav.tsx`, `AppMenu.tsx`, `AppBar.tsx`, `nav.css` | Keep tabs/menu consistent by activity and screen; fix actual focus/inset issues | Add fourth mobile tab, duplicate Settings, create new nav state |
| Planner shell, map layout | `src/ui/planner/PlannerWorkspaceFrame.tsx`, `PlannerWorkspace.tsx` | Coordinate header, map, sheet, tools and cross-state transitions | Make core routing decisions in layout components |
| Phone sheet / desktop rail | `PlannerWorkspaceDock.tsx`, `src/ui/sheet/Sheet.tsx`, `sheet.css`, `gmaps-layout.css` | Normalize detent geometry, body scroll and gesture ownership; verify data-trip behavior | Create another sheet implementation; rewrite drag handlers without regression tests |
| Result/preview/comparison | `PhoneRideSummary.tsx`, `PlannerResultPanel.tsx`, `RouteOptions.tsx`, `RouteDecisionCard.tsx`, `PlannerOptionRows.tsx` | Consolidate hierarchy and selection semantics; one primary Start in compact state | Copy route candidate data into independent component-local state |
| Intent and expert editing | `IntentComposer.tsx`, `RideStyleControls.tsx`, `PlannerRefineWorkspace.tsx`, `MapEditBar.tsx`, `PointActionSheet.tsx` | Progressive disclosure; preserve stop/avoid/sketch editor and map gestures | Delete expert control paths or conflate layers with routing preferences |
| Place search / Ask | `src/ui/place/TopSearch.tsx`, `src/ui/planner/RideAdvisor.tsx` | Make place search and natural-language route intent clearly distinguishable | Pretend Ask is geocoder or that AI can establish legal route access |
| Map | `src/ui/map/PlannerMap.tsx`, `MapControls.tsx`, `map.css`, `src/ui/layers/*` | Instrument stack, active tool indications, camera-fit insets and overlays | Disturb map interaction contract, attribution or renderer ownership |
| Ride discovery | `src/app/ExploreClient.tsx`, `src/ui/explore/ExplorePanel.tsx`, `ExploreMap.tsx`, `RouteDetail.tsx` | Make list/map one selection, compact cards, preserve filters/Back | Replace catalog geometry with thumbnail geometry or lose source attribution |
| Hike discovery | `src/app/HikeExplore.tsx`, `src/ui/explore/HikeExplore*` or current hike styles | Converge **presentation**, keep real trail semantics | Present rider metrics, ungrounded grade or fake motorcycle candidates |
| Ride / Hike session | `src/ui/ride/RideFocus.tsx`, `RideMetricStrip.tsx`, `ride.css`, `src/app/RideClient.tsx` | Improve legibility/ergonomics, preserve session control and safety | New navigation lifecycle, one-tap End, forced return to route start |
| Saved library | `src/ui/rides/RidesLibrary.tsx`, `rides.css` | Compact saved/recorded list and origin labels | New untested persistence format, duplicate delete workflows |
| Settings | `src/ui/settings/SettingsSurface.tsx`, `OfflineMapsSection.tsx`, `settings.css` | Improve hierarchy, distinguish capability states | Remove data consent, typed DELETE, offline limits or export |
| Theme | `DESIGN.md`, `src/app/tokens.css`, `src/app/controls.css` | Semantic token consistency and real night map | Literal scattered colors/blur; third theme |

Check actual imports and renamed paths on current main; this table is a **starting map**, not authority to change filenames blindly.

## 2. Build a single presentation contract, not a replacement backend

The implementation should be driven by the **existing planner UI store and derived route state**, not a new persistence model. Consider documenting a derived display shape along these lines:

```ts
type PresentationMode =
  | "idle-map"
  | "search-results"
  | "place-detail"
  | "planning"
  | "route-preview"
  | "route-compare"
  | "route-edit"
  | "route-options"
  | "active-session";
```

This is an **illustrative vocabulary**, not a demand to persist a second store or change domain enums. Some views (especially active session) belong to distinct pages. Derive and render each screen from its actual model; retain existing store and document semantics.

For each mode record:

1. Top surface owner: search / From-To / maneuver, **exactly one**.
2. Main map role: idle, result-selection, point-placement, route-fit, live-follow.
3. Bottom surface owner: tabs+quick-actions, sheet, active instruments, or none.
4. Visible primary CTA, secondary actions and their status.
5. Hardware Back / browser Back / Escape / sheet close behavior.
6. Data preserved (ride revision, candidate id, geometry, filters, scroll, current GPS/session).
7. Keyboard, focus, VoiceOver and touch rules.

Avoid hidden-by-CSS duplicate DOM controls whenever they create focus/accessibility conflicts. `PlannerResultPanel` already uses responsive portal semantics; test its mounting and focus before moving it.

## 3. Consolidate CSS carefully

Candidate cleanup areas:

- `src/ui/planner/gmaps-layout.css`: phone trip mode, initial idle sheet, top From/To card, route summary and end-of-file home “one dock” overrides. Confirm actual cascade specificity before removing a selector; some sections represent **later owner decisions**, not accidental duplication.
- `src/ui/nav/nav.css`: measured tab-bar height and the responsive split/short-landscape behavior. Preserve the active indicator and `AppMenu` visibility.
- `src/ui/sheet/sheet.css`, `src/ui/planner/planner-shell.css`, `src/ui/planner/plan-sheet.css`: competing dimensions / scroll boundaries.
- `src/ui/planner/route-results.css`, `src/ui/planner/ride-style.css`: selected route hierarchy and collapsed/expanded variants.
- `src/ui/explore/explore.css`, `src/ui/explore/hike-explore.css`: route list, map, thumbnails, filters and cross-activity styling.

Work rule: first add failing **behavior or screenshot** test, then remove/merge a CSS rule, then verify at small phone, Pro Max, tablet and desktop with light/dark map. A shorter CSS file is not proof of higher quality.

## 4. Cross-boundary invariants that UI refactors must preserve

- **Routing:** GraphHopper remains the motorcycle route authority; Hike uses its dedicated foot router, with **no motorcycle fallback**. Unknown surface, closure, access and weather remain unknown when data absent.
- **Candidate selection:** chosen preview line, route summary, Start, Save, Share, GPX and active route agree on the **same** selected candidate revision. Compare options are measured alternatives, not invented labels.
- **Provenance:** imported GPX, community and catalog sources retain original geometries. Updating/replanning is explicit and has last-good recovery. Catalog preview geometry is not necessarily complete export geometry.
- **Drafts:** Back, route-detail, tab transitions, keyboard, orientation, reload, another browser tab, and failed update must not silently erase the draft or replace source geometry.
- **Offline:** cached basemap ≠ complete route engine ≠ downloaded trail tiles ≠ offline weather/traffic/Ask. Model capability and provider failure independently.
- **Navigation:** one RideSession across web/native/CarPlay as currently designed; refresh/GPS loss/resume/off-route recovery must not restart at the original point.
- **Safety:** two-step End, recording status, glove controls, voice/pause and recovery retained. A visually pretty active-ride mockup that drops one of these fails review.
- **Hiking:** Activity mode must drive labels, controls, provider scope, metrics and stops. Do not use motorcycle-specific time estimates or road “twistiness” to describe a footpath.

## 5. Suggested implementation PR sequence

### Phase 0 — Evidence baseline (no product changes)

- Fresh code review and branch reconciliation (#165, #98, latest handoff).
- Capture screenshots with `scripts/og-shots` and manually reproduce the first-time user flow.
- Create an issue matrix: actual, desired, affected files, test, screenshot, risk.
- Establish temporary deterministic fixtures for route preview *and* a separate real tile/provider check.
- Record existing failures rather than “fixing” tests by weakening assertions.

### Phase 1 — State ownership / home / preview (highest UX return)

- Prove exactly one bottom surface in idle/search/preview/compare/edit.
- Make search and a basic ride-intent path the first action; advanced controls expand only on request.
- Keep From/To, selected route, preview Start, comparison and edit state coordinated.
- Unify map insets and safe area across keyboard/rotation and sheet detents.
- Tests: `compact-sheet.spec.ts`, `mobile-planner-ux.spec.ts`, `first-route.spec.ts`, `ride-style.spec.ts`, `map-gestures.spec.ts`.

### Phase 2 — Explore + Hike correctness

- Reduce route-card density and make map/list synchronized.
- Preserve filters, scroll and route-detail Back context.
- Eliminate **documented** Hike phone map obstruction; make `hike-planning.spec.ts` no longer fixme only after it passes.
- Fix Hike inspector rider leakage, make activity adapter consistent without changing trail routing.
- Tests: `explore.spec.ts`, `explore-browser.spec.ts`, `explore-catalog.spec.ts`, `hike-planning.spec.ts`, `hike-drawing.spec.ts`, relevant unit tests.

### Phase 3 — Rider experience / settings / data polish

- Polish active-ride controls and full night basemap; do not strip functionality.
- Improve populated My rides, import, offline readiness and grouped Settings.
- Preserve cross-browser local data messages, existing delete confirm and export.
- Tests: `ride-focus.spec.ts`, `free-ride.spec.ts`, `record.spec.ts`, `offline*.spec.ts`, `settings.spec.ts`.

### Phase 4 — CSS simplification and comprehensive QA

- Remove truly obsolete selectors/components only after tests and snapshots demonstrate behavior parity.
- Audit both themes and all modes; run critical suite and camera-inset tests.
- Include before/after gallery and concise UX rationale in each implementation PR.
- Keep a measured list of remaining physical-device/provider checks and QA debt.

## 6. Verification procedure

```bash
npm ci
npm run audit:env
npm run lint
npm run typecheck
npm test
npm run test:architecture
npm run build
npm run test:e2e:critical
# inspect scripts/og-shots/README.md for actual prerequisites/options:
npm run shots -- --devices iphone17promax,iphone17,ipad11,desktop,chromium-320 --map real --themes light,dark
```

Do not run heavy build/screenshot jobs simultaneously on constrained machines. If exact script options on current main differ, use current README. Do not mark a simulation “real GPS tested” or an offline basemap “fully offline navigation tested.” Use a **real browser screenshot** to certify clipping and a real map provider when making style/attribution claims.

Known environment-dependent critical flakes were noted in the Oct 28 handoff; re-run and attribute pre-existing failures. Do not silently skip a failing critical regression. Do not delete a `test.fixme` until its original assertion passes.

## 7. What to send the owner after each implementation phase

- **Before / after** same viewport, same theme, same app state.
- “This was visually confusing because …; now the primary path is …” in plain English.
- Exact changed files and which **existing** components were reused.
- Tests and screenshots that passed (and environment constraints / failures).
- A 60-second task journey for Map → Preview → Start/Back and for Explore → Route detail → Back.
- Explicit known remaining defects and next phase.
- Link to a focused, reviewable **implementation PR**. No deployment or merge unless newly authorized for that phase.

The owner asked for feedback to Claude, **not for this documentation PR to be implemented by its author**. Stop this branch at guidance.
