---
id: F00
title: Owner setup: Mac power, fixed address, accounts
blocked: true
priority: 100
---
# F00 · Owner setup checklist (owner does this; complete the card when done)

Workers cannot do these: they need a password, the router, or an account decision.

## On the MacBook (Terminal, about 5 minutes)
1. Keep it awake on power, even with the lid closed, and restart after a power cut:
   ```bash
   sudo pmset -c sleep 0 disksleep 0 standby 0 powernap 0 womp 1 tcpkeepalive 1 autorestart 1
   sudo pmset -a disablesleep 1
   ```
2. Leave it on the charger and the dock with the network cable.
3. Optional but recommended: install AlDente (free) and cap the charge at 80 % to protect the battery.
4. FileVault is **on**. That is safer, but after any restart the Mac waits for your password before Hermes can reach it. Keep it on and accept that, or turn it off in System Settings → Privacy & Security. Write your choice in the completion summary.

## On the UniFi router
5. Give the Mac's wired adapter `4c:56:df:20:3d:73` a fixed address, for example 192.168.1.61. It has been seen at .61, .62 and .239.

## Accounts and decisions
6. Apple Developer Program ($99/year): yes or not yet? This unlocks TestFlight, no 7-day re-signing and CarPlay. It can wait until Phase 5.
7. Map tile hosting: is a Cloudflare R2 bucket OK (free egress)? If yes, create the bucket `ogv-tiles` and an API token limited to it, and store it on Hermes at `~/.hermes/secrets/r2-ogv-tiles.env` (`R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`). If not, card D02 serves the tiles from the existing OpenGravel server instead.

## Complete
```bash
hermes kanban --board opengravel-ios complete <this-task-id> --force --summary "F00 done: pmset set, IP 192.168.1.61 reserved, FileVault=<on|off>, dev account=<yes|later>, tiles=<r2|server>"
```
