---
id: S07
title: Install the native app on the owner's iPhone (free signing)
assignee: ogv-builder
parents: [S03, F03]
priority: 75
max_runtime: 2h
---
# S07 · On the real phone

## Read first
The macbook-wake notes in `docs/native-app/MAC-RIG.md`, `~/dev/opengravel/ogv-resign.sh` on the Mac, and the existing LaunchAgent `rodeo.henning.opengravel.resign`.

## Build
- `mac-gate --install-iphone <branch>` builds Debug for a device, signs it with the free Personal Team (`PKTSAV4JSX`), and installs it with `xcrun devicectl device install app`.
- Extend the 6-hourly re-sign LaunchAgent so it also re-signs and reinstalls `rodeo.henning.opengravel.native` from the last installed build. This is a separate script, `ogv-native-resign.sh`, so the Capacitor flow is untouched.
- Keychain rule: unlock in the same SSH session as `xcodebuild` (see MAC-RIG.md). If the keychain password is needed, block with `needs_input`; never store it.
- `docs/native-app/INSTALL.md`: how the owner gets updates, what to do if the app shows "untrusted developer".

## Acceptance checks
- [ ] The app launches on the owner's iPhone. Attach a device screenshot via `~/dev/opengravel/iphone shot` or `pymobiledevice3`. If the phone isn't connected, block with `needs_input` and say exactly what the owner must do.
- [ ] A run of the re-sign script shows both apps re-signed. Paste the log.
