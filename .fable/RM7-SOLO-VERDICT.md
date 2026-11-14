# Verdict: switch the new road map on by itself (RM-7 without RM-4)? 2026-11-14

Advisor verdict. Read from last night's raw run files (main and RM-4, both maps, two runs each),
`docs/router-v2-ship.md`, `FROZEN.md` and the master plan. I ran no scorecard and touched nothing live.

## Verdict: YES, with conditions. Do not wait for RM-4.

I am reversing my "only as a pair" rule. Reason: the pair rule came from the old scorecard, where the
map alone scored NJ 3 against 4. On the fair scorecard, same session, today's planner scores:

| Today's planner (main) | Tuning | NJ | Slowest loop to plan |
|---|---|---|---|
| Old map | 12 and 12 | 3 and 3 | 33 s (five loops take 20 s or more) |
| New map | 13 and 13 | 3 and 3 | 13 s (most 2 to 8 s) |

That is the "loop stuck" bug, and nothing else in the queue fixes it. It also matters for #230: its
20-second give-up would turn those five slow loops into failures on the old map. Ship the map before
or with #230, not after.

**One known cost, and I am waiving a stop rule for it, so the owner should hear it:** the Chatsworth
gravel loop (South Jersey) drops from Win to Tie, 17.9 dirt miles to 10.4. Frenchtown goes Tie to Win,
so NJ stays 3. RM-4 does not bring Chatsworth back either (still a Tie with it), so waiting buys
nothing there. RM-5 owns it.

## Pre-checks (Windows PC and tunnels only, current main with #231 in it)

1. **Right map.** Every run last night was on a map stamped `13:21:58Z`. The frozen map that would ship
   is stamped `2026-11-12T16:19:17Z`. The frozen map has never been scored. The scorecard file's map
   stamp must read 16:19:17Z, or the run does not count.
2. **Scorecard.** Tuning twice and NJ twice on the new map (tunnel 8988), and the same on the old map
   (8989) in the same session. One scorecard at a time.
3. **Time the loops**, three tries each on the new map: Hatboro 2-hour (never timed on the new map),
   Crystal Cave, Lansdale, Phoenixville, Green Lane, Frenchtown.
4. **Memory on docker-stable, looking only:** `free -m` shows 1.0 GB or more available with the old
   router running (the new one takes its place and is 0.06 GB bigger); 3 GB or more disk free.
5. **Skip the side-by-side smoke (step 2 of the ship page) as written.** It starts a second full
   router with a 4 GB heap on a box with 2.5 GB free. Either skip it (the PC rehearsal covers it) or
   use the capped version in the master plan (1 GB heap, 1.8 GB hard cap).

## Pass line

- New map: tuning 13 or more on both runs and never under the old map in that session; NJ 3 or more.
- Trust failures 0, planning errors 0. No tuning gravel Win lost. No row goes to Loss.
- The only verdict allowed to drop is Chatsworth. Harrisburg no worse than 1.46x the fastest.
- Every timed loop under 15 s on every try; Hatboro stays out of the city (the #231 test passes).
- A miss on any line: no switch, back to me with the row table.

## After the switch: roll back if any of these

Probe fails; no healthy answer 90 s after restart; router memory over 3.3 GB or a memory kill in the
log; box under 0.5 GB available; ship-day hold-out misses (within 2 of tuning, old rule 6 or more,
trust 0); any loop from step 3 over 20 s on production; more router errors than the day before in the
first 24 hours. Roll back is deleting one file and one restart.

## What we lose by not pairing with RM-4

- NJ 4 becomes 3 for now: Pine Barrens stays a Loss, and gets longer (1.74x to 2.14x the fastest).
- Harrisburg stays a Loss and gets longer (1.35x to 1.46x). Lock Haven stays a Loss.
- A-to-B still takes 6 to 11 router calls instead of 4 to 5 (but each is quick on the new map).
- Nothing is lost for good: RM-4 already passes 13/13 on the new map, so with the old map retired its
  one failing row (Lansdale, old map only) stops mattering. RM-4 lands next against the new map alone.
