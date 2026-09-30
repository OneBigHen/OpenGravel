# Spotify controls

OpenGravel's web ride screen can control playback on a Spotify device through
Spotify's Web API. It does not stream or play audio in the browser. Spotify
playback control requires a Premium account and an active Spotify device.

The server needs a public app client ID and a private cookie encryption key:

```dotenv
SPOTIFY_CLIENT_ID=your-32-character-public-client-id
OGV_SPOTIFY_SESSION_KEY=64-hex-characters-from-openssl-rand-hex-32
OGV_PUBLIC_ORIGIN=https://your-open-gravel-host.example
OGV_SPOTIFY_ALLOWED_ORIGINS=https://your-open-gravel-host.example
```

Generate the private key with `openssl rand -hex 32`. Never put a Spotify client
secret in `.env`, the repository, or the Settings page. The server encrypts the
short-lived PKCE state and the per-browser Spotify session in authenticated,
HttpOnly cookies; access and refresh tokens are never returned to JavaScript.

To use a rider-owned app, create an app in the [Spotify Developer Dashboard](https://developer.spotify.com/dashboard), enable Web API, and add the exact callback URL shown in OpenGravel Settings:

```text
https://your-open-gravel-host.example/api/spotify/callback
```

If Spotify requires user management for the app, add the account that will use
it. Enter only that app's 32-character public client ID in Settings, save it on
the device, and choose **Connect Spotify**. The selected ID is bound to that
browser's encrypted session; it does not change the server's environment or
another rider's account.

This Settings value applies to the browser/PWA. The native iPhone shell uses
its own app registration.

The server must list every public hostname in `OGV_SPOTIFY_ALLOWED_ORIGINS`.
Unknown `Host` values are rejected, so a forwarded or attacker-controlled host
cannot create an OAuth redirect.
