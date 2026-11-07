---
id: T01
title: Owner: Apple Developer Program and App Store Connect key
blocked: true
priority: 50
---
# T01 · Owner: Apple accounts (complete when done)

1. Join the Apple Developer Program ($99/year) with the Apple ID you develop with.
2. App Store Connect → Users and Access → Integrations → create an API key with the App Manager role. Download the `.p8` once.
3. Put it on the Mac at `~/dev/secrets/AuthKey_<KEYID>.p8` (chmod 600), and put the key id and issuer id in `~/dev/secrets/asc.env`. Never in the repo or a card.
4. Create the app record "OpenGravel" for bundle id `rodeo.henning.opengravel.native`.
5. Complete this card with the key id (not the key itself).
