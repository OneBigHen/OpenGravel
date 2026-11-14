# Router v2 (the new road map): ship and roll back

Plain version: the new map goes live with one restart of the existing router service, and one
command puts the old one back. Nothing on docker-stable has been changed by this work; the
steps below are for the day the owner says yes. The new map ships together with the one-go planner
(RM-4), never alone. What is frozen, with every checksum: `infra/graphhopper/moto/FROZEN.md`.

## What was measured (Windows PC, 2026-11-13, same files that will ship)

| Check | Result |
|---|---|
| Probe (`probe-graph.py`) | Exit 0, all checks pass (twice: standalone and as a service) |
| Fastest route vs the old router | 20 of 20 identical (worst difference 0.000%) |
| Turn-restriction file | 1,048,676 bytes, same as production |
| Road-bend field, rider lines | curvier on 6 of 6 rides, rank agreement 0.965 (from the r2 field check on this exact graph) |
| Dead-end flags | 20 of 20 correct; through roads 18 of 20; 71% of usable road km counted as through |
| Route speed | p95 0.04 to 0.11 s, 200 requests |
| Start to first answer | about 2.5 s with the files in memory; 17 s the first time after a quiet spell (old map: 12 s) |
| Memory after 200 requests | 2.88 GB resident (limit 3.3 GB). Old map, same test: 2.82 GB. After about 600 requests: 2.89 GiB |
| Switch to new, switch back, switch to new | restart 0.2 s each; first answer 17.4 s (cold), 2.5 s, 2.5 s |

Caveats: the "old router" in the probe is the production map file set on the PC (import 2026-10-04),
not docker-stable itself. The graph needs a 4 GB heap (2 GB runs out of memory), as production does.
docker-stable's disk is slower than the PC's, so expect the cold start to be longer than 17 s; plan
for up to 40 s without routing. Memory has 0.4 GB of headroom, not a lot: check free RAM first.

## Ship (at a quiet hour, owner's yes first)

1. Copy to docker-stable (1.4 GB, 6.1 GB free): from the PC, the `graph-cache-v2` folder,
   `og-ext/og-ext.jar`, `config-v2.yml`, `custom-models/` and `graphhopper-web-11.0.jar` into
   `/var/lib/opengravel/router/v2-2026-11-13/`. Check every sha256 against `FROZEN.md`. The old
   graph, jar and config are never touched.
2. Optional side-by-side smoke: run the same java line as step 3 by hand on port 8991 with
   `-Ddw.server.application_connectors[0].port=8991 -Ddw.server.admin_connectors[0].port=8992`,
   run `probe-graph.py` against it, stop it.
3. Write the switch (one drop-in file) and restart:
```
mkdir -p /etc/systemd/system/og-graphhopper.service.d
cat > /etc/systemd/system/og-graphhopper.service.d/v2.conf <<'EOT'
[Service]
WorkingDirectory=/var/lib/opengravel/router/v2-2026-11-13
ExecStart=
ExecStart=/usr/bin/java -Xms1g -Xmx4g -cp og-ext/og-ext.jar:graphhopper-web-11.0.jar com.graphhopper.application.GraphHopperApplication server config-v2.yml
EOT
systemctl daemon-reload && systemctl restart og-graphhopper
```
4. Check: `curl -s localhost:8989/health`, then `curl -s localhost:8989/info` shows import_date
   `2026-11-12T16:19:17Z`; run `probe-graph.py`; then the app smoke test and the hold-out scorecard.

## Roll back (about the same time as the switch)

```
rm /etc/systemd/system/og-graphhopper.service.d/v2.conf && systemctl daemon-reload && systemctl restart og-graphhopper
```
`/info` then shows import_date `2026-10-04T12:12:19Z`. The app works on either map and asks the
router what it carries, so the map and the app roll back independently.

## Rehearsal on the PC

Done with a copy of the production unit as a user service (`og-graphhopper-rehearsal.service`) and
this exact drop-in: old, then new, back to old, then new again. One PC-only difference: the
rehearsal service listens on all addresses so the dev box can tunnel in. The router is left running
on the new map there; from docker-dev the tunnel (port 8988) is
`ssh -N -L 8988:<wsl-ip>:8989 windows-zac` (`hostname -I` inside WSL gives the address; today it
is 172.28.48.77, and one is already up).
