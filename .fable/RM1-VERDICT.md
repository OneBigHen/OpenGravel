# RM-1 dead-end flag: verdict (Fable, 2026-11-12)

**Verdict: accept `og_through` and `og_through_street` exactly as built. Keep the rule and keep 20 km.
The flags are right; my test was wrong. Replace the test with the pass line below. RM-2 may proceed.**
No fallback to the plan's alternative: the extension works, so there is nothing to fall back from.

Everything below marked "measured" I ran today against build-2 (v2 router through the tunnel on 8988,
import date 2026-11-12T07:49:52Z, plus a throwaway read-only analysis of `graph-cache-v2` on the PC).

## Why the flags are right

1. **The flag is, in practice, "this road is on the main road network".** Measured on the graph:
   318,828 km read through; 318,343 km of that (99.85%) is one single connected part where every road has
   a second way out. The rest is 11 enclaves of 21 to 102 km each (467 km), 8 km of connector roads and
   10 km of small in-between parts.
2. **The 20 km number barely matters, so there is no better number to pick.** Measured: at 10 km the flag
   would gain 608 km (+0.19%); at 50 km it would lose 267 km (-0.08%). No number between 5 and 100 km moves
   the 40-corridor result by more than one corridor. Tuning it to pass a test would be dishonest and
   pointless.
3. **Opus's diagnosis holds on the whole atlas, not just on 40 corridors.** Measured, all 7,484 corridors
   with an entry link:

   | Atlas says | Read where | Readable | Dead end (false) | Through (true) |
   |---|---|---|---|---|
   | no exit (811) | 60 m before the end | 744 | 719 (96.6%) | 25 |
   | no exit (811) | midpoint | 749 | 482 (64.4%) | 267 (35.6%) |
   | way in and out (6,673) | midpoint | 6,599 | 412 (6.2%) | 6,187 (93.8%) |

   A third of "no exit" corridors have a through middle, so "95% false at the midpoint" could never pass.
   And 6% of "way in and out" corridors are dead ends at their middle, so "95% true" sits on a coin flip.
   The atlas counts map links at a corridor's two ends; it says nothing about the middle, and it counts
   links a motorcycle may not legally use.
4. **The router itself agrees with the flag, independently.** Measured on 777 corridor midpoints: I asked
   for a ride from 6 km behind, through the midpoint, to 6 km ahead, no U-turn wanted. Where the flag says
   dead end, 247 of 259 rides (95%) came back out over more than 500 m of the same road. Where it says
   through, 464 of 518 (90%) did not. The flag read through the router and read straight from the graph
   agreed on all 777.
5. The two "way in and out" corridors reading false are real dead ends: one sits in a 16.9 km pocket with
   one road in (`ga3-b-11876104-...-156974`), the other on a spur with nothing behind it
   (`ga3-d-19326156-...-290342`). Confirmed in the graph and by the ride test (6.9 km and 3.6 km ridden
   twice).

## The new pass line (replaces "95% true / 95% false at the midpoint")

**How to read a point** (one method for both sets, so nothing is "unread" by accident): route
`motorcycle_adventure` from the point to the corridor's first point with `details: ["og_through"]`; the
reading is the value on the first piece of the path. It counts only when the router's snapped start is
within 30 m of the point. If it does not count, skip that corridor and take the next in the fixed order
(`order by quality desc, id`) until 20 are read; look at no more than 40.

- **T1, dead ends:** corridors with `entry_links > 0 and exit_links = 0`, read **60 m before the
  corridor's last point** (the midpoint if the corridor is shorter than 120 m). **At least 19 of 20 read
  false.** Measured today: 20 of 20.
- **T2, through roads:** corridors with `entry_links > 0 and exit_links > 0 and routable = 1`, read at the
  **midpoint**. **At least 17 of 20 read true**, and the probe prints the id of each one that reads false.
  Measured today: 18 of 20; the two false ones are the real dead ends named above. A new id reading false
  on a later build needs its `OgInspect` line in the PR.
- **T3, tripwire (new, from the build's own log line):** through km over usable km is **between 65% and
  80%** for both flags. Today 71.1% (318,828 / 448,432) and 71.3% (288,862 / 405,167). Twenty corridors
  cannot notice the flag collapsing to all-true or all-false; this can. Pass the two numbers to the probe
  the same way `--turn-costs-bytes` is passed.

Leave the synthetic tree, ring and lollipop check in `OgChecks` as it is: that is what proves the rule;
T1 to T3 only prove it landed on real roads.

## Is the loop-anchor use in RM-5 safe with these flags?

**Yes, as a filter and a penalty, with three conditions for the RM-5 owner. No graph change needed.**

1. **Read the whole middle, not one spot.** An anchor is through only when *every* piece of its middle
   200 m reads true for the bike class (`og_through_street` for street and touring). Corridors can be
   through for the first half and a spur for the second; I measured several.
2. **Trust the graph, not the atlas link counts.** Do not drop anchors because `exit_links = 0` (267 of
   them have a good through middle) and do not keep them because `exit_links > 0` (412 are dead ends).
3. **The flag is not a promise that the route will not double back; the 300 m dead-end gate stays.**
   Measured: through a flag-true midpoint the router still rode more than 500 m twice in 54 of 518 cases
   (10%), because turning round costs it only 60 seconds and `pass_through` is a soft wish. That is a
   request matter (heading at the anchor, the turn-round cost), not a flag fault. RM-5 should report how
   many rings the gate rejects; if that is a problem, fix it in the ring request, and bring the table to
   me before touching the graph.

Known small limit, accepted: 485 km (0.15% of through roads) are enclaves with a single road in. A loop to
an anchor there must ride that one road twice; the flag does not catch it, the gate does. 4 of the 836
corridors I sampled sit in such an enclave. Not worth a rule change or a rebuild.

## What I could not repeat, and notes

- Not repeated: route parity with production, the curve field check, speed and memory, `OgChecks`. The
  question was only about the through flags.
- The atlas copy I could reach (`~/ga/atlas.sqlite` on the PC) has `routable` empty, so my through set is
  `entry_links > 0 and exit_links > 0`; its first 20 are the same 20 ids as in `probe-graph.json`.
- The tunnel in the README (`-L 8988:127.0.0.1:8989 windows-zac`) gave an empty reply today: Windows no
  longer forwards its own localhost into WSL. It works when pointed at the WSL address
  (`-L 8988:172.28.48.77:8989`; the address can change after a WSL restart). I left that tunnel up.
- `infra/graphhopper/moto/__pycache__/probe-graph.cpython-311.pyc` is tracked in git and shows as changed;
  it should not be in the repo.

## Summary

1. Accept the dead-end flags as built; the rule and the 20 km number stay. The test was wrong, not the map.
2. The flag is 99.85% "on the main road network"; moving 20 km to 10 or 50 changes under 0.2% of roads.
3. New pass line: 19 of 20 no-exit corridors read false 60 m before their end (today 20); 17 of 20
   in-and-out corridors read true at the middle (today 18); 65 to 80% of road km read through (today 71%).
4. Loop anchors in RM-5 are safe with these flags, as long as the whole middle 200 m reads true, the
   atlas's own exit counts are ignored, and the existing 300 m dead-end check stays on.
5. RM-2 can start now. One thing to watch in RM-5: one in ten rides through a good anchor still doubled
   back, because turning round is cheap for the router; that is fixed in the request, not the map.
