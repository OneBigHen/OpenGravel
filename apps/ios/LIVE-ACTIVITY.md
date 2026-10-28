# Lock Screen Live Activity (ride, Free Ride, hike)

OpenGravel shows the current ride or hike on the Lock Screen and in the Dynamic Island. Everything is local: the app starts, updates and ends the activity from its own process while it keeps running in the background for location. There is no push server, no App Group and no push entitlement, so a free Apple Personal Team can sign it.

## What was built

A Live Activity for rides already existed in this repo (the `RideActivityWidget` extension, `RideActivityPlugin`, `RideActivityStore`, and the Ferrostar hand-off). Starting a second extension and plugin would have put two activities on the Lock Screen at once, so this work extends that one instead of adding an `OpenGravelLiveActivity` target. The names stay `RideActivity*`.

Three kinds of activity, chosen in `src/application/native/live-activity.ts`:

| Kind | When | Shows |
| --- | --- | --- |
| `guided` | a guided ride (Ferrostar path or web engine) | next maneuver arrow, distance to it, street, ETA, distance and time left, progress bar |
| `free` | Free Ride, recording, or a followed track in ride mode | recording clock (ticks by itself), distance, speed, climb |
| `hike` | following a breadcrumb trail while the planning activity is Hike | distance left, next waypoint and distance to it, ETA when known, climb so far, straight-line distance back to the start, "Off the trail" warning |

Lock Screen card and Dynamic Island (compact leading and trailing, minimal, expanded) share one layout. Big tabular rounded numbers, one context line, the app green (`--og-primary`) as the only accent, cream surface by day and spruce by night. A warning turns the icon and context line red.

### Files

Native, in `apps/ios/ios/App`:

- `RideActivityWidget/RideActivityLiveActivity.swift`: the three layouts.
- `App/RideActivityAttributes.swift`: shared `ContentState` (new `kind`, `warning`, `elapsedSeconds`, `distanceDone`, `speed`, `gain`, `toStart`, `sentAt`; older saved states still decode).
- `App/RideActivityPlugin.swift`: Capacitor plugin `RideActivity` with `isAvailable()`, `isSupported()` (same answer), `start`, `update`, `end`. `RideActivityStore.endAll()` ends every activity.
- `App/AppDelegate.swift`: `applicationWillTerminate` calls `RideActivityStore.endAll()`.
- `App/Info.plist` already has `NSSupportsLiveActivities` and `NSSupportsLiveActivitiesFrequentUpdates`. `App.xcodeproj` already has the extension target (made by `scripts/add-ride-activity-target.rb`), the embed phase and the shared attributes file. No project edits were needed.

Web:

- `src/application/native/live-activity.ts`: the typed port, the state mapper (guided, free, hike) and `createLiveActivitySync`.
- `src/infrastructure/native/live-activity-bridge.ts`: adapter to the plugin; returns `undefined` in a browser.
- `src/app/RideClient.tsx`: feeds the sync from the ride store (view model, navigation, breadcrumb waypoints, activity mode) and ends it when the screen unmounts.
- `src/ui/settings/LiveActivityRow.tsx`, `src/ui/navigation/live-activity-setting.ts`: Settings > Display > "Lock screen Live Activity", default on, app only. Stored in `localStorage` key `og-live-activity` as `"off"` only; included in the clear-all-data list.
- `src/application/ride-session/ride-focus-view-model.ts`: new `climbGainText` (altitude gain from the recording or Free Ride telemetry).

### Update rules

- At most one update every 5 seconds. A new maneuver, a new next waypoint, or a warning appearing or clearing is sent at once. A change that has to wait is sent when the 5 seconds are up (a trailing send), so the last state is never lost.
- The recording clock is a native `Text(timerInterval:)`, so it needs no updates to tick.
- A turn the app speaks also updates with an alert (lights the screen), bypassing the throttle.
- The activity ends when the ride or hike ends, when the rider turns the setting off, when the ride screen unmounts, and in `applicationWillTerminate`.
- While Ferrostar navigates natively, native guidance owns the activity (unchanged); web updates are ignored during that time.

## Build, sign and install (free team)

Use the same flow as the rest of the app (see `README.md`).

```sh
cd apps/ios
npm ci
export CAPACITOR_SERVER_URL="https://your-opengravel-host.example"
npm run sync
cd ios/App
xcodebuild -project App.xcodeproj -scheme App \
  -destination 'generic/platform=iOS' -allowProvisioningUpdates build
```

Both targets, `App` and `RideActivityWidget`, sign automatically with your Personal Team (`DEVELOPMENT_TEAM` is set on the extension to the owner's team; change it for another team). The extension's bundle id is `<app bundle id>.RideActivityWidget`. Install through Xcode or the existing re-sign job. A free team limits the number of App IDs per week; the extension needs one more than the app alone, which is already counted today.

On the phone: Settings > OpenGravel > Live Activities must be on (it is by default). iOS 16.2 or later.

Simulator-only compile check (no signing), as run for this change:

```sh
cd apps/ios/ios/App
xcodebuild -project App.xcodeproj -scheme App \
  -destination 'platform=iOS Simulator,name=iPhone 17 Pro' \
  -skipMacroValidation -skipPackagePluginValidation CODE_SIGNING_ALLOWED=NO build
```

(`capacitor.config.ts` needs TypeScript to run `cap sync`; if the Mac has none, `npm i --no-save typescript` first.)

## Not verified

- Nothing was run on a physical iPhone. No Lock Screen or Dynamic Island screenshot was taken, so the layouts have only been compiled, not looked at.
- Not verified: the free-team signing of the extension on this change, the 5-second throttle against real GPS cadence, whether iOS accepts the update rate, and ending on a force-quit (`applicationWillTerminate` is not called if the app is killed while suspended; the activity then lingers until iOS removes it, at most 8 hours for an update-less activity).
- Elevation left on a hike is not shown: the live ride session has no route elevation profile today (the registry marks `terrain.climbRemaining` as planned).
- Hike ETA only appears when the session already has one; trail pace is not computed here.
- "To start" is a straight line from the rider to the first waypoint, not the walking distance of the way back.
- A Free Ride that does not record has no clock (no recording to read it from); it shows speed and the label.
- A paused recording's clock keeps ticking in the Lock Screen until the next update arrives.
- Which of Hike or Ride mode applies is read from the planning activity setting at update time, not stored with the session.
