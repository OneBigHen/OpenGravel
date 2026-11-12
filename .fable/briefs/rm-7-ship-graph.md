# RM-7: the new map is live, and one command puts the old one back

This codebase is yours. Owner model: Opus, hands-on (not an unattended worker). Machine: docker-stable
(`ssh docker-stable`), with the Windows PC as the source. Size: S.
Plan: `.fable/ROUTING-MASTER.md` section 5. Needs: RM-2 passed. **Step 4 (the swap) needs the owner's
"go" on the day**, sent with the scorecard line, as `CLAUDE.md` requires. Steps 1 to 3 do not touch the
live router and may run as soon as RM-2 passes.

## Goal (rider sentence)
"The new map is live, and one command puts the old one back."

## Current state (checked 2026-11-11)
- `og-graphhopper.service`: `java -Xms1g -Xmx4g -jar /root/Vibe/switchback/data/graphhopper-web-11.0.jar
  server /root/Vibe/switchback/infra/graphhopper/config.yml`, working directory `/root/Vibe/switchback`,
  port 8989 (admin 8990), 3.0 GB in use. Graph: `/root/Vibe/switchback/data/graph-cache` (1.3 GB).
- `ogv.service` reads `GRAPHHOPPER_URL=http://127.0.0.1:8989`; atlas path in `/etc/opengravel/ogv.env`
  (`OGV_GRAVEL_ATLAS_PATH=/var/lib/opengravel/gravel-atlas-v3.sqlite`).
- Box: 8 GB RAM, about 2.5 GB available, swap full, disk 6.1 GB free, Java 21. Two full routers do not
  fit in memory. The hiking router (port 8995) and everything else on the box are not ours to stop.
- Today's app works unchanged on the v2 graph (same profile names, every old value kept). The new app
  code (RM-4, RM-5) asks the router what it carries. So the graph and the app roll back separately.

## Steps
1. **Copy.** From the Windows PC build folder to `/var/lib/opengravel/router/v2-<date>/`: `graph-cache-v2/`,
   `og-ext.jar`, `config.yml` (ports 8989 and 8990, `graph.location` and `custom_models.directory`
   absolute, pointing inside this folder), `custom-models/`, `SHA256SUMS`, `import.log`. Also the atlas
   re-checked for this graph as `/var/lib/opengravel/gravel-atlas-v4.sqlite` and, once RM-5 exists,
   `/var/lib/opengravel/loop-anchors-v1.sqlite`. Push through docker-dev or pull with rsync; do not copy
   the 496 MB map file, the router does not need it to serve. Check `sha256sum -c SHA256SUMS`.
   Confirm at least 3 GB of disk stays free.
2. **Side-by-side smoke, without risk to the live router.** A transient unit:
   `systemd-run --unit og-graphhopper-v2-smoke -p MemoryMax=1800M -p WorkingDirectory=<folder>
   java -Xms256m -Xmx1g -cp og-ext.jar:/root/Vibe/switchback/data/graphhopper-web-11.0.jar
   com.graphhopper.application.GraphHopperApplication server config-smoke.yml`, where `config-smoke.yml`
   is the same config on ports 8991 and 8992 with memory-mapped storage
   (`graph.dataaccess.default_type: MMAP`; confirmed on the Windows rehearsal in RM-2). Then, through a
   tunnel to 8991: `probe-graph.py` (all checks except memory) and three tuning rides by hand. Watch
   `free -m` and the live router's health while it runs. Stop the smoke unit when done.
3. **Write the swap and the rollback as two scripts** in `infra/deploy/`: `router-swap.sh <folder>` and
   `router-rollback.sh`. Swap writes one drop-in,
   `/etc/systemd/system/og-graphhopper.service.d/v2.conf`, that clears and replaces `ExecStart` (new
   classpath with `og-ext.jar` first, the new config, `-Xms1g -Xmx4g`) and `WorkingDirectory`, then
   `systemctl daemon-reload`, `systemctl restart og-graphhopper`, waits for `/health`, runs
   `probe-graph.py`, and **rolls back by itself** if health or a probe fails within 120 s. It also
   switches `OGV_GRAVEL_ATLAS_PATH` (and `OGV_LOOP_ANCHORS_PATH` when present) in `/etc/opengravel/ogv.env`
   to the v4 atlas and restarts `ogv`; rollback restores the previous values from a backup copy it made.
   Rollback removes the drop-in, reloads, restarts, and checks health. Neither script deletes anything.
   Both were rehearsed on the Windows PC in RM-2.
4. **Swap (owner's go; a quiet hour).** Send the owner one message first: the tuning headlines on both
   graphs (v3, v2, v1), the NJ headline, three before and after route pictures, "about 40 seconds
   without routing, one command to go back". On "go": `infra/deploy/router-swap.sh <folder>`.
5. **After.** Health; probes; `/info` shows the new values; app smoke (plan one loop and one A-to-B on
   the live site); then the hold-out set, once: `npm run scorecard -- --set holdout` through the tunnel.
6. **Keep the rollback** for 14 days: the old graph, jar and config stay where they are. Do not tidy
   `/root/Vibe/switchback/data`.

## Pass / fail
- Before the swap: sums match; smoke probes pass on 8991; the live router answered `/health` throughout;
  available memory never fell under 500 MB.
- After the swap: `curl -s localhost:8989/info` lists `og_curve` and `og_through`; `probe-graph.py`
  exits 0 against production; router memory 3.3 GB or less after the scorecard; `ogv` health OK; the
  two live plans return routes.
- Hold-out: v3 within 2 wins of the tuning run on the same graph; v2 at least 6 (today's hold-out
  number); trust failures 0. If the hold-out misses, roll back and report; do not tune.
- Rollback proven on this box, not only on the Windows PC: run `router-rollback.sh` and
  `router-swap.sh` once more in the same session if the owner agrees to a second 40-second gap;
  otherwise state plainly that rollback on production is rehearsed elsewhere and untested here.
- Message to the owner afterwards: what changed in rider words, the hold-out line, how to go back.

## Rules
- Never restart or stop `og-graphhopper.service` before the owner's go. Never stop the hiking router or
  any service this package did not start.
- Deploy the app only with `infra/deploy/release.sh`; this package does not release the app.
- No secrets in the repo: the drop-in and env edits live on the box; the scripts live in the repo.
- If memory gets tight during the smoke, stop the smoke unit first and report. Do not free memory by
  stopping other services.
