# OpenGravel for iPhone: the native app plan

Status: agreed direction, 2026-10-10. This is the plan of record for the native app. Task cards, reviews and workers read it first.

## 1. The goal in one paragraph

OpenGravel becomes the best way for a motorcyclist to find and ride great roads: an iPhone app that plans curvy, backroad and gravel rides, shows them on the most beautiful map we can make, and guides the rider turn by turn with the phone on the handlebar. The routing brains already exist in this repository's server. The app is a native SwiftUI front end for them. Planning on a laptop stays on the web, and rides planned there appear on the phone.

## 2. Decisions

| Topic | Decision | Why |
|---|---|---|
| Platform | iPhone only, native SwiftUI | The best possible feel on one platform beats two average ones |
| Fork CoMaps or OsmAnd? | **No.** Build a new app from proven parts | A fork is a general maps app we would have to strip out and keep merging. Our value is the routing and rider UX, which no fork has |
| Map engine | MapLibre Native iOS (6.10+), BSD | Same style language as the web map, reads PMTiles files directly, free |
| Turn-by-turn | Ferrostar (already in `apps/ios/OpenGravelNavigation`, pinned 0.57.0) | Already integrated and tested here. Every navigation view can be replaced with our own SwiftUI |
| Backend | This repository's existing server and GraphHopper | It works. The app is a new client, not a rewrite |
| Web app | Frozen as the laptop planner: bug fixes, "Send to phone" and the shared map style only | All new design effort goes to the app |
| Laptop to phone | Pair once by QR code, then rides sent from the laptop appear on the phone. No accounts | Builds on the existing `shares` endpoints |
| Maps | Our own style on free, self-hosted OpenStreetMap vector tiles (PMTiles) plus free elevation tiles for hillshading | Free forever, fully controlled look, and the same files become offline downloads later |
| Distribution | Self-signed now, TestFlight once the $99 Apple Developer account exists, App Store later | Free signing expires every 7 days and cannot get the CarPlay permission |
| License | Stays AGPL-3.0 and open source | The owner holds the copyright, so the App Store is possible later |
| Borrowed code | Permissive only: CoMaps (Apache-2.0), MapLibre, Ferrostar, valhalla-mobile (MIT) | GPL code (OsmAnd, Vela) conflicts with App Store terms. Use those as design references only |
| Reverse-engineered apps | Frozen. Used only as UX reference through a one-page digest per app | Their code is not ours to copy, and more decompiling will not make our app better |

## 3. How the app fits together

```
iPhone app (SwiftUI)                         Server (this repo, unchanged core)
├─ Map: MapLibre Native + OpenGravel style   ├─ /api/route-plan     GraphHopper + scoring
│    ├─ basemap PMTiles  ───────────────────►│  /api/catalog, /api/discover
│    ├─ elevation PMTiles (hillshade)        │  /api/places/along, /api/map-layers
│    └─ rider layers (curvy, gravel, closures)│ /api/geocode, /api/weather
├─ Plan, Explore, My rides screens           │  /api/shares (send to phone)
├─ Ride: Ferrostar session (existing pkg)    │  /api/offline/regions (v1.1)
├─ Live Activity, later CarPlay and Watch    └─ ...
└─ Generated API client (from one OpenAPI file)
```

Rules:

- **One contract.** The endpoints the app uses are described in one OpenAPI file in this repository. The Swift client is generated from it with Apple's swift-openapi-generator, and a server contract test checks that the real responses match it. Nobody hand-writes networking code.
- **The server stays the routing authority.** The core invariants in `CLAUDE.md` still apply: unknown is never shown as safe, open or paved, and AI never sets geometry.
- **Rerouting while riding** goes through `/api/route-plan` when there is signal. Offline rerouting arrives with offline regions in v1.1.
- **No screen file over 400 lines**, enforced by SwiftLint, so no screen can grow into a 2,500-line file the way the web planner did.

The new Xcode project lives in `apps/iphone/` and depends on the existing `OpenGravelNavigation` package. The Capacitor shell in `apps/ios/` keeps working until the native app reaches parity, then retires.

## 4. Version 1

**In v1**

1. **Plan:** start, destination or loop, ride style (curvy, backroads, surface), route choices compared honestly, drag to reshape.
2. **From the laptop:** pair once, and rides planned on the web appear in My rides.
3. **Explore:** the route catalog on the map, with filters and nearest first.
4. **Ride:** full-screen map on the handlebar, turn-by-turn with spoken prompts (phone speaker or helmet headset), rerouting, lock-screen Live Activity and Dynamic Island.
5. **My rides:** saved and recorded rides, GPX in and out.
6. **Along the ride:** gas and food stops drawn on the map, without a briefing screen.
7. **Weather glance:** one line ("Rain likely after 3 PM on your route"). The endpoint already exists. Cut it if it costs more than a day.

**v1.1:** offline map and route downloads (the server already has `/api/offline/regions`), CarPlay, Apple Watch turn haptics.

**Not planned:** group rides, fuel briefing, accounts.

## 5. The riding screen (most of the design effort)

The phone sits on the handlebar with the map on. Requirements:

- Readable at a glance in direct sunlight. A high-contrast day style and a dark style, switching automatically.
- Every tappable thing at least 60 points, usable with gloves. Nothing that needs precise taps while moving.
- The next turn, its distance and the road name readable from arm's length. Big type, few words.
- Screen stays awake while riding. Manage heat: a mounted iPhone charging in the sun throttles and dims, so the dark style, a lower frame rate when nothing moves, and no needless GPU work matter.
- Portrait and landscape mounts both work.
- Spoken prompts say road names and work through a Bluetooth headset (Cardo or Sena) without fighting music.

## 6. Maps: beautiful and free

1. **Tiles:** a US extract of free OpenStreetMap vector tiles as one PMTiles file. Host it where egress is free (Cloudflare R2), or on our own server.
2. **Elevation:** free terrain tiles converted to PMTiles, used for hillshading. 3D terrain on MapLibre Native iOS needs checking during the skeleton phase. Hillshade alone already looks great.
3. **Style:** our own "OpenGravel" style, day and night, designed for riders: roads by curviness, gravel visibly different from pavement, hills you can read, quiet labels. The web planner switches to the same style so laptop and phone look identical.
4. **Rider layers** come from the server (`/api/map-layers`): curvy roads, surveyed gravel, closures, seasonal roads.
5. **Benchmark:** every style review puts our map beside Mapbox Outdoors and calimoto at the same place and zoom. We ship when ours wins.

## 7. How work gets done

**Roles**

| Who | Does |
|---|---|
| Owner | Picks the look from screenshots, rides the TestFlight build, reports what felt wrong |
| Opus lead | Writes task cards, guards this plan, final review and merge |
| Opus reviewer | Reviews every worker branch: diff, screenshots, gate results. Rejects anything that misses the card |
| DeepSeek V4.1 Flash workers (OpenCode) | Implement task cards in their own git worktrees. Screens, components, server endpoints, tests, digests |
| Codex Sol (one at a time) | Hard parts: Ferrostar session wiring, map style performance, offline downloads |

**Task cards.** Each task is one small card: what to build, the files involved, the acceptance checks, and the screenshots expected. One screen or one component per card. Workers get the card and the files it names, not the whole repository.

**The Mac build queue.** iOS code only builds on the Mac. A `mac-gate <branch>` script on docker-dev pushes the branch, runs the gates on the Mac under a lock (one build at a time), and returns the results and screenshots. Several workers can write code in parallel, but builds queue. Keep at most 3 DeepSeek workers active.

**Definition of done (every card):**

1. Builds on the Mac with no warnings added.
2. Unit tests pass.
3. Snapshot tests for every changed screen: light, dark, largest text size, landscape.
4. The Maestro flow for that screen passes.
5. Xcode's accessibility audit passes.
6. Navigation changes: a recorded GPX ride replayed in the simulator completes without errors.
7. Screenshots attached to the pull request.
8. The reviewer approves against the card and the design spec.

The gates are the evidence. A model's opinion is a pointer to where to look, never proof.

**Real rides.** Each TestFlight build gets a real ride and a short checklist: heat, sunlight, gloves, prompts, rerouting, battery used per hour.

**Token guardrails**

- Pull request descriptions: about 10 lines and screenshots. No long build-state reports.
- The reviewer reads the diff and the screenshots, not the whole codebase.
- A card that fails the gates twice goes back to the lead to be re-scoped instead of being retried.
- The server's routing experiments (frontier, Jev, probe work) are paused. The app consumes `/api/route-plan` as it is.

## 8. Phases

Each phase ends with something the owner can see.

**Phase 0: Foundations**

- The Mac becomes the always-on build machine: never sleeps, fixed address, watchdog alert, `mac-gate` script.
- Apple Developer account (decision pending).
- `apps/iphone/` project with SwiftLint, the snapshot test harness, Maestro and the design tokens folder.
- The OpenAPI contract for the endpoints listed in section 3, plus the generated Swift client.
- Opus audit of the server: what the app keeps as is, what needs a slimmer mobile response, what to retire.

*Exit:* an empty app builds, installs on the iPhone and passes every gate through `mac-gate`.

**Phase 1: Design**

- A one-page digest per reverse-engineered app: what it does better than us, with screenshots.
- The design system: colors, type (one of the approved fonts), spacing, glove-sized controls, map palette.
- A screen-by-screen spec for v1, with mockups.
- Three candidate map styles, shown beside Mapbox Outdoors for the owner to choose from.

*Exit:* the owner picks a look and signs off the spec.

**Phase 2: Skeleton you can ride**

- The app shell, the chosen map style on self-hosted tiles with hillshade.
- Plan A to B through `/api/route-plan`, then ride it with the existing Ferrostar package.
- GPX replay test.

*Exit:* a real ride planned and navigated with the native app.

**Phase 3: v1 screens**

- Plan, Explore, Ride, My rides, pairing and Send to phone, places on the map, weather glance, Live Activity.
- Each one is a set of cards run in parallel.

*Exit:* every v1 item in section 4 works on the phone.

**Phase 4: Polish on real rides**

- Real-ride checklist rounds, sunlight and heat tuning, accessibility, performance (smooth map, battery per hour).

*Exit:* two consecutive real rides with no issues on the checklist.

**Phase 5: TestFlight beta**

- Wider testers, then v1.1 (offline, CarPlay, Watch), then an App Store decision.

## 9. Risks

| Risk | Plan |
|---|---|
| The 2019 Intel MacBook is slow and drops off the network during heavy builds | One build at a time through `mac-gate`. A used M1 or M2 Mac mini is the upgrade when the queue becomes the bottleneck |
| DeepSeek writes weaker Swift than TypeScript | Small cards, a shared component library, strict gates, hard parts to Codex |
| Ferrostar is pre-1.0 | Stay pinned and upgrade on purpose, with the GPX replay test as the check |
| Tile hosting bandwidth | PMTiles on free-egress storage. Watch usage before inviting testers |
| Free signing expires every 7 days | The existing 6-hourly re-sign job until the developer account exists |
| Scope creep from the large server codebase | Server work only when an app card needs it |

## 10. Open questions for the owner

1. The $99/year Apple Developer account, for TestFlight, CarPlay and Xcode Cloud. Recommended.
2. Keep the weather glance in v1? Default: yes, if it stays under a day.
3. Mac fixes: FileVault on or off, a fixed address in the UniFi router, and a battery charge limiter.
