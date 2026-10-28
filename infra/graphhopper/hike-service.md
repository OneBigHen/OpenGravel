# Install the hiking router on an app host

This is a recipe and unit template, not a record of a production installation.
Choose the host's actual service account and paths before installing. The API
binds **127.0.0.1:8995**; admin connectors are disabled. Never expose it publicly.
It is independent of the motorcycle graph. The app must set:

```dotenv
OGV_HIKE_GRAPHHOPPER_URL=http://127.0.0.1:8995
# Only if a gateway in front of this router requires a key:
OGV_HIKE_GRAPHHOPPER_API_KEY=
```

The app always requests `hike`, never tries the motorcycle/hosted router or the
client's offline motorcycle graph. An absent or failed hike router returns
`hike-routing-unavailable`; disconnected/out-of-range points return
`no-trail-route`. Both are displayed plainly. `/api/health` reports the hiking
provider separately; it does not reveal the URL or key.

## Exactly what to copy

From the build machine:

| Source | Suggested destination |
| --- | --- |
| `/mnt/wsl/ogv-data/ghbuild-hike/graphhopper-web-11.0.jar` | `/opt/opengravel/graphhopper-hike/graphhopper-web-11.0.jar` |
| `/mnt/wsl/ogv-data/ghbuild-hike/snap-overlay-v3/hike-snap.jar` | `/opt/opengravel/graphhopper-hike/hike-snap.jar` |
| **All files recursively** in `/mnt/wsl/ogv-data/ghbuild-hike/graph-cache-v3/` | `/var/lib/opengravel/graphhopper-hike/graph-cache-v3/` |
| This repo's `infra/graphhopper/hike.yml` | `/etc/opengravel/graphhopper-hike/hike.yml` |
| This repo's `infra/graphhopper/custom-models/ogv-hike.json` | `/etc/opengravel/graphhopper-hike/custom-models/ogv-hike.json` |
| This repo's `infra/graphhopper/og-graphhopper-hike.service` | `/etc/systemd/system/og-graphhopper-hike.service` |

Set `custom_models.directory` in the copied YAML to the absolute destination
`/etc/opengravel/graphhopper-hike/custom-models`. The unit supplies the graph path
through `-Ddw.graphhopper.graph.location`. For a prebuilt graph the source PBF is
**not needed**. Copy a clean, closed graph (stop only the v3 server you own before
copying), retain every graph file and verify checksums at the destination.
Do not copy `graph-cache-quality`, its lock, logs, venv or preprocessing input.
Java 17+ is required. Keep the pinned GH11 jar, v3 overlay, graph and model together.

The four variables `HIKE_JAR`, `HIKE_SNAP_OVERLAY`, `HIKE_CONFIG`, `HIKE_GRAPH`
can be overridden in `/etc/opengravel/graphhopper-hike/service.env` (not a shell
script). Also edit User, Group, WorkingDirectory and ReadWritePaths in the unit
if paths differ. The account must read the config/jars/model and write its graph
directory, including its lock. The app account needs only localhost HTTP access.

After review/copy, an operator can run `systemd-analyze verify` on the installed
unit, `systemctl daemon-reload`, then `systemctl enable --now
og-graphhopper-hike`. Check `journalctl -u og-graphhopper-hike`, `/health`, and
`python3 infra/graphhopper/measure-hike.py --url http://127.0.0.1:8995 --out
/path/on/data-disk/probes.jsonl`. Restart the app with its new env and run a real
hike plan before calling the feature available.

## Build and policy

Build with `hike-access.py`, `build-hike-snap.sh`, the pinned jar, current model
and `hike.yml` as described in README. Import with **12 GB** heap on a build
machine; the service's `-Xms256m -Xmx1g` is for **loading a prebuilt graph**, not
statewide import. Never replace a running graph. Keep the previous graph/config
and overlay for rollback; stopping this service must not affect the rider graph.

Foot yes/designated/permissive (also official/destination) overrides general
no/private access; explicit foot=no remains excluded. Relation restrictions only
propagate to ways without explicit foot permission. Barrier restrictions remain
in effect unless that barrier itself has foot permission. The snap overlay uses
only eligible trail classes, up to **2 km**, never a road fallback. The UI reports
any waypoint over **300 m** from a trail. That gap is **not included** as a walking
connector or assumed to be accessible. Returned road sections are counted and
flagged separately. A returned route is OSM routing evidence, not current trail
conditions or a guarantee of access.

The graph is 2D. The app samples the returned geometry's DEM at no more than 30 m
spacing and reuses domain Tobler time and gain/loss. Missing DEM remains unknown,
with a disclosed flat-grade time estimate. There-and-back reverses the outbound
line and measures both directions. Loops use explicitly authored stops; automatic
loop discovery with the stock unrestricted round-trip snapper is not offered by
this adapter. The original unresolved Lehigh/Water Gap connections remain roads
unless their source connectivity actually changes.
