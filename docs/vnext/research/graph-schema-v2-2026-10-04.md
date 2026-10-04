# Router graph schema v2 (design, 2026-10-04)

Step 4 of `routing-stack-decision-2026-10-04.md`. Freeze every graph-level field before the next PA/NJ
rebuild so it happens once. Live config: `switchback/infra/graphhopper/config.yml` (GraphHopper 11,
LM on `motorcycle_fastest`/`twisty`/…; no CH).

## Today

`graph.encoded_values: car_access, car_average_speed, road_access, road_class, road_environment,
curvature, toll, max_speed, surface, smoothness, track_type, urban_density, country`

`import.osm.ignored_highways: footway, construction, cycleway, path, steps`

Smoothness and track type are already in the graph, yet the custom models do not use smoothness.

## Add

| Value | Kind | Source | Why |
|---|---|---|---|
| `og_curve` | decimal 0–1, 4 bits | **New TagParser** reading `og:curve` written by a PBF pre-pass | Franco-local curvature per edge (below). Replaces `curvature` (beeline/length) in the profiles. |
| `og_access` | enum: KNOWN_OK, AMBIGUOUS, SEASONAL_CLOSED, PROHIBITED | **New TagParser** reading `og:access` from the pre-pass | Gravel Atlas, forest-road calendars, closure evidence. Unknown stays AMBIGUOUS (never "safe"). |
| `average_slope`, `max_slope` | built-in | `graph.elevation.provider: srtm` (or the Terrarium tiles we already serve) | Elevation interest and steep-dirt difficulty. |
| `lanes` | built-in | OSM `lanes` | Separates real backroads from wide secondaries in road character. |
| `mtb_rating` | built-in | OSM `mtb:scale` | A cheap technical-difficulty signal on tracks. |

Drop `path` from `ignored_highways` only behind `motorcycle=yes|designated` access. A separate
`og:access` pass handles that, so footpaths never become routable.

## The `og:curve` pre-pass

Runs offline (Python, osmium) on the PA/NJ extract, after the existing Gravel Atlas extraction:

1. Join OSM ways into road collections by name/ref across degree-2 nodes (Franco's own approach), so a
   curve that crosses a way boundary is not lost.
2. Score every vertex with Franco's radius bands (175/100/60/30 m → 1/1.3/1.6/2), the noise filter and
   junction-corner suppression. This is the same maths as `src/domain/geometry/franco-curvature.ts`;
   port it to Python and pin both with shared fixtures, so the app and the graph agree.
3. **Local, not road-level.** Per output way segment (split at GraphHopper's junctions), take weighted
   curve metres / segment length and smooth it over a 400 m window along the collection. A road with
   half a mile of switchbacks between straight miles lights up only around the switchbacks.
4. Write `og:curve=<0..1>` (quantised to 1/15), splitting ways where the value changes by ≥ 2 steps.

## Profiles (LM constraint)

LM clamps request-time priority above 1, and LM weights are prepared per profile. So curves are
expressed in the **baked** profile by *penalising dull edges*:

```json
{ "if": "og_curve < 0.15 && road_class != MOTORWAY", "multiply_by": "0.7" },
{ "if": "og_curve < 0.4", "multiply_by": "0.85" }
```

Guard rails against bend farming (routes zig-zagging through side streets to collect bends):
`urban_density != RURAL` ×0.6, `road_class == RESIDENTIAL || SERVICE` ×0.5, and `distance_influence`
kept so detours cost something. The 1.35× Curvy cap and the app-side ranking still apply.

ADV profiles (step 5) use `surface`, `track_type`, `smoothness`, `mtb_rating`, `max_slope` and
`og_access`: hard block for PROHIBITED and SEASONAL_CLOSED, a penalty for AMBIGUOUS, and a
difficulty envelope per bike class (street / adventure / dual-sport, as the OsmAnd off-road project
does). The feature list follows BRouter/OsmAnd; the weights are ours, calibrated on the corpora.

## Build and rollback

- GraphHopper extension: two `TagParser`s plus their `EncodedValue` registration, kept in
  `infra/graphhopper/ext/` and built into the jar on powerplex. This is the standard GraphHopper
  extension pattern; no core patches.
- Build on powerplex (`~/ghbuild`): pre-pass, then import, then LM. Keep the current
  `graph-cache-rollback-*` convention.
- Promote under a new policy version only after the step 7 gates pass.

## Open questions (decide before building)

1. Elevation source: SRTM (GraphHopper built-in, 30 m) or our Terrarium tiles (needs a provider class).
   Default: SRTM.
2. Seasonal closures change through the year. Bake them in (rebuild per season) or apply them per
   request? LM only clamps bonuses, so request-time penalties and blocks still work. Default: per
   request, using the existing avoid machinery; bake only PROHIBITED.
