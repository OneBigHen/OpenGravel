# OpenGravel: UX critique and Claude execution handoff (2026-10-28)

> **Documentation-only design review. No runtime implementation, product configuration, data migration, deployment or design-lock change in this PR.**
>
> For Claude/Opus: this is **feedback and a product-quality acceptance contract**, not a request to merge the documents and claim the UI is fixed. Produce separate, tested implementation PRs after reviewing the current source. The owner wants substantially better usability, not a superficial restyle.

## Start here

1. [Evidence and prioritized findings](FINDINGS.md) — observed vs source-confirmed vs unverified; ranked problems and false-positive corrections.
2. [Screen blueprints and precise interaction contracts](SCREEN-BLUEPRINTS.md) — phone/tablet/desktop composition, approximate coordinates, state transitions and copy.
3. [Architecture, execution sequence and safeguards](IMPLEMENTATION-GUIDE.md) — existing component ownership, CSS cleanup, route/data integrity, phases and verification.
4. [Acceptance matrix and adversarial QA journeys](QA-MATRIX.md) — objective pass/fail conditions across responsive, modes, offline and ride lifecycle.
5. [Copy-ready Claude/Opus start instructions](CLAUDE-START.md) — how to execute this handoff without losing existing functionality.
6. [Hiking UX audit and new trail-planning interaction spec](HIKING-UX.md) — 16 hike findings and full map, Explore, trail detail, trailhead and route-warning guidance.
7. [Cross-activity interface and state model](ACTIVITY-COHERENCE.md) — shared Map/Explore shell, distinct Ride/Hike meaning, routing and offline capability.
8. [Hiking acceptance matrix](HIKING-ACCEPTANCE.md) — 20 hike-specific checks plus challenging GPS, catalog and graph fixtures.
9. [Live runtime evidence caveat](RUNTIME-VERIFICATION.md) — why the public browser attempt did not find Hike, and how to verify source/deployment/discoverability.

## Hiking UX addendum

A second live desktop browser walkthrough did **not locate Hike mode** from its visited Map/Explore flow and did not reach Settings → Activity. This is inconclusive: the current GitHub source **does contain** `ActivitySwitch`, `HikeExplore`, `HikeActivityControls` and the dedicated foot router. Treat Hike discoverability and deployed-version parity as an explicit verification task, **not** a declaration that the feature is absent. See [RUNTIME-VERIFICATION.md](RUNTIME-VERIFICATION.md).

## Evidence provenance and limits

- **Live public-site walkthrough, 2026-10-28:** Map, Explore, My rides and Settings in a desktop-class browser. It showed a dense planning rail, dense Explore metadata, broad Settings and discoverability friction. The observed desktop views showed **no proven major clipping/overlap**. The walkthrough did not complete a live plan, active ride or phone-browser test. Screenshot artifacts were captured by the browser service but **are not checked in here**, so do not claim screenshot-based mobile validation.
- **Source review:** `OneBigHen/OpenGravel`, `main` at `8fb189f74fd19724fc935fd5c5ba80f04f6fc1eb` (2026-10-28). Source inspection establishes behavior/structure, not a production defect unless a test reproduces it.
- **Recent product handoff:** `docs/vnext/HANDOFF-2026-10-28.md` describes already-shipped map/hike work and **specific known gaps** (hike card obstruction, hike inspector ride wording, duplicate Explore implementations).
- **Existing visual proposal:** [PR #165](https://github.com/OneBigHen/OpenGravel/pull/165) has seven concept images and an earlier plan. Its branch remains open. Current `main` already contains newer UI changes. Compare, cherry-pick or supersede intentionally; **do not copy obsolete assumptions or create a competing shell**.
- Existing source of truth: `DESIGN.md` (locked, owner-approved decisions). Some older prose says floating tab navigation, but the latest decision log selects **docked** phone navigation, with a contextual sheet and no tab bar while a route is on the map.

## Product direction

**Google Maps clarity + Gaia outdoor mapping depth + REVER ride intent + OpenGravel's local-first trust.**

A rider opening the app should immediately understand: *Where am I? Where can I go? How do I start a good ride?* A hiker should see appropriately different trails and terms, not motorcycle UI relabeled “Hike.”

Operating principles:

1. Map as working canvas, not scenery behind controls.
2. **One dominant bottom surface** at a time. Browsing nav, planning/preview sheet, and active-ride instruments are mutually exclusive by state where appropriate.
3. Default to a **simple first decision**, progressively disclose road style, familiarity, surface, traffic, avoidance, layers, and expert editing.
4. A user-selected route/track is durable, not silently reshaped by navigation, reload or optional-provider failure.
5. Every interactive control has one obvious purpose and clear state; avoid simultaneous modal/sheet/menu overlays.
6. Keep data-provenance, legal-access, weather/traffic and offline **unknowns** honest. Attractive UI must not promise unavailable capabilities.
7. Improve **task completion and ergonomics**, not merely spacing, card colors or iconography.

## Explicit scope boundaries

- This PR changes **guidance only**. It must not change `src/`, `infra/`, `DESIGN.md`, lockfiles or deployed systems.
- Claude's implementation should use fresh isolated worktrees, small vertical PRs, original screenshots, regression tests, and owner review. It should not deploy or merge solely because this documentation PR exists.
- Do **not** rebuild `PrimaryNav`, `Sheet`, `RideSession`, routing services, offline storage, GPX import/export, or the already-working two-step End action.
- This review grants **no new permission** to change locked `DESIGN.md` rules. Propose conflicts and seek owner approval when required.

## Scope and review sequence

**First:** home map + nav/sheet ownership + route preview (biggest information-architecture payoff). **Second:** Explore list/map and distinct Ride/Hike variants. **Third:** My rides/Settings consistency and ride-phase polish. **Throughout:** screenshot-based QA, accessibility, route preservation, offline and device-specific checks.

A successful implementation should make a first-time user accomplish the basic journey *without needing to know the names of OpenGravel's subsystems*. Implementation commits and visual proof belong in **subsequent PRs**, not this handoff.
