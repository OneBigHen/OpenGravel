# GraphHopper deployment assets

Version-controlled custom models for the self-hosted GraphHopper 11 baseline
(06-ROUTING-AND-DECISION-ENGINE §2: "custom models remain version-controlled").

Source: `OneBigHen/switchback@06785c00e2ad9b51d12b1a4bb6c655ebb0f606c7`,
`infra/graphhopper/custom-models/` — copied byte-for-byte (verified by SHA-256
below). The legacy baseline is read-only evidence for this port; the engine
configuration moves with the deployment, not with the application source.

## Why these files exist

They are the **deployment-side** half of the profile story. A request names an
engine profile (`motorcycle_fastest`, `motorcycle_twisty`, `motorcycle_scenic`,
`motorcycle_adventure`) and the router resolves that name to one of these
custom models at graph-import/startup time. The application never ships a
profile's weights per request: request-time custom models
(`src/infrastructure/routing/graphhopper/request-builder.ts`) express only the
rider's explicit constraints — avoid areas, toll/highway policy, road spans and
supplied surface rules.

| Profile name requested by the adapter | Deployment custom model |
| --- | --- |
| `motorcycle_fastest` | `motorcycle-fastest.json` |
| `motorcycle_twisty` | `motorcycle-twisty.json` |
| `motorcycle_scenic` | `motorcycle-scenic.json` |
| `motorcycle_adventure` | `motorcycle-adventure.json` |

`motorcycle-base.json` is the shared access/roughness base the profile models
are authored against, and `prefer-curvature.json` is an optional curvature
preference model. Both are carried unchanged so the deployment can be rebuilt
identically.

## Integrity

| File | SHA-256 (identical in the baseline unless marked changed) |
| --- | --- |
| `motorcycle-adventure.json` | `45637ee2c081d3ffbaefaace2c823c476c449ffd1d1e07127b1f5a083e20a674` (changed 2026-10-04) |
| `motorcycle-base.json` | `14438caaacd94f7431d4e86db77fe6f8cdd8d76483c4d104d25204b4c58dbbea` (changed 2026-10-04) |
| `motorcycle-fastest.json` | `dc0e507b1469a8c68736d55de8f8e9d10abfbc89a8f83aac730d6e261fc87d2c` |
| `motorcycle-scenic.json` | `e8455809dfdfc10490122624c60a2e01f367e5c3975595c4127cd52edcbeff29` |
| `motorcycle-twisty.json` | `8c92480a971446a485b67c3997aab88fe5a3dea24e69c86491fce5f408204e47` |
| `prefer-curvature.json` | `b1611dd890d2a9e737892cd568b0e49f58e278f0e5e9606d8335986582ed07ff` |

The live verification in `tests/real-router/graphhopper-live.test.ts` runs
against a router loaded with exactly these models over the Pennsylvania graph.

## Honest speeds (2026-10-04)

Adventure used to limit speed to `0.82 * car_average_speed`, and the twisty and
scenic base to `0.9 *`, to make paved roads less attractive. That also made
every ETA a rider saw 10-18% slower than the road allows. The factor now sits in
`priority` (`if: true, multiply_by: 0.82` / `0.9`) and the speed is the real
`car_average_speed`. GraphHopper weighs an edge by time / priority, so road
choice stays the same while times shrink to the truth. Changing a profile
changes its hash, so the graph and landmarks must be re-imported; build it on
the Windows PC, not docker-dev.
