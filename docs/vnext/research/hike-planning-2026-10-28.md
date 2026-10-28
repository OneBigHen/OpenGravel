# Hike planning integration — 2026-10-28

The quality graph on 127.0.0.1:8995 and its admin listener on :8996 were left running.
V3 uses **127.0.0.2:8996** because the old router already owns 127.0.0.1:8996.
All source coordinates are unchanged in `infra/graphhopper/probes.json`. The app needs
`OGV_HIKE_GRAPHHOPPER_URL`; it never falls back to motorcycle routing.

## Graph and fixed probes

Full-source preprocessing and import into `/mnt/wsl/ogv-data/ghbuild-hike/graph-cache-v3`
completed. V3 has **3,123,322 nodes / 3,978,127 edges** and **zero ignored junction
barriers**. The existing quality cache was not modified. Preprocessing inserted
18,876 blocker copies, preserved 52,967 foot-passable nodes and identified 9,050
blocked nodes. Explicit foot permission overrides generic access restrictions;
node barriers still need their own permission.

The pinned GH11 jar is unchanged. `snap-overlay-v3/hike-snap.jar` permits eligible
trail-only snaps up to 2 km; the app discloses each approach beyond 300 m. Neither
the returned geometry nor distance includes an invented access connector. V3 was
imported with 12 GB heap, then loaded and probed with **-Xms256m -Xmx1g**.

| Probe | km before → v3 | All trails % before → v3 | Max road class v3 | Start/end snap m v3 | Trail-only connection |
| --- | ---: | ---: | --- | ---: | --- |
| Hawk Mountain | unavailable → 1.29 | — → 100.0 | none | 42/64 | yes |
| Lehigh Gorge | 38.33 → 38.33 | 66.51 → 66.51 | secondary | 150/48 | no |
| Jim Thorpe | unavailable → 4.10 | — → 81.21 | tertiary | 51/628 | no |
| Delaware Water Gap | 2.18 → 2.18 | 64.36 → 64.36 | tertiary | 252/207 | no |
| Ricketts Glen | 3.30 → 3.30 | 100.0 → 100.0 | none | 51/42 | yes |
| Trexler Border Trail | 1.88 → 1.88 | 100.0 → 100.0 | none | 0/0 | yes |
| Jacobsburg red trail | 0.98 → 0.98 | 100.0 → 100.0 | none | 0/0 | yes |
| Pine Creek Rail Trail | 1.93 → 1.93 | 100.0 → 100.0 | none | 0/0 | yes |
| Shades of Death Trail | 1.56 → 1.56 | 100.0 → 100.0 | none | 0/0 | yes |
| Bushkill Colony Trail | 1.06 → 1.06 | 100.0 → 100.0 | none | 0/0 | yes |

All ten now return geometry, but only **seven** are all-trail routes. Hawk Mountain
is fixed (100% path). Jim Thorpe now routes to the nearest eligible trail 628 m
away and still includes about 0.48 mi of roads. Lehigh Gorge remains a 38.33 km
detour and Water Gap still includes tertiary/service road sections. These are
explicit quality limitations, not ten accepted trail hikes. See the committed
[compact probe data](hike-planning-probes-2026-10-28.json) for class distances,
unchanged coordinates and full-artifact hashes. Full responses/logs stay on the data disk.

## Application behavior

A→B and ordered stops use the dedicated `hike` profile. There and back reverses
the actual outbound line and recomputes directional Tobler time and gain/loss.
The Breadcrumb “Plan on trails” action makes one undoable edit preserving waypoint
order, then plans through the same provider. Per-leg breadcrumb snapping also
requests `hike`; freehand drawings remain offline. Authored loops with stops use
the patched via router; stock automatic round-trip discovery remains unsupported.

The app samples its returned line at ≤30 m for Terrarium DEM and reuses the domain
Tobler function. Missing DEM has unknown gain/loss and an explicit flat-terrain
time caveat. Road-class distances and remote snaps are displayed in the hike
summary. Unknown road detail remains unknown. Provider errors have typed
`hike-routing-unavailable` and `no-trail-route` results and plain UI copy.
Motorcycle lanes, road scoring, hosted fallback and the offline motorcycle graph
are excluded from hiking. Changing modes cancels requests and hides the other
activity’s answer. The provider registry and health probe report hiking separately.

See [the service recipe and exact copy list](../../../infra/graphhopper/hike-service.md).

## Verification

Pending final gates and real-browser captures; filled in before committing.
