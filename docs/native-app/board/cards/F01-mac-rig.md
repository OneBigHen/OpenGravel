---
id: F01
title: Mac rig: disk space, toolchain, one address, watchdog
assignee: ogv-builder
priority: 95
max_runtime: 2h
contract: pr
---
# F01 · Make the MacBook a dependable build rig (no-sudo parts)

## Read first
ENGINEERING §8 (Machines). Mac: `ssh macbook` from Hermes, user `Zachary`, Intel 2019, macOS 26.4.1, Xcode 26.4.1.

## Goal
The Mac has room to build, has the tools the gates need, is always reached by the same name, and its owner hears about it within 10 minutes if it drops off.

## Steps
1. **Disk.** It currently has about 20 GB free; get it to at least 60 GB:
   - Remove old OpenGravel build folders under `~/dev/opengravel`:
     - `dd-device-*`
     - `ios-app-before-*`
     - `ios-app.pre-ferro`
     - `iphone.bak`
     - `ios-release-20260929-codex`
     - old `*.log`

     Keep `ios-app`, `ogv-resign.sh`, `maestro`, `pmd` and anything the LaunchAgent `rodeo.henning.opengravel.resign` uses. Read the agent's plist first.
   - Delete `~/Library/Developer/Xcode/DerivedData/*`, run `xcrun simctl delete unavailable`, and remove simulator runtimes other than the newest iOS 26.x (`xcrun simctl runtime list`).
   - List anything over 2 GB in the home folder in your handoff. Do not delete the owner's personal files.
2. **Toolchain without sudo**, in `~/dev/bin`, added to PATH for non-interactive SSH via `~/.zshenv`:
   - XcodeGen (latest release zip from GitHub);
   - `xcbeautify`;
   - check that Maestro 2.10 and JDK 21 work from a non-interactive shell (`ssh macbook 'maestro --version'`).

   SwiftLint comes from the SPM plugin, so don't install it.
3. **One address.** On Hermes, set `~/.ssh/config` Host `macbook` to the fixed IP from F00, or to `192.168.1.62` if F00 isn't done yet, using `IdentityFile ~/.ssh/id_macbook`. Add `ServerAliveInterval 30` and `ConnectTimeout 10`. Update `~/bin/wake-mac.py` to read the host from `ssh -G macbook`.
4. **Watchdog.** Write a systemd user timer on Hermes (`ogv-mac-watchdog.timer`, every 5 min). If `ssh macbook true` has failed for 10 minutes, it:
   - sends Wake-on-LAN with `~/bin/wake-mac.py`;
   - if still down, notifies the owner once through Hermes' normal notification channel (look at how other Hermes alerts are sent; don't add a new service);
   - stays silent until the Mac recovers, then sends one "Mac is back" message.
5. **Document it.** Add `docs/native-app/MAC-RIG.md` (under 60 lines): what is installed and where, how to recover after a reboot (FileVault needs the owner), the watchdog, disk housekeeping.

## Scope
Mac home folder, Hermes `~/.ssh/config`, `~/bin`, systemd user units, `docs/native-app/MAC-RIG.md`.

## Acceptance checks
- [ ] `ssh macbook 'df -h /'` shows at least 60 GB available. Paste it.
- [ ] `ssh macbook 'xcodegen --version && xcbeautify --version && maestro --version && xcodebuild -version'` works from Hermes. Paste it.
- [ ] Watchdog test: `systemctl --user start ogv-mac-watchdog.service` runs cleanly. Show a dry run of the alert path with `OGV_WATCHDOG_TEST=1`.
- [ ] The re-sign LaunchAgent still runs (`launchctl list | grep opengravel`).

## Handoff
PR with MAC-RIG.md. The summary includes before and after disk space.
