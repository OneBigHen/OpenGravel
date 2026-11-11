# Brief: Fable decides the three owner design picks (2026-11-10)

This codebase is yours. The owner looked at the three picks, said they all look good, and handed the call to you and Opus: "provide me a world class app". You are the design lead for this decision. Advisor role: decide and write, don't build.

## Goal
Lock a world-class visual direction for OpenGravel (gravel/twisty motorcycle ride planner, Mid-Atlantic; competitors REVER and Gaia GPS) by deciding the three picks from `.fable/ROUND-PLAN.md` section 7. Pick A, B, or a better C if you see one, with a short reason a non-coder can read.

## Current state
- Worktree `/root/Vibe/wt/og-worldclass`. Read `DESIGN.md` (decision log at line 133), `.fable/ROUND-PLAN.md` (your earlier plan; section 7 = the picks), `CLAUDE.md`.
- Prototype CSS / night style used for the shots: `.fable/picks.mjs` (P1, P3 CSS; P2 `nightTerrain()` recolour of Mapbox Outdoors). Prototypes are quick mock-ups over production, not final.
- Side-by-side images (A left, B right). Look at them with Read:
  - Pick 1 selected buttons (A green fill / B neutral outline, green only on the action): `/tmp/claude-0/-root/fe6a15d5-6a22-4f73-8fd0-526e6b0519e6/scratchpad/picks/sbs/p1-phone-light.png`, `p1-phone-dark.png`, `p1-desktop-light.png`, `p1-desktop-dark.png` in that folder.
  - Pick 2 night map (A Mapbox navigation-night / B own dark terrain): `/tmp/claude-0/-root/fe4319d6-5490-4b1e-bd48-4be1f0151242/scratchpad/picks2/sbs-rothrock.png` and `sbs-statecollege.png` (2x2: top = wide, bottom = close; zoom levels differ a bit between A and B).
  - Pick 3 glass (A glass everywhere / B glass only over the map): `/tmp/claude-0/-root/fe6a15d5-6a22-4f73-8fd0-526e6b0519e6/scratchpad/picks/sbs/p3-light.png`, `p3-dark.png` (order: Explore A, Explore B, Settings A, Settings B).
  - Single full-size shots are in the parent `picks/` folder and in `picks2/` if you need detail.
- Baseline production shots: `.fable/shots/`.

## Deliverable
Write `.fable/DESIGN-PICKS.md` with:
1. For each pick: decision (A / B / C), one or two plain-English sentences why, and the exact rule to lock (tokens or CSS rule, e.g. which elements may use the green fill; what the night map must show; which surfaces get glass).
2. If B for pick 2: the night-map spec (which layers stay visible, rough colour targets for forest, ridges/hillshade, contours, gravel/track, paved roads, labels, route line contrast) so Opus can build a real style, not the recolour hack.
3. Any one other change you see in these shots that stands between "pretty good" and world class (max 3, ranked), each with a file pointer if you know it. Stay within the round's frozen-area rules (hiking frozen).
4. The decision-log entries, ready to paste into `DESIGN.md` under "Decision log", in that log's existing format.

## Pass/fail
- Pass: all three picks decided with a lockable rule; DESIGN-PICKS.md exists; entries match DESIGN.md log format; no product code edited.
- Fail: "it depends" without a decision, or edits outside `.fable/`.

Keep the file under ~150 lines. Reply with a 5-line summary of the decisions.
