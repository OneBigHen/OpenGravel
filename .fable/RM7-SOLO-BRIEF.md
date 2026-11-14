# Fable brief: switch the new road map (RM-7) on by itself, or wait for RM-4? (This codebase is yours)
Date 2026-11-14. Owner wants a finished, bug-free product and has said YES to RM-7 (2026-11-13), and earlier: "fine with whatever you think, deploy as ready".
Your earlier verdict (.fable/RM-NEXT-VERDICT.md) said: swap the router to the new 2b map together with RM-4, after the RMN-2 rehearsal passes.
State now:
- RMN-2 rehearsal PASSED (PR #233 merged: map files, FROZEN.md checksums, docs/router-v2-ship.md switch + roll-back page; 2.88 GB RSS, needs 4 GB heap). The swap is "a 40-second switch" on docker-stable.
- RM-4 = draft PR #220, still misses the pass line by one loop row on the prod map (new map: 13/13 per f8b50fd4 notes). Not landing soon.
- Riders still hit the P0 "loop stuck": Hatboro loops take 30-37 s (#231 evidence); #230 (about to ship) only adds a progress counter + give-up at 20 s. New map: busy roads 117→27, p95 0.4 s, NJ 3 vs 4 on prod scorecard (RM-2 notes in memory).
- Prod box docker-stable memory: check docs/router-v2-ship.md for headroom notes; earlier "production box has 2.5 GB free and full swap" appears in the backlog.
Question: should we do RM-7 now WITHOUT RM-4? Give: verdict (yes/no/conditions), the exact pre-checks (scorecard to run, memory headroom check, which loops to time), the pass line, the rollback trigger, and what we lose by not pairing with RM-4. Read what you need (docs/router-v2-ship.md, .fable/RM-NEXT-VERDICT.md, RM-DECIDE-VERDICT.md, ROUTING-MASTER.md). Do NOT run scorecards or touch prod. Write .fable/RM7-SOLO-VERDICT.md (plain English, ≤1 page) and commit it on this branch.
