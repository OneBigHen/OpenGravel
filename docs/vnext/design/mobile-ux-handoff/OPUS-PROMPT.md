# Prompt for Claude Opus

Paste the text below into an Opus/Claude Code session inside the OpenGravel
repository. First fetch the handoff branch and read the referenced files. The
generated images are committed alongside the instructions, so they do not
need to be copied from chat.

```text
I want you to improve OpenGravel's mobile and tablet UX, especially the bottom
bar, route sheet and how the map, planning and ride controls are presented.
Make it feel like a polished motorcycle navigation product: Google Maps' ease,
Gaia's mapping depth, REVER's ride discovery, and OpenGravel's own local-first,
open-source, rider-focused identity.

Start by reading:

1. docs/vnext/design/mobile-ux-handoff/README.md (the visual gallery and caveats)
2. docs/vnext/design/mobile-ux-handoff/SPEC.md
3. docs/superpowers/plans/2026-10-27-mobile-map-ux.md
4. CLAUDE.md, DESIGN.md, docs/architecture.md, and the design and screenshot
   docs referenced in the handoff.

The PNGs in docs/vnext/design/mobile-ux-handoff/assets/ are the direction I
want you to work toward. They are AI concepts, not reliable maps or final UI
assets. Use actual map tiles, route data, existing fonts and tokens, real
controls, proper attribution and accessible responsive layouts. Do not copy
their invented geography or metrics, or delete functionality absent from an
image.

Work from current origin/main in an isolated branch, then bring the handoff
files into your working tree if they have not yet landed. Read the current
source and open PRs first; the handoff was prepared against main at
37254edcbc3ee5795c5ed3c85c05e8859d937715 and the repo may have moved on.
Do not disturb other worktrees, uncommitted work, live services or user data.

My design intent is:
- On the map home, a search-first map and a compact Map / Explore / My rides
  navigation. Move Settings to an obvious named menu that remains accessible on
  every page. Keep Free Ride and Record discoverable.
- In phone route preview/compare, one contextual bottom sheet instead of a
  second nav bar stacked beneath it. Back restores navigation and preserves a
  resumable draft. Compact preview, richer expanded sheet, no duplicate controls.
- During active navigation, a readable maneuver, map and compact instrument
  strip; preserve the existing controls sheet, glove-friendly zoom/compass,
  off-route recovery, recording status, pause/resume and two-step End.
- Explore connects map and list; route detail remains informative and preserves
  provenance, comments, conditions, sharing and GPX.
- Keep the trail-instrument look: readable dense frosted glass, forest-green
  primary actions, plum selected route, coordinated day/night themes, and a
  genuinely dark night basemap. No nested glass or decoration that obscures data.
- iPad landscape uses the available width with a compact rail and map; desktop
  keeps its working rail/navigation. Respect iOS safe areas, keyboard, zoom,
  rotation, map attribution and camera padding.

The proposal may conflict with parts of the locked DESIGN.md. Treat this
message as my approval to implement the design intent above and to update the
specific conflicting rules and decision log in DESIGN.md; preserve other
established decisions. If the current code already behaves this way, polish
and test it rather than rebuilding it. In particular, phone trip navigation is
already hidden in gmaps-layout.css and ride end already takes two steps.

Investigate the Loyalsock route-metric discrepancy described in SPEC.md. Do not
assume its cause; compare actual source vs planner geometry and metric inputs.
Never silently replace the original GPX/community track or claim unknown roads
are safe/open/paved. Fix the actual defect or explain an evidence-backed
difference, with a meaningful regression.

Implement in the phases in the plan, using the existing shared sheet, planner
state and route view models. Verify each phase. Start with navigation and the
route sheet, then route comparison and discovery, then ride and cross-device
polish. Preserve local data, rerouting, map gestures, offline behavior and the
existing RideSession throughout.

Capture before and after screenshots of real screens in day and night. Run
the appropriate project tests and report failures accurately; a fixture route
or simulator does not prove live routing, actual GPS, real sunlight readability
or a physical ride. Finish with a concise report of changed files, design
decisions, screenshots, test results and remaining real-device checks. Push a
reviewable implementation branch; do not deploy or merge it without my later
instruction.
```
