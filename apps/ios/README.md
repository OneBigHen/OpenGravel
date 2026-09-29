# OpenGravel for iOS

This directory contains the Capacitor shell and native ride features. The iOS app loads an OpenGravel web deployment; the server URL is configured for each build and is not stored in the repository.

## Build

You need macOS, Xcode, Node.js 24+, and an OpenGravel deployment reachable over HTTPS.

```sh
cd apps/ios
npm ci
```

Set `CAPACITOR_SERVER_URL` to your deployment origin, then sync and open the Xcode project:

```sh
export CAPACITOR_SERVER_URL="https://your-opengravel-host.example"
npm run sync
npm run open
```

The URL's host is the only external host allowed inside the WebView. Use `http://localhost:3000` only for local development. Without a URL, the shell shows its bundled offline page.

For a fork, change the bundle identifier in `capacitor.config.ts` and the Xcode project to an identifier you control. The OpenGravel name and artwork are not licensed for rebranding by the AGPL.

## Native tests

The Swift package tests run in an iOS Simulator:

```sh
cd OpenGravelNavigation
xcodebuild -scheme OpenGravelNavigation \
  -destination 'platform=iOS Simulator,name=iPhone 17 Pro' \
  -skipMacroValidation -skipPackagePluginValidation test
```

Maestro smoke flows are in [`maestro/`](maestro/).
