# Fable: RM-1 dead-end flag verdict — This codebase is yours

You advise; no product code. Answer in `.fable/RM1-VERDICT.md` in `/root/Vibe/wt/og-rm1` (branch routing/rm1).

RM-1 (your brief `.fable/briefs/rm-1-graph-engine.md`) is built on the Windows PC; every check passes
except the `og_through` dead-end flag on the 40-corridor test: corridors with a way in and out 17/20 true
(+1 unread); no-exit corridors 13/20 false (+2 unread); target 19/20 each.

Opus's diagnosis (from a read-only inspector it wrote):
- The 5 no-exit corridors reading true: the atlas calls a corridor "no exit" when nothing meets its very
  last point; in all 5 the dead end is only the last 150-240 m and the middle sits on network loops. Those
  last stretches correctly read false. Measured just before each corridor's end, 17 of 18 readable read false.
- The 2 way-in-and-out corridors reading false: real dead ends for a legal motorcycle (a 16.9 km cluster
  with a single way in, under the 20 km rule; one starting from a service road that is a legal dead end —
  the atlas counted links a motorcycle can't legally use).
- Rule: through = part of ≥20 km reachable without backtracking, or on the road between two such areas,
  legal motorcycle roads only (`og_through`; `og_through_street` excludes dirt/rough).
Everything is in `infra/graphhopper/moto/`, `infra/graphhopper/README.md`, probe results on the PC at
`/mnt/wsl/ogv-data/ghbuild-moto-v2/build-2/` (v2 router reachable from docker-dev on 127.0.0.1:8988).

Question: accept the flags with a corrected test (read no-exit corridors at the tip), change the rule
(which number), or fall back to your plan's alternative? Is the loop-anchor use in RM-5 safe with these
flags as they are? Give one verdict, and if the test changes, the exact new pass line so RM-2 can proceed.
Read-only; you may query the v2 router on 8988. End with a 5-line summary.
