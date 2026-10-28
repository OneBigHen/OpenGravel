# Mobile Map UX Implementation Plan

> **For agentic workers:** Use superpowers:executing-plans to implement this
> plan task by task. Delegate only if the owner explicitly authorizes it.
> Steps use checkbox syntax for progress tracking.

**Goal:** Make OpenGravel's map, navigation, route sheet, discovery and riding
surfaces feel like one clean, responsive product without losing existing work.

**Architecture:** Reuse the existing `PrimaryNav`, shared `Sheet`, planner
presentation store, route view models and `RideFocus` session. Coordinate
visible surfaces and their geometry at composition boundaries; leave ride
documents, map-intent commands and provider truth in their existing layers.

**Tech Stack:** Next.js, React, TypeScript, MapLibre, Zustand, CSS tokens,
Vitest, Playwright, `scripts/og-shots`.

**Spec:** `docs/vnext/design/mobile-ux-handoff/SPEC.md`; visual references and
limitations: `docs/vnext/design/mobile-ux-handoff/README.md`.

## Global constraints

- Begin from current `origin/main`; inspect overlapping branches/PRs and the
  owner's checkout before changing anything.
- `DESIGN.md` is locked. The handoff is a proposal. Record owner direction for
  any rule change and update the canonical decision log only when authorized.
- Preserve local-first data, user drafts, GPX, source/provenance, map gesture
  rules, existing RideSession, routing authority and unknown-data semantics.
- Preserve working Free Ride, recording, settings, editing, offline, voice,
  zoom/compass, off-route recovery and two-step End behavior.
- Phone `<761px`, tablet `761–1180px`, desktop `≥1181px`, and the existing
  compact/short-landscape behavior remain unless intentionally approved.
- Use existing tokens/themes; ride controls ≥56px and other controls ≥48px.
- Design images are generated illustrations, not a test oracle for data,
  geography, geometry, attribution, legibility or physical safety.

## Review focus

1. A selected route or unsaved draft survives Back, a page transition, reload,
   orientation change and a failed update without silent geometry replacement.
2. At phone and tablet breakpoints, a sheet, navigation, safe area, keyboard,
   map attribution and focus never occupy conflicting space.
3. An imported or community route retains the original track; changed metrics
   are explained from evidence, not assumed to be a defect or invented.
4. Active ride continues through lost GPS/network and resumption; safe recovery,
   recording indicator and two-step end remain reachable.
5. Near-me denial, reduced transparency, large type, map failure, and unavailable
   offline data each yield a comprehensible and usable state.

---

## Task 1: Baseline and decision reconciliation

**Read:** `CLAUDE.md`, `DESIGN.md`, `docs/vnext/design/small-screen-v2.md`,
`docs/vnext/design/maps-for-riders.md`, `scripts/og-shots/README.md`, spec.

- [ ] Confirm current base commit and identify open overlapping UI work.
- [ ] Record whether the owner has approved each change to locked design rules.
      Reconcile floating-vs-docked documentation with the actual current CSS.
- [ ] Run the relevant deterministic baseline from `CLAUDE.md`; record any
      pre-existing failures. Run one resource-intensive command at a time.
- [ ] Capture and inspect before images on the supported screenshot devices.
      Mark fixture route data and missing live-map/device capability clearly.
- [ ] Deliver a short evidence map of existing versus new behavior. In
      particular verify the phone `data-trip` nav hiding and ride-end flow
      rather than implementing them again.

## Task 2: Navigation and contextual surfaces

**Inspect/modify as appropriate:** `src/ui/nav/PrimaryNav.tsx`, `AppBar.tsx`,
`nav.css`, `src/ui/planner/PlannerWorkspaceFrame.tsx`, `PlannerWorkspaceDock.tsx`,
`gmaps-layout.css`, `src/ui/sheet/Sheet.tsx`, `sheet.css`, `planner-ui-store.ts`.

- [ ] Add a meaningful failing regression that enters route preview, confirms
      exactly one primary bottom surface, backs out, and verifies the draft can
      be resumed without changing its route; include Settings access from
      planner and non-planner pages.
- [ ] Reuse current `data-trip` / responsive layout behavior. Implement the
      proposed three-item browsing navigation and accessible Settings/menu entry
      where approved, keeping Free Ride and Record readily accessible.
- [ ] Coordinate sheet/nav focus, height measurement, safe areas and map camera
      insets; keep sheet drag and keyboard controls without duplicate state.
- [ ] Extend existing `tests/e2e/critical/compact-sheet.spec.ts`,
      `mobile-planner-ux.spec.ts`, `map-gestures.spec.ts` and relevant unit
      coverage. Replace only assertions intentionally superseded by the new
      contract; retain map-gesture and draft-preservation coverage.
- [ ] Run affected unit/e2e tests and inspect before/after screenshots at small
      phone, Pro Max, iPad and desktop sizes, including 200% text and keyboard.

## Task 3: Route identity, preview and comparison

**Inspect/modify as appropriate:** `PhoneRideSummary.tsx`,
`PlannerResultPanel.tsx`, `RouteDecisionCard.tsx`, `RouteOptions.tsx`,
`RouteDetail.tsx`, `route-facts.ts`, catalog-to-planner composition and the
route view models.

- [ ] Reproduce the previously observed Loyalsock metric mismatch. Compare
      source geometry and calculated geometry, duration model, surface input,
      units, provenance and source freshness. Write the measured cause and
      distinguish a data issue, legitimate estimate difference and route change.
- [ ] Add a regression for the actual cause, preserving the original imported or
      catalog line and distinguishing an explicitly recalculated alternative.
- [ ] Implement the compact summary and accessible compare view using actual
      candidates. Selecting a row and selecting its line project the same choice;
      do not invent a missing candidate or data source.
- [ ] Verify initial, loading, no-candidate, unknown-surface, route-error and
      failed-edit recovery states; relevant existing tests include
      `first-route.spec.ts`, `ride-style.spec.ts`, `explore.spec.ts`,
      `recovery.spec.ts`, `gpx-sharing.spec.ts` and `import-export.spec.ts`.
- [ ] Run the affected tests and visually inspect real-map and labeled fixture
      cases separately. Do not certify a route's geometry from a screenshot.

## Task 4: Explore and ride preparation

**Inspect/modify as appropriate:** `ExplorePanel.tsx`, `ExploreMap.tsx`,
`RouteDetail.tsx`, `explore.css`, `RoutePreparationSection`,
`PlannerPreparation.tsx`, `OfflineMapsSection.tsx` and their current view models.

- [ ] Add a user-level regression for route list/map selection and back-navigation
      with the route list/filter state preserved. Test GPS denied and zero results.
- [ ] Present compact, meaningful discovery information and optional map/list
      transitions. Preserve source, saved state, GPX and route detail features.
- [ ] Present saved route, downloaded map coverage and offline routing as three
      different capability states using actual available sources. If data is not
      available, say so instead of showing a fabricated readiness check.
- [ ] Run affected `explore*.spec.ts`, `prepare.spec.ts`, `offline*.spec.ts`;
      test airplane-mode behavior only in an environment that supports it.

## Task 5: Ride Focus and cross-device polish

**Inspect/modify as appropriate:** `RideFocus.tsx`, `RideMetricStrip.tsx`,
`ride.css`, map/appearance integration, existing ride store and its tests.

- [ ] Add or adapt a regression confirming nav remains hidden, the controls
      sheet retains pause/record/recovery/zoom/compass, and End remains two-step.
- [ ] Align the day/night hierarchy with the references without removing
      glove-sized controls or changing the navigation session semantics.
- [ ] Exercise off-route recovery and resume-mid-route using the latest main
      behavior and record what is simulated. Do not reintroduce a forced return
      to the original start.
- [ ] Run `ride-focus.spec.ts`, `free-ride.spec.ts`, `record.spec.ts` and relevant
      recovery tests. Inspect night with an actual dark basemap, when available.

## Task 6: Final verification and handoff

- [ ] Run the repository gates in `CLAUDE.md`: `npm run audit:env`,
      `npm run lint`, `npm run typecheck`, `npm test`,
      `npm run test:architecture`, and `npm run build`, plus affected critical
      Playwright tests. Record environment failures separately from test failures.
- [ ] Run and inspect the applicable screenshot gallery, e.g.
      `npm run shots -- --devices iphone17promax,iphone17,ipad11,desktop,chromium-320 --map real --themes light,dark`,
      only where the documented browser/simulator and network prerequisites
      are present. Real-map screenshots still use fixture routes with local target.
- [ ] Report before/after screenshots, tests, route discrepancy finding,
      known limitations and remaining physical-device / live-provider checks.
- [ ] Request review of the implementation. Do not deploy or merge as part of
      this design-handoff task without the owner's separate direction.
