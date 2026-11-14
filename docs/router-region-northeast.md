# Northeast region test build: what nationwide routing costs (PARTIAL)

Status 2026-11-14: the build half is measured. The serving half (memory, speed, MMAP) is NOT measured:
the Windows PC went to sleep after the build and did not wake (two wake-on-LAN presses, 15 minutes, no
ping). Everything marked "estimate" below is arithmetic from the measured numbers, not a test.
The tooling for the serving half is ready: `infra/graphhopper/region/serve-trial.py` (30 routes x 3 profiles,
200 mixed requests, p50/p95, cold start, memory after 200). Built graph waits on the PC at
`/mnt/wsl/ogv-data/ghbuild-moto-ne/build-8g/graph-cache-v2`. A second and third import at 6g and 5g heap
were started (`build-6g`, `build-5g`) and may have been cut off by the sleep; check `chain2.done`.

## Measured: building the map

Same pipeline, jar, config and profile numbers as the frozen PA+NJ build (unchanged). No elevation data is
used by that build (the router reports `elevation: false`), so nothing needed extending for the Northeast.

| | PA+NJ (known) | Northeast (measured) | Ratio |
|---|---|---|---|
| Source map from Geofabrik | 0.50 GB (derived) | 1.81 GB (`us-northeast-latest`, 9 states) | 3.6x |
| Prepare step (motorcycle tag cleanup) | n/a | 28 s, 0.3 GB RAM | |
| Import time (12 cores busy) | 249 to 261 s | 686 s (11.4 min), 8g heap | 2.7x |
| Import peak RAM (whole process) | 6.7 to 6.9 GB at 12g heap | 8.2 GB (8.6 GB by the OS counter) at 8g heap | 1.2x |
| Largest heap used before cleanup | 5.6 to 6.0 GB | 6.6 GB | 1.1x |
| Graph on disk | 1.35 GB | 3.38 GB | 2.5x |
| Road edges | 4.5 million | 11.0 million | 2.4x |

Plain reading: RAM to build grows far slower than the map (import streams to disk), so import is a
time problem, not a RAM problem. The 8g heap worked first try; smaller heaps were not confirmed.

## Not measured (PC unreachable)

Serving RSS after 200 requests, smallest working -Xmx, cold and warm first answer, p50/p95 on 30 routes
(Vermont, Adirondacks, Catskills, Maine, PA wilds), and MMAP versus RAM_STORE. PA+NJ reference, already
known: 2.9 GB resident, 4 GB heap (2 GB fails), p95 0.04 to 0.11 s, first answer 2.5 s warm / 17 s cold.

## Estimate: whole US (clearly estimates)

US map from Geofabrik is 12.26 GB, 6.8x the Northeast and 24.7x PA+NJ.

| | Northeast measured | US estimate | Basis |
|---|---|---|---|
| Graph on disk | 3.4 GB | about 23 GB (range 20 to 33) | 1.87 to 2.7 bytes per source byte |
| Import time | 11.4 min | about 75 to 90 min | linear in map size |
| Import RAM | 8.2 GB | about 12 to 16 GB | grows slowly; must be tested |
| Serving RAM, RAM_STORE | about 7 to 8 GB (estimate, 2.1x graph as PA+NJ) | about 48 to 55 GB | 2.1x graph size |
| Serving RAM, MMAP | untested | could drop to a few GB resident, disk speed decides | needs the test |

## Which machine (estimates)

| Machine | Whole US | Northeast alone |
|---|---|---|
| docker-stable (8 GB RAM, 6 GB disk free) | No | No (3.4 GB graph plus overhead does not fit with other services) |
| Windows PC (50 GB RAM, sleeps, dual-boots) | Only barely, and it was asleep for this very test | Yes, but not as an always-on server |
| megaplex host (31 GB, overcommitted) | No for RAM_STORE | Possible only if it has 10 GB spare |
| Rented 64 GB server | Yes, RAM_STORE, about 23 GB graph | Overkill |
| Regional split (4 to 5 regions of 8 to 12 GB each) | Yes, each region fits a 16 GB box | Yes |

## Recommendation

Do not serve the whole US from one box yet. Keep PA+NJ where it is; add the Northeast as a second region
only after the serving test above is run (about 30 minutes once the PC is awake). If nationwide is the
goal, plan on either a 64 GB rented server or, cheaper, 4 to 5 regional routers of roughly 10 GB each plus a
small switch in front that picks the router by start point. Build cost is not the blocker: the whole US
imports in roughly 1.5 hours on the PC.
