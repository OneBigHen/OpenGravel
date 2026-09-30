# Pennsylvania traffic cameras

This is the implementation note for the **Traffic cameras** map layer.

## Goal

OpenGravel should show the cameras that matter to the rider, not build a camera wall. When the layer is enabled, the server enumerates the Pennsylvania camera catalogue, keeps a short-lived cache, and sends only cameras inside the current bounded map view to the browser. Tapping a marker opens the normal map-layer card with the current image.

The feature is provider-neutral at the application/UI boundary. The current regional implementation supports Pennsylvania, New Jersey, New York, Delaware, Maryland, Virginia, West Virginia, and Ohio through the same `InfoFeature.media` contract. The aggregate provider only contacts states whose coarse state bounds intersect the current map view.

## Current regional support

| State | Discovery source | Media | Auth/config |
| --- | --- | --- | --- |
| PA | 511PA catalogue; migrate discovery to PennDOT public ArcGIS | still + tokenized HLS | no key for catalogue; video opt-in |
| NJ | 511NJ public account flow | direct HLS | public-login flow; no user credentials |
| NY | 511NY public CCTV list | still + provider video URL | no user credentials |
| DE | DelDOT TMC camera JSON | direct HLS | no key |
| MD | Maryland CHART camera JSON | direct/public video | no key |
| VA | VDOT 511 camera GeoJSON | direct stream URL | no key |
| WV | WV511 camera GeoJSON | direct HLS | no key |
| OH | documented OHGO Camera API | refreshed still images | `OHGO_API_KEY` required |

Configuration:

```env
TRAFFIC_CAMERAS_ENABLED=1
TRAFFIC_CAMERAS_STATES=PA,NJ,NY,DE,MD,VA,WV,OH
OHGO_API_KEY=

# Recommended for same-origin playback of NJ/DE/MD/VA/WV and can also be
# reused by PA unless PA511_VIDEO_PROXY_SECRET overrides it.
TRAFFIC_CAMERA_VIDEO_PROXY_SECRET=<private random value, at least 24 chars>
```

`PA511_CAMERAS_ENABLED=1` remains supported as a backwards-compatible PA-only switch.

### Same-origin direct-HLS relay

NJ, DE, MD, VA, and WV publish or expose an HLS URL directly from their camera metadata. When `TRAFFIC_CAMERA_VIDEO_PROXY_SECRET` is configured, OpenGravel replaces that external playback URL with a same-origin relay URL only for the selected camera. The relay:

1. reloads/validates the selected state camera by ID;
2. fetches the upstream playlist using the state site's Origin/Referer;
3. rewrites child playlists, keys, init fragments, and media segments through OpenGravel;
4. encrypts/authenticates short-lived upstream resource URLs using AES-256-GCM;
5. forwards range requests and media content types;
6. never preloads or autoplays a wall of streams.

Without the relay secret, the camera card can fall back to the state's direct playback URL where the browser supports it.

## Sources evaluated

### PennDOT public GIS camera inventory

PennDOT also exposes a public ArcGIS REST feature layer for statewide traffic-camera assets:

`https://gis.penndot.pa.gov/gis/rest/services/paprojects/paprojects/MapServer/14`

It is queryable as a standard ArcGIS Feature Layer (JSON/GeoJSON/PBF, 2,000-record page limit) and exposes fields including statewide/district IDs, status, location description, county, state route, latitude, longitude, record update time, and URL.

**Direction:** move camera *discovery/location/status* to this layer once its URL/id relationship to the current 511PA media catalogue is verified. That avoids enumerating the interactive 511PA page just to draw markers. Keep 511PA/DIVAS as the selected-camera media resolver until an official feed adapter is available.

### 511PA public camera site

Current UI: <https://www.511pa.com/cctv>

The camera page is public and exposes the catalogue used by the 511PA site. The adapter in `src/server/map-layers/pa511-cameras.ts` establishes an ordinary page session, reads the anti-CSRF token issued with that page, and then requests the camera catalogue. It does **not** use a PennDOT data-feed API key and does not bypass a login.

This adapter is opt-in with:

```env
PA511_CAMERAS_ENABLED=1
```

PA's DIVAS-backed in-card video is separately opt-in:

```env
PA511_VIDEO_ENABLED=1
# Optional override. If omitted, TRAFFIC_CAMERA_VIDEO_PROXY_SECRET is used.
PA511_VIDEO_PROXY_SECRET=
```

The PA relay resolves only the selected camera, fetches the 511PA/DIVAS HLS playlist on the server, rewrites child playlists/segments back through the same-origin OpenGravel endpoint, and encrypts the short-lived upstream resource URLs with AES-GCM before they appear in browser requests. It does not expose the 511PA session cookie or anti-CSRF token.

The public OpenGravel demo should leave this unset. A five-minute process cache prevents every map pan from re-enumerating Pennsylvania.

### PennDOT data feeds

PennDOT currently says transportation feeds can be requested by the general public, commercial vendors, researchers, media and agencies at no charge. Traffic-camera streaming is separately governed by a Non-Exclusive Video Sharing License Agreement.

Reference: <https://www.pa.gov/services/penndot/request-access-to-transportation-related-data-feeds>

This is the preferred long-term production source because it is explicit, documented and stable. Keep the provider boundary so a licensed feed can replace the web adapter without changing the map UI.

### Open-source references

- <https://github.com/cailinpitt/ClassicTraffic> — current 511PA catalogue behavior and DIVAS/HLS token flow.
- <https://github.com/krismolendyke/PennDOT-Traffic-Camera-API> — older District 6 snapshot model; useful historically, not a current statewide catalogue.
- <https://github.com/bzsasson/traffic-camera-sources> — provider registry/GeoJSON useful as a fallback and for nationwide expansion.

Do not use the old District 6 dump as a live source.

## Playback design

Phase 1 now includes **current-image playback** plus an **experimental, opt-in HLS relay for native-HLS clients (iPhone/iPad/Safari)**. The selected camera image refreshes in the card when video is disabled; when video is enabled, the same card exposes native video controls while retaining the image as its poster. Other browsers can still use **Open live camera** until the hls.js fallback lands.

511PA's current camera page warns that users may view up to eight streams simultaneously and that exceeding that limit causes a one-hour video suspension. OpenGravel should be much stricter: **one active selected camera per client, no background preloading, no camera-wall autoplay.**

For in-card video:

1. Resolve video only after a marker is tapped.
2. Keep 511PA session material and stream tokens server-side.
3. Never resolve streams for every marker in the viewport.
4. Allow at most one active playback session per browser/client.
5. Stop/release playback immediately when the card closes or a different camera is selected.
6. Prefer the licensed PennDOT stream feed when available.
7. If using the public 511PA web flow for a personal deployment, keep it behind a separate explicit feature flag.
8. Do not persist or redistribute captured video.

The current 511PA implementation uses tokenized HLS. The reference implementation in ClassicTraffic obtains a 511PA page session, requests video authorization for the selected image ID, exchanges that material with the PA DIVAS endpoint, and then uses the resulting short-lived token with the camera's HLS URL. A browser cannot reliably consume that by simply exposing the upstream URL because the upstream requests may also depend on 511PA origin/referrer behavior. If we support it, implement a narrowly scoped same-origin HLS relay rather than leaking session cookies/tokens to the client.

## UX

- Layer: **Traffic cameras** under **Live conditions**.
- Minimum zoom: 8.
- Marker weight distinguishes video-capable vs still-only cameras for future styling.
- Tap opens the existing `InfoFeatureCard`.
- Current image refreshes every 10 seconds while the card is open.
- With video relay disabled, video-capable cameras show **Open live camera** to 511PA.
- With video relay enabled, native-HLS browsers get in-card controls; no autoplay and `preload="none"`.
- No camera requests are made while the layer is off.
- No video requests are made until the user explicitly opens a camera.

## Follow-up

- Verify the public PennDOT ArcGIS camera layer's URL/ID mapping and make it the primary metadata/discovery adapter.
- Live-test the one-camera HLS relay against current 511PA streams and harden any provider-specific playlist edge cases.
- Add hls.js only if desktop Chromium/Firefox playback is worth the bundle/runtime cost.
- Add clustering when dense urban views become noisy.
- Add camera-near-route mode so a planned ride can show only cameras within a corridor.
- Add provider health metrics and stale-image detection.
- Live-test each regional adapter and promote only stable sources to default-on in shared deployments.
- Add camera-source health diagnostics per state so one broken feed does not look like an empty map.
- Expand beyond the Mid-Atlantic using the same adapter registry, prioritizing documented public APIs and stable GeoJSON feeds.
- Prefer the official PennDOT feed adapter when credentials/license approval are available.
