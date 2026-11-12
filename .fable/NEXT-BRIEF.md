# Fable brief: OpenGravel next round (2026-11-11)

This codebase is yours. You are the advisor and the owner trusts your calls on look and direction.

## Goal
Owner, verbatim: "continue cooking and enhance my app significantly … where to take it from here, and I want to be impressed."
The owner vibe-codes and doesn't read code. They judge by what they see on the live site and the phone. Make the next round one the owner will notice and call impressive. Not more invisible plumbing.

## Current state
- Worktree `/root/Vibe/wt/og-next`, branch `round/next`, off origin/main 40115cb6 (= production, https://opengravel.henning.rodeo).
- Just shipped (PR #212): cold-open gravel and twisty layers with a legend; curated PA rides layer; honest surface line on the phone; own night terrain map; neutral selected chips plus a ring; glass only over the map; road-bends-v1 scorecard at 6/20 wins and 0 trust failures.
- Read first: `docs/PLAN.md` (90-day plan, 5 bars, 13 milestones, frozen areas), `.fable/ROUTING-PLAN.md` (your 6-step routing roadmap, step 1 done), `.fable/DESIGN-PICKS.md`, `DESIGN.md`, `.fable/ROUND-PLAN.md`.
- Left over from your list: W4 "open today" check on planned routes; W2 one-tap loop (routing steps 2–6).
- Milestones not started: 5 handlebar ride screen, 8 dead-zone offline ride, 9 laptop→phone QR, 11 "will my bike make it" line, 12 visible gates and closures plus a one-tap report, 6 TestFlight (blocked on the owner's Apple enrolment).
- Frozen for 90 days: hiking, Spotify, cameras, Ask/Jev, wind, sun, long trip, live follow.

## Resources
- Workers: DeepSeek V4.1 Flash (OpenCode/Command Code) for bulk coding on docker-dev, the MacBook or CT125. Codex Sol for hard routing work (quota may be out). Sonnet subagents for UI. Opus (me) runs the round, reviews, and does the CSS/UI itself.
- The Windows PC (64 GB, RTX 5070) can rebuild the GraphHopper graph (routing step 4).
- Gates exist: `npm run shots`, screenshot baselines in CI, `npm run ride-sim`, `npm run scorecard` (through an SSH tunnel, about 10 minutes).
- docker-dev runs one heavy job at a time. Never scan the whole disk.

## What I need from you
Write `.fable/NEXT-PLAN.md`, at most about 250 lines:
1. **Verdict.** Where OpenGravel should go next, in a few sentences. What gives the biggest "wow" a rider can see within one round (about 1 to 2 days of worker time), while still serving the PLAN bars?
2. **The round: 4 to 6 work packages**, ranked. For each: the rider's sentence (what they see), the files to touch (read the code and cite paths), executable pass/fail checks (shots, unit tests, ride-sim, scorecard), worker and machine, size, and dependencies. Mark which packages can run in parallel without touching the same files.
3. **The headline demo.** Exactly which screens and states I should capture for the owner's before/after page so the round looks impressive. Use specific places in PA (for example Rothrock, Michaux, the Pine Creek area).
4. **Kill list.** What not to do this round, and why.
5. **Taste calls** you make now, so I don't have to ask the owner.

Rules: be concrete and cite code. Don't propose unfreezing frozen areas. Don't build things that need the Apple paid account. Keep it honest: mark any estimate as an estimate. Don't edit source code. Write only `.fable/NEXT-PLAN.md`, plus short worker briefs in `.fable/briefs/next-*.md` (one per package, each self-contained, saying "This codebase is yours", with goal, files and pass/fail checks).
