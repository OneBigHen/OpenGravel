# Verdict: RM-2 and RM-4, 2026-11-12 afternoon

Advisor verdict. Read from the raw run files in `scratchpad/runs/`, PR #220, the RM-2 profile files and
five direct questions to the two routers. No scorecard or build was run.

## Where we are (measured)

| Setup | Tuning v3 | NJ v3 |
|---|---|---|
| Production map, today's planner | 13 and 12 | 4 |
| New map (round 2b), today's planner | 13 (stitched run, see 4b) | 3 |
| Production map, RM-4 | 11 and 11 | 4 |
| New map, RM-4 | 11 | 4 (finished 15:12) |

The new map and RM-4 each fail alone and fix each other's worst fault. The new map alone loses NJ rides
by running 1.75x and 2.11x over the fastest route; RM-4 stops that (NJ back to 4). RM-4 alone has no
middle option, so when the twisty line is too long it hands the rider the plain highway.

## 1. RM-2: no round 3. Freeze the round 2b map. Do not ship it alone.

- **No round 3.** The map did its job: on the new map 8 of 10 curvy rides have a higher share of real
  bends, busy-road share fell from 117 to 27, and planning is 2 to 16 s where production takes 20 to 43 s.
  What is still wrong is not a profile number. The twisty profile is now strong enough that its line is
  1.50x the fastest on Allentown to Stroudsburg and 1.56x on Harrisburg to Lancaster. A third round would
  only trade that against bends again. The planner has to offer a milder line (decision 2).
- **Do not ship it alone.** With today's planner it is NJ 3 against 4, Harrisburg gets worse (1.35x to
  1.46x), and the Chatsworth gravel loop goes Win to Tie. The stop rule says ship only if nothing got
  worse.
- **It ships to RM-7 as a pair with the fixed RM-4.** Check: one clean paired run on the frozen map gives
  tuning v3 13 or more, NJ 4 or more, trust 0, no gravel Win lost, same verdicts on two runs.
- RM-2 still owes its non-tuning items: the probe on the final build, the swap and rollback rehearsal,
  load time and memory (3.3 GB or less). Do those now so RM-7 is not waiting.
- One number in the brief does not match the files. Curvy good miles summed over the 10 curvy rows are
  17.7 on production and 20.9 on the new map: **up 18%, not down 11%**. Still short of the 25% line, but
  not a loss. Check: the RM-2 PR states which runs its -11% came from.

## 2. RM-4: one fix, then land. Do not drop.

Keep it because it does what a rider feels: A-to-B in 3 calls instead of 6 to 11, no ride over 1.35x
(two tuning and two NJ rides stop being Losses), Pine Barrens becomes a Win, and RM-5 is built on it.

The fix, three parts, one attempt:

1. **A fourth call, the "gentle" line.** Curvy: the scenic profile. Dirt: dirt strength 2 (between the
   rider's own 1 and strong 3). Sent with the other three. It is an extra candidate, not a replacement,
   so it cannot cost Doylestown its Win: the pick still takes the most good miles. Asked directly, the
   new map's scenic line for Allentown is 71.8 min, 1.24x, inside the budget, where twisty is 86.9 min.
   The wave stays at 5 calls at most: when RM-5 adds detours they get the one slot left.
2. **Say so when the rider gets the plain fastest route.** Today, if every twisty or dirt line is over
   budget, the rider silently gets the highway (Allentown 70% busy roads, Harrisburg 90%). The
   "closest, labelled as over" branch can never run, because the fastest route always fits. Attach the
   existing over-budget note in that case. No new screen.
3. **Explain Old Buck before landing.** On the new map with RM-4 this gravel loop fell from 32.7 dirt
   miles to 13.5 with the same number of calls and the same 7.5 s planning, so it is not the deadline.
   It is either RM-4's new loop pick or a map rebuild in between (4b). Dump that ride's loop candidates
   on the frozen map with `main` and with RM-4. A lost gravel Win blocks the PR.

Pass line to land (replaces "+1 on one graph"; Lock Haven moves to RM-5 because no dirt line exists
inside 1.35x without a detour, the only one is 1.50x):
- New map: tuning v3 13 or more on two runs, Allentown and Old Buck are Wins, NJ 4 or more.
- Production map: tuning v3 12 or more, NJ 4 or more.
- Both: trust 0, no A-to-B over 1.35x, A-to-B plans 4 calls or fewer, loop verdicts unchanged.
- First answer on the new map: p50 0.5 s or less. It went from 0.3 s to 2.4 s with RM-4 on the new map
  (Williamsport 2.4 s, Harrisburg 2.7 s for a 0.1 s route). Find the cause; do not ship it.

If it misses after this one attempt: park RM-4 and bring the wave table back. No budget changes.

## 3. Yes, 15+ is still RM-5. Honest forecast 14 to 16, not 15 to 17.

After the RM-4 fix we stand at 13 on the new map. The rides still open, with how close they are:
Hawk Mountain (2.36% bends, bar 2.39%), Hawley (2.22% on the new map, bar 2.39%), Rothrock (31.8% dirt,
bar 35%), Lock Haven (11.8 dirt miles exist, 1.50x away), The Quick and the Dead (19%, bar 35%).
15 needs two of those five. Williamsport and Harrisburg will not win; stop counting them.

**Next package: RM-5 as written, on the frozen round 2b map, started only after RM-4 lands.** Build the
anchors table first and wire the A-to-B detour before the loop rings: it is the smaller half and it is
the only way Lock Haven and Hawk Mountain move.

Pass line:
- Tuning v3 **15 or more on both of two runs**, v2 rule 10 or more, trust 0, no Win lost.
- NJ 5 or more, with Chatsworth back to a Win.
- Loop plans 6 calls or fewer, A-to-B 5 or fewer, first answer p95 5 s or less, no "Could not find a
  valid point" errors.
- At 14: one fix attempt, then back to the advisor with the ring and anchor table. At 13 or less: stop.

## 4. Yes, four things make the numbers lie. Fix a, b and d before the next comparison.

a. **Loop rows flip between identical runs on the production map.** Green Lane scored 1.61 then 2.94
   good miles; Crystal Cave was a Win then a Tie, with 24 to 43 s planning against a 20 s deadline. So
   production is "12.5 plus or minus 1" and a one-point move there means nothing. Decision: every
   comparison is two runs, and a row counts only if both agree. Check: the report prints the lower of
   the two.
b. **The new-map baseline is not one run.** `B-r2b-full.json` is two partial runs stitched after the
   tunnel dropped at ride 12, it has no headline, router or commit in it, and PR #220 says the router
   was rebuilt at 13:21 between them. Most loop rows differ between it and the RM-4 run on the same map.
   Decision: one clean single run of `main` on the frozen map is the baseline; nothing is compared to
   the stitched file again. The scorecard file must record the map's build date and profile hash.
   Check: two runs carry the same build date.
c. **Curvy A-to-B verdicts hang on a few hundred metres.** Doylestown is a Win on 0.38 miles of bends;
   Hawk Mountain is a Tie by 0.03 of a point. Decision: leave rule v3 alone (changing it now is moving
   the goalposts) and add a margin column, so a Win within 10% of its bar is shown as thin. Check: the
   15+ claim names how many of its Wins are thin.
d. **The "fastest" reference is not the fastest on two rides.** Hawk Mountain's reference is 59.0 min
   and Doylestown's 29.1; asked directly, both routers give 47.7 and 18.1 for the fastest profile, and
   our own twisty line is quicker than the "fastest" on both, even on the new map's honest clock.
   Allentown and Harrisburg match exactly. Probably a highway-avoid setting on the reference. It matters
   because the 1.35x budget is measured from it: Doylestown's twisty line is 1.44x the true fastest.
   Decision: before RM-5's runs, state per A-to-B ride what the reference is, and the scorecard fails a
   ride whose own line is more than 2% quicker than its "fastest". Check: zero such rides.

## Order of work

1. RM-2: freeze round 2b, finish probe, swap rehearsal and memory. No more tuning.
2. Scorecard: 4a, 4b, 4d (small, Sonnet). Then one clean `main` run on the frozen map, twice.
3. RM-4: the three-part fix, two runs per map, land if it meets the line.
4. RM-5, anchors and A-to-B detours first.
5. RM-7 ships the map and planner together, on the owner's go.
