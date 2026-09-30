# Pennsylvania traffic cameras

This is the implementation note for the **Traffic cameras** map layer.

## Goal

OpenGravel should show the cameras that matter to the rider, not build a camera wall. When the layer is enabled, the server enumerates the Pennsylvania camera catalogue, keeps a short-lived cache, and sends only cameras inside the current bounded map view to the browser. Tapping a marker opens the normal map-layer card with the current image.

The feature is intentionally provider-neutral at the application/UI boundary. Pennsylvania is the first adapter; New Jersey, Maryland, Virginia and other 511 feeds can later emit the same `InfoFeature.media` contract.

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

Phase 1 in this PR stops at **current-image playback**: the selected camera image refreshes in the card, and video-capable cameras link to the official 511PA camera page. The media contract already contains `playbackUrl` so video can be added without changing MapLibre or map-layer state.

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
- Video-capable cameras show **Open live camera** to 511PA until in-card HLS relay is complete.
- No camera requests are made while the layer is off.
- No video requests are made until the user explicitly opens a camera.

## Follow-up

- Verify the public PennDOT ArcGIS camera layer's URL/ID mapping and make it the primary metadata/discovery adapter.
- Add the one-camera HLS relay behind `PA511_VIDEO_ENABLED=1`.
- Add clustering when dense urban views become noisy.
- Add camera-near-route mode so a planned ride can show only cameras within a corridor.
- Add provider health metrics and stale-image detection.
- Add NJ 511 and neighboring states using the same media contract.
- Prefer the official PennDOT feed adapter when credentials/license approval are available.
