# Claude / Opus start prompt — ready to paste

> This prompt is for a **separate future Claude Code implementation session**. It accompanies a docs-only owner feedback PR. It must not be interpreted as approval to merge or deploy the feature work unreviewed.

```text
You are the principal product designer, UX researcher and frontend architect for
OneBigHen/OpenGravel. Your mandate is to make its current web/PWA experience
dramatically easier and more beautiful, without degrading its sophisticated
routing, mapping, recording, hiking, offline and local-first capabilities.

The owner does NOT want another superficial CSS pass. The central failure is
information architecture: too many controls on first use, competing overlays,
and complex transitions between browse, plan, preview, edit, compare and ride.
The target is Google Maps' clarity + Gaia's outdoor map usefulness + REVER's
motorcycling flow, with OpenGravel's trail-instrument identity.

READ THESE FILES FIRST, IN ORDER:
1. docs/vnext/design/ux-critique-2026-10-28/README.md
2. docs/vnext/design/ux-critique-2026-10-28/FINDINGS.md
3. docs/vnext/design/ux-critique-2026-10-28/SCREEN-BLUEPRINTS.md
4. docs/vnext/design/ux-critique-2026-10-28/IMPLEMENTATION-GUIDE.md
5. docs/vnext/design/ux-critique-2026-10-28/QA-MATRIX.md
6. CLAUDE.md and DESIGN.md (DESIGN.md is locked)
7. docs/vnext/HANDOFF-2026-10-28.md
8. docs/vnext/design/mobile-ux-handoff/README.md and SPEC.md
9. docs/superpowers/plans/2026-10-27-mobile-map-ux.md
10. docs/architecture.md and the related current production/deploy handoff.

CHECK OPEN PRs before touching source. PR #165 is an earlier visual-concept
handoff and #98 is a test/polish agent brief. The concepts in #165 are visual
inspiration, NOT accepted geometry, final code, actual map tiles or real data.
Current main already includes many of their intended improvements. Use
current source as truth, not stale PR prose.

BEGIN WITH EVIDENCE:
- Fetch latest origin/main in a clean isolated worktree; do not disturb any
  dirty checkout, active worktree, production deployment, data or secrets.
- Capture actual before screenshots for 320x640, 390x844, 440x956,
  iPad landscape 1194x834 and desktop 1440x900, Day + Night.
- Inspect Map idle, search/results, selected place, route preview,
  compare/edit/options, Explore Ride/Hike, route detail, populated My rides,
  Settings, active Ride Focus, and error/offline/permission states.
- Separate reproducible bugs from likely problems, and check screenshot
  artifacts are real, nonblank, not a mock. A desktop screenshot does not
  establish a phone regression.
- Compare current behavior against the audit; don't implement things
  already present (3-tab nav, AppMenu, existing Sheet, phone route nav hide,
  ride two-step End, typed Delete all confirmation, My rides empty CTAs).

IMPLEMENT IN SMALL, REVIEWABLE PHASES:
A. Map and surface ownership:
   * Search and simple map-first ride intent before advanced options.
   * ONE dominant lower viewport surface by state.
   * Reuse PrimaryNav, AppMenu, PlannerWorkspaceFrame/Dock, Sheet and
     current planner UI state; no parallel bottom bar, sheet or route store.
   * Normalize insets, keyboard, focus, 320px, Pro Max and iPad behavior.
B. Route preview / comparison / editing:
   * Name, travel time, distance, actual measured route characteristics,
     Start, secondary Compare/Edit/Save/Share in correct hierarchy.
   * Selecting a real alternative updates the same route candidate and map
     line; none invented. Preserve original GPX/catalog source geometry.
   * Full expert controls remain accessible but aren't first-run clutter.
   * Back, reload and failure preserve draft, last-good route and intent.
C. Explore and Hike:
   * ≈96px legible scan-first route rows, source preserved, route/list map
     selection synchronized, filters/scroll restore on Back.
   * Fix the currently documented Hike card overlap on phones and
     incorrect rider inspector/copy on desktop.
   * Do not pretend Hike is just a renamed Ride; dedicated foot router and
     evidence-backed grade/elevation/eligibility stay intact.
D. Active Ride, My rides and Settings:
   * Glanceable rider controls / nighttime full dark map, protect two-step
     End, recording, pause/resume, voice and off-route/current-position
     recovery.
   * Improve list/settings grouping and explain local-first/offline truth.
   * No duplicate features or new persistence backend just for appearance.
E. Consolidate only proven-obsolete CSS after behavior is covered by tests.
   * Preserve the latest owner-approved docked navigation decision.
   * Do not silently rewrite DESIGN.md; propose approval for conflicts.

NON-NEGOTIABLE DOMAIN AND SAFETY RULES:
- GraphHopper route authority. Hikes use the dedicated foot router; no rider
  routing fallback for footpaths.
- Never make unknown road access/surface/closure = safe/legal/open/paved.
- AI/advisor may suggest and explain but cannot authoritatively fabricate
  geometry or provider truth.
- Local-first ride/GPX/recording preservation; no automatic route replacement.
- One RideSession across supported surfaces; no surprise return to start.
- Data/model/permission errors remain honest; optional providers fail
  independently.
- Existing design tokens, real dark basemap, legal map attribution and
  48/56px minimum control targets stay in place.

EVIDENCE-BASED VERIFICATION:
- Implement each issue as: reproduce -> failing/meaningful test -> minimal
  correct change -> screenshot + interaction test -> written result.
- Run CLAUDE.md gates: audit:env, lint, typecheck, test, test:architecture,
  build, relevant critical Playwright tests. Use actual shot tooling and
  keep fixture/live-provider results separate. Do not run resource-heavy
  commands concurrently on constrained verification nodes.
- Run QA-MATRIX.md journeys J01–J09, prioritize P0 cases. Re-enable existing
  hike-planning test.fixme only after the real scenario passes.
- Maintain accessibility: keyboard, VoiceOver, dynamic type, reduced
  motion/transparency, predictable sheet/Back behavior.

DELIVER REVIEWABLE WORK:
- Work on current updated main in a separate worktree per implementation
  tranche; do NOT commit application changes into the documentation handoff PR.
- Produce Phase 0 findings first and then concrete UI changes; do not stop
  after writing another proposal.
- After each phase, share before/after screenshots at identical viewports,
  factual UX improvements, changed files, all test results and known gaps.
- Open focused implementation PRs for review. DO NOT merge or deploy unless
  the owner separately instructs it. Keep every feature/data invariant.
- The goal is a genuinely easier route-planning and riding experience, not
  a high-gloss version of the old control pile.

If another agent is already modifying relevant files, coordinate via branch
comparison and separate worktrees; never overwrite their uncommitted changes.
Ask for owner approval only when changing a locked product rule or taking
a destructive/production action; otherwise proceed with documented design
decisions and tests.
```

## Quick review of Claude's first reply

A useful response from Claude before coding should include:

1. Current base commit and conflicting open PRs/worktrees.
2. Baseline screenshots/evidence, with which environments were actually tested.
3. A concrete surface/state ownership table.
4. First 2–3 P0 problems to reproduce and why they matter.
5. Files and tests to touch in Phase A (and things explicitly not to rebuild).
6. Whether any proposed change conflicts with owner-locked `DESIGN.md`.

**Reject** replies that:
- simply say “I'll make the design cleaner” without a measurable task flow;
- offer 5 unrelated stylistic directions instead of implementing a consistent screen hierarchy;
- create new route data/control stores or discard existing work;
- label an untested phone/ride scenario as a confirmed production defect;
- rewrite broad CSS without regression proof;
- claim an illustration or offline fixture proves actual road legality, GPS behavior or real map rendering.

**Accept** work that makes the map easier to use, Start more obvious, Back safe,
Explore map/list coherent, Ride/Hike genuinely distinct and existing route truth
untouched — with reproducible before/after proof.
