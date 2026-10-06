# My Rides GPX upload and group publishing

Base: `b0762685eebbd2ae85bdd25376eff8cfe14685b6` (public OpenGravel main).
Branch: `fix/my-rides-gpx-sharing`. The implementation commit containing this
report is the review head. Work was isolated from the unrelated dirty VNext
checkout. No production service, existing private ride, or public listing changed.

## Behavior and ownership

- My Rides presents an ordinary GPX/KML/KMZ uploader. The older SwitchBack
  migration importer remains behind an advanced disclosure, including its
  provenance and deduplication behavior.
- Imports stay private in the browser. Public publishing is a separate action
  on a saved ride; it never replaces the private original or changes the planner.
- The public editor supports a separate title, notes, up to three raster photos,
  endpoint hiding, additional distance trimming, coordinate rounding, and a
  preview of the exact geometry submitted. Default endpoint hiding is 500 m
  at each end. Trimming cannot hide private locations in the middle of a route.
- Disconnected source segments require explicit selection of one continuous
  segment. No synthetic connector is published. Original timestamps, waypoints,
  and source bytes are excluded from the public request.
- The public detail uses the existing moderated comment flow. Route uploads
  retain existing immediate group-listing behavior and unverified provenance.
- The application layer projects exportable saved sources into public segments.
  The server validates publication records and owns bounded photo decoding and
  storage. RideDocument, PlanningSession, RideSession, and PlannerWorkspace
  ownership remain unchanged; no routing provider policy changed.

## Upload protections

GPX 1.0 and 1.1 parsing retains track boundaries and checks hostile XML,
including DOCTYPE/entity rejection and a 500,000-element allocation budget.
Publishing requires same-origin JSON and has a 3 MB streaming byte cap, fatal
UTF-8 decoding, a 10-second read deadline, rate limits, and bounded concurrency.
Names and notes reject markup/control characters; coordinate tuples and public
fields are allowlisted. Maximum public geometry is 20,000 points.

Photos are limited to three JPEG/PNG/WebP images. Client preparation resizes
uploads; the server independently checks signatures, canonical base64, size,
pixel count, format and frame count, then decodes/re-encodes to WebP with a
timeout. Tests verify EXIF/GPS metadata removal. Photos are stored separately
and become unavailable when a route is removed; responses disable caching and
MIME sniffing. Capacity checks and route/photo inserts are transactional.
These controls reduce attack exposure; they are not a guarantee against every
future parser vulnerability or unwanted content visible within a photograph.

## Verification on Node 24.21.0

| Gate | Result |
| --- | --- |
| `npm run lint` | Exit 0; one existing ref-cleanup warning in RidesLibrary |
| `npm run typecheck` | Exit 0 |
| `npm test` | Exit 0; 415 files passed, one skipped; 4,479 tests passed, three skipped |
| `npm run test:architecture` | Exit 0; 8 files, 145 tests passed |
| `npm run build` | Exit 0; production build includes route-photo endpoint |
| Critical GPX sharing, import/export, legacy migration E2E | Exit 0; 16/16 passed, Chromium and WebKit, no retries |
| `npm audit --omit=dev` | Zero known production dependency vulnerabilities |
| `git diff --check` | Exit 0 |

The E2E gate used a fresh production build on its own port, fixture providers,
and isolated storage. It covered 1440×900, 390×844, and 844×390 publishing flows,
private persistence after reload, explicit publication, trim geometry, notes,
actual photo upload/readback from another browser context, comment submission,
GPX 1.0, malicious XML/name handling, original-byte export, and legacy dedupe.

The supplied private GPX was parsed without warnings: 313,847 bytes, one track,
one segment, 3,175 points, with all elevations and timestamps retained. It was
also uploaded and saved in a local production Chromium browser, then previewed
with an extra 1,500 m privacy trim. Defaults plus that trim produced 3,134
public-preview points and changed both endpoints. It was not published. Its
raw bytes, coordinates and screenshots were kept outside tracked files.
Desktop and phone screenshots were inspected; no horizontal overflow occurred.

Standards review: no remaining actionable findings after upload-capacity,
transactional-capacity and removed-photo caching fixes. Spec review: no remaining
actionable findings; confirmed descendant photo controls are disabled while
preparing images, and public estimated/unknown metrics retain honest labels.

## Remaining limits

- No merge, deployment, live-account acceptance, or physical-device verification.
- Browser coverage uses Chromium/WebKit with fixtures, not a physical iPhone.
- Real-router tests were not run: routing providers and route selection were
  unchanged by this work.
- The full dependency audit still reports five pre-existing development-tool
  advisories in the ESLint/micromatch/braces chain. Resolving those requires a
  separate toolchain change; the production audit is clean.
- Earlier intermediate checks had a test written before its implementation,
  an ambiguous alert locator, and one WebKit timeout during concurrent heavy
  checks. The fresh final suite and serialized E2E above supersede those runs;
  no assertions, retry settings, or timeouts were weakened.
