# Native CarPlay navigation

Status: implementation scaffold complete; Apple entitlement still required  
Date: 2026-09-30

## Decision

CarPlay is **not** a second navigator.

OpenGravel has one native navigation authority:

    OpenGravelNavigationCoordinator.shared
                    |
        -------------------------
        |           |           |
        v           v           v
      iPhone    Live Activity  CarPlay
      native       / Island     renderer

The same FerrostarCore owns:

- GPS/location
- route progress
- spoken guidance
- off-route state
- active OpenGravel route
- mid-ride route replacement

CarPlay only renders that state through Apple's CarPlay templates plus FerrostarCarPlayUI.

## Why this is the right seam

The current iOS package already pins Ferrostar 0.57.0 and already links:

- FerrostarCore
- FerrostarMapLibreUI
- FerrostarSwiftUI
- FerrostarCarPlayUI

Ferrostar 0.57 includes:

- CarPlayNavigationView
- CPTrip.fromFerrostar
- NavigationState.updateEstimates
- CarPlayMapButtons

The app was therefore missing scene wiring, not a navigation SDK.

## Files added

- OpenGravelCarPlayModel.swift
- OpenGravelCarPlayNavigationView.swift
- OpenGravelCarPlaySceneDelegate.swift

Info.plist now declares the CarPlay scene role alongside the ordinary phone scene.

## System ownership

### Start on phone, connect CarPlay later

The CarPlay model observes the existing coordinator.

When a selected OpenGravel route is already active:

1. use the coordinator's existing Ferrostar Route;
2. create a CPTrip;
3. start a CPNavigationSession;
4. feed Apple's system maneuver/travel-estimate UI from the same NavigationState.

No route request is made.

### Start while CarPlay is connected

When the Capacitor/native bridge starts the coordinator, CarPlay observes the active payload/state and creates its system navigation session.

Again, CarPlay does not select or calculate a route.

### Disconnect CarPlay

Disconnecting the cable/vehicle cancels only the CarPlay presentation session.

The phone's OpenGravelNavigationCoordinator remains active:

- GPS continues
- voice continues
- recording continues
- Live Activity continues
- reconnect may attach to the same route again

### Cancel from CarPlay

An explicit CarPlay navigation cancel is a rider action.

That stops the shared OpenGravel navigation coordinator, so phone and CarPlay cannot disagree about whether the ride is active.

## Mid-ride reroute

OpenGravel already owns rerouting.

replaceRoute(payload:) swaps a newer planning generation into the existing FerrostarCore without restarting device location or voice.

P0 CarPlay behavior:

1. shared coordinator replaces the route;
2. CarPlay observes the new route identity;
3. the old CPNavigationSession is finished;
4. a new system session starts over the already-running shared core.

This preserves navigation authority but may visually reset CarPlay's system route session for a reroute.

### Future refinement

Apple's newer CarPlay APIs expose updated-route/route-segment resume operations.

Do not depend on beta/current-OS-only APIs in the first implementation.

Once OpenGravel raises its deployment target and those APIs are stable, replace the P0 system-session refresh with native CarPlay route-resume semantics.

The core OpenGravel/Ferrostar session should still remain untouched.

## Moving controls

Keep CarPlay intentionally sparse.

Initial map buttons:

- mute/unmute
- route overview / recenter

Do not add:

- layer pickers
- route-profile controls
- POI browsing while navigating
- stat customization
- manual waypoint editing
- Free Ride browsing panels

The road and next maneuver are the product while moving.

## Free Ride

Do not surface arbitrary Free Ride cards directly on CarPlay.

The shared attention policy should first decide whether an opportunity deserves interruption.

A later CarPlay adapter may represent one accepted/high-confidence opportunity as a navigation alert or other Apple-supported navigation surface.

No custom overlay should compete with the maneuver UI.

## Map

FerrostarCarPlayUI renders the same OpenGravel basemap style as the native phone screen.

CarPlay's CPMapTemplate owns interaction overlays. Apple's base-map contract means custom touch controls must not be placed directly into the map view.

## Entitlement blocker

Code and Info.plist scene configuration are not enough to run a CarPlay navigation app.

The signed app must receive and enable Apple's CarPlay maps/navigation entitlement:

    com.apple.developer.carplay-maps

OpenGravel currently has no app entitlements file, so this PR deliberately does not fabricate or wire a signing entitlement the Apple Developer account has not received.

After Apple approval:

1. create the app entitlements file;
2. add com.apple.developer.carplay-maps = true;
3. set CODE_SIGN_ENTITLEMENTS for the App target;
4. regenerate/provision a profile containing the entitlement;
5. test in Apple's CarPlay Simulator;
6. test route start, route replacement, disconnect/reconnect and cancellation on hardware.

## Acceptance tests

### C1 — attach during active ride

- start route on phone
- connect CarPlay
- same active route appears
- current maneuver and ETA appear
- no second route request occurs

### C2 — phone route replacement

- intentionally leave route
- OpenGravel creates a newer route
- native phone screen stays active
- CarPlay moves onto the replacement
- no return to the original starting point

### C3 — disconnect

- disconnect CarPlay mid-ride
- phone navigation continues
- voice continues
- recording continues
- reconnect attaches to current route/progress

### C4 — cancel on CarPlay

- cancel navigation using CarPlay
- shared navigation ends once
- phone does not continue showing a phantom active route

### C5 — stale GPS / off route

- CarPlay keeps consuming the shared coordinator state
- no independent CarPlay rerouter starts
- OpenGravel remains the only rerouting authority

## Product bar

CarPlay should feel simpler than the phone, not like the phone mirrored onto a dashboard.

The best outcome is:

- current road
- next maneuver
- distance/time
- map context
- mute
- overview/recenter

Everything else stays on the phone when stopped.
