# Hiking acceptance scenarios and evidence checklist

> New planned tests, not claims of passed test coverage. Use beside [QA-MATRIX.md](QA-MATRIX.md) and [HIKING-UX.md](HIKING-UX.md). Every row needs a test name, actual browser/viewport, source fixture or real-provider label, screenshot and observed result.

## A. High-priority regression table

| Scenario | Target behavior | Existing coverage / gap |
|---|---|---|
| HQA-01 Activity choice | User can deliberately reach Hike from Map on supported breakpoint; source activity is visible; switching back is clear and never destroys a source draft | `ActivitySwitch.tsx`, `AppMenu.tsx`; live discovery inconclusive (see RUNTIME-VERIFICATION.md) |
| HQA-02 Hike map point placement | At 393×852 touch, press-and-hold uncovered map region creates start/finish; card does not intercept; keyboard alternative exists | `hike-planning.spec.ts` has phone breadcrumb test.fixme |
| HQA-03 Hike drawing | Draw, Undo, Done, persist/reload. No motorcycle plan request from freehand sketch. Sheet drag does not steal pen/finger gesture | Existing `hike-drawing.spec.ts`; run at 320/393/440 |
| HQA-04 Foot routing and no fallback | A→B/stops/there-and-back go to hike profile, never motorcycle provider. Failure retains authored route/draft and clear copy | Existing `hike-planning.spec.ts` fixture, plus physical/provider smoke required |
| HQA-05 Hike inspector semantics | Desktop selected Hike result only shows foot/trail facts and actions; no "Best ride", bike, traffic, Free Ride or motorcycle Ask | Documented gap at main; new regression needed |
| HQA-06 Explore mode coherence | Hike Explore lists actual nearby trails and map selection; candidate line and detail match source; no false generic Ride filter controls | Current implementation separate list, new test needed |
| HQA-07 No GPS permission | Hiker can search town/park or manually set map center without sharing precise GPS; no false "zero trails" conclusion | New test and likely UI work |
| HQA-08 Filters and counts | Known distance/gain/time filters produce accurate **total** result count, not page count; Show more adds matching rows; unknown data explicitly treated | New unit + browser tests; current paging/filter order is source-risk |
| HQA-09 Trail selection Back | Filter, selected trail, search region, map viewport and list scroll restore on detail/back, including reload/deep-link where supported | New test; Hike Explore local state not currently URL encoded |
| HQA-10 Long-distance system | A local section of a huge named trail is distinguished from full named trail, no 795-mi "local hike" summary | Current handoff gap; fixture needed |
| HQA-11 Multipart trail | Detail shows true disconnected geometry; segment choice can open actual portion; unavailable elevation/plan is explicit, no invented joining line | Current `HikeDetail` disables breadcrumb if `lines.length !== 1` |
| HQA-12 Trailhead | A mapped trailhead/parking point is described with source and uncertainty; copy coordinates works; directions are external only where supported | Current detail lists coordinates only |
| HQA-13 Timing and source | Catalog time/DEM time/one-way planned/there-and-back/recorded time label correctly and agree on source | Data from `HikeExplore`, `useHikeData`, foot plan; new projection tests |
| HQA-14 Snap >300 m and road detour | Selected Hike prominently warns about endpoint gap and road fraction; cannot be mistaken for a contiguous all-trail route | Hike graph probe fixtures available; test field values, not static screenshots alone |
| HQA-15 Offline truth | Saved trail ≠ downloaded map ≠ foot graph ≠ offline guidance. No enabled unsupported Download/Start button | Currently disabled Download; future capability expansion separate |
| HQA-16 Dog/child/difficulty copy | No categorical dog legality or child safety claim from OSM tag or simple heuristic; meaningful “unknown” | Source `HikeExplore` derives kid-friendly heuristic; new content tests |
| HQA-17 Night/accessibility | Full dark map plus readable hillshade/trail; 200% font; 48px browsing controls; map attribution, VoiceOver names | Current map rendering and CSS need actual-device evidence |
| HQA-18 Cross-activity saved data | Hike opened from catalog retains source trail and activity; My rides/library doesn't route it through motorcycle scoring unintentionally | New test; no new persistence schema without migration |
| HQA-19 Active hike | Start/follow/record/end remain **explicitly scoped** to actually-supported functionality, and state persists through GPS/network loss | Future physical/device acceptance, not proven by desktop headless |
| HQA-20 Map and UI unavailable | Catalog list remains usable if tiles fail; foot routing unavailable is not “no trails nearby”; loading and retry are separate | New regression |

## B. Deterministic fixtures to build

**F1 — Close trail route:** One complete LineString, known DEM/length, valid foot-graph path, real selected candidate. Assert source vs planned route roles and preview.

**F2 — Long remote snap:** Foot graph start snaps roughly 600m away. Assert precise warning and map depiction of where the path actually starts; never invent connector.

**F3 — Road-heavy detour:** A 2–5km requested short trail with a much longer returned road-heavy result. It must be shown as unsuitable/problematic (based on explicit threshold policy approved by owner), not marketed as an easy short hike.

**F4 — Multipart trail:** Two disconnected LineStrings, known source record. Show both; action forces meaningful segment selection or honest unavailability. Assert no imaginary line between fragments.

**F5 — Missing facts:** No elevation, no dog info, no trailhead, no photo; cards and filters must still work and not invent suitability.

**F6 — Long national trail:** One named trail thousands of kilometers long, containing a small nearby section. Show full-vs-local distances explicitly; don't truncate geometry without validated segment boundaries.

**F7 — Geolocation blocked:** No local coordinates, but typed map/place search and region move still provide discovery; permission denial not interpreted as empty catalog.

**F8 — Filter edge:** 70 nearby records, 50 first page, first 48 missing measured gain; gain ≤500ft filter still finds matching hikes on later pages. Assert correct count, loading state and Load more behavior. This exposes the current filter-after-slice risk.

**F9 — Hike/Ride crossover:** Save Hike draft, switch Ride, plan a motorcycle route, return Hike. Neither uses the other's candidate, UI labels, graph/profile or original geometry.

**F10 — Offline partial:** Tiles available, foot graph missing, saved track present. Show map/viewable trace but no false offline replanning claim.

Fixture values are illustrative. Put real provenance/expected geometry in source-controlled tests, not invented production data.

## C. Specific Playwright checks

Before any cosmetic rewrite, start with the existing tests:

```bash
npx playwright test tests/e2e/critical/hike-planning.spec.ts
npx playwright test tests/e2e/critical/hike-drawing.spec.ts
```

Then add targeted specs, proposed filenames (subject to current test conventions):

```text
tests/e2e/critical/hike-mode-discoverability.spec.ts
tests/e2e/critical/hike-explore.spec.ts
tests/e2e/critical/hike-trail-detail.spec.ts
tests/e2e/critical/hike-activity-parity.spec.ts
tests/unit/application/hikes/explore-filter-pagination.test.ts
tests/unit/ui/hike-copy-contract.test.ts
```

Do not add brittle snapshots as the only assertion. Test content source/route identity, focus, bounds, URL state, and effect of tapping the actual map. Verify at least one screen on Safari/iOS PWA physically before claiming touch fixed.

### Example explicit geometry assertion

At each supported viewport get `getBoundingClientRect()` for the visible Hike card, primary top search, map action controls, bottom sheet, nav, and map. Assert no **unintended overlap** between tappable controls. The card may visually overlay the map but cannot cover the designated point-placement test coordinate. Validate pointer hit-testing with the real map event, not just bounding boxes.

### Example filter-pagination assertion

Set 60 records in a deterministic API fixture, first 50 with missing elevation, ten late entries matching a strict gain limit. Apply the filter. The UI must not say “0 hikes” forever; either fetch/measure enough candidates to resolve a count or label count as provisional and make further matching accessible. `Load more` cannot be shown solely because unfiltered candidates exist if no matching candidates can become visible.

### Example activity-language assertion

After Hike selected, search every visible heading, action and inspector field. Reject motorcycle-only terms **when used as controls**: `Best ride`, `Free Ride`, `Add bike`, `Curvy`, `Traffic`, `ride style`, `gas ahead`, `Ask about this ride`. Don't reject legitimate named source trails containing terms like “ADV” in a historical source name; that's provenance, not UI chrome.

## D. UX targets to measure

- **Mode discovery:** first-time hiker can identify and switch to Hike through an obvious, named control in ≤2 purposeful actions from idle Map. Existing locked design may require approval for a new top-level indicator.
- **Plan a hike:** after trail selection, user can see the source line, trail start and grade/distance, and can open an editable plan without seeing an internal word “breadcrumb.”
- **Prepare:** no user must infer that a map tile download implies foot routing/alerts; all unavailable capabilities shown honestly.
- **Explore:** filters, map selection, trail detail and Back do not reset the user's working context; first meaningful trail list never depends exclusively on location permission.
- **Reliable mapping:** user can manipulate map points at 320/393/440 widths without overlay interception. Hike route warning is visible at a reasonable glance.
- **Physical safety:** “kid-friendly”, dog permission, access status and hiking suitability are not presented as official or guaranteed when inferred.

## E. Result recording template

```text
Scenario: HQA-XX
Source commit:
Deployment revision (if known):
Browser/device/OS + viewport:
Activity: Ride / Hike
Map provider: real / fixture / unavailable
Route source: catalog id / recorded GPX / fixture / generated
Preconditions: permission, offline, active session, stored mode
Steps:
Expected:
Observed:
Screenshot or trace:
Test pass/fail and failure category:
Remaining physical-provider verification:
```

Every implementation PR should list which scenarios it has **actually executed**. Untested is not green. A screenshot may demonstrate hierarchy, but not prove legal hiking access, valid route geometry or offline behavior.
