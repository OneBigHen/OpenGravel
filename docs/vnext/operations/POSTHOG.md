# PostHog and AI-assisted improvement

OpenGravel uses the browser SDK at the app composition root. It stays off until
both the deployment enables hosted telemetry and the rider acknowledges Settings
→ Usage data. Self-host defaults to off. Core flows work without PostHog.

## Deployment

Set these on the build host, then rebuild:

```dotenv
NEXT_PUBLIC_TELEMETRY_MODE=hosted-beta
NEXT_PUBLIC_POSTHOG_PROJECT_TOKEN=<browser project token>
NEXT_PUBLIC_POSTHOG_HOST=https://us.i.posthog.com
```

EU projects use `https://eu.i.posthog.com`. The existing server setting
`TELEMETRY_ENABLED=true` also enables hosted mode unless the public mode explicitly
overrides it. Never put a personal API key in a `NEXT_PUBLIC_*` variable.

Enable session recording and Error Tracking in the matching PostHog project.
The SDK starts replay after acknowledgement; network failures, blockers, project
settings and sampling can still prevent delivery. Confirm recordings in PostHog,
not only that the browser issued a request.

## What is collected

- Selected click/change/submit autocapture, rage clicks and dead clicks.
- Pageviews on planner, Settings, Explore, My rides and Ride Focus.
- Masked session replay, unhandled errors and promise rejections.
- Planning requests, primary readiness, settled alternatives, normalized failures,
  rider route selections and banded workflow timing.
- Build ID, application version and telemetry schema version for every event.

Inputs, DOM text and sensitive attributes are masked; safe UI classes are retained; hidden/file inputs and marked sensitive
sections are blocked. Network bodies/headers, console recordings, clipboard text
and map canvas capture are disabled. Autocapture sends only element structure and
an allowlist of static control identifiers, not arbitrary text, URLs or attributes.
Private/dynamic routes and query/hash-bearing pages stop capture. Event URLs are
replaced with canonical page categories. SDK identifiers are anonymous.
Visitor tier (2026-10-06, owner decision): before acknowledgement only an anonymous
`$pageview` is sent, with a random visitor id kept in localStorage (no cookie, no
person profile), so unique visitors can be counted. Actions, errors, autocapture and
replay still need acknowledgement. Count uniques with `uniq(distinct_id)` on `$pageview`.
Withdrawal stops recording and everything beyond the page visit. Requests
queued while consent was active may finish delivery. Already ingested data is not deleted by withdrawal or Delete all local data.

Error messages are replaced with a generic description; static JavaScript stack
locations are retained for grouping and debugging. Messages can contain
coordinates, provider bodies or rider text. Use local logs/reproduction for exact
error details. Precise latency percentiles are unavailable: timings are coarse
bands, by policy. Map canvas playback is unavailable in this configuration.

Planner, drawing (start/done/failed), advisor (requested/ready/applied/discarded),
ride start/completion, GPX export and file import are instrumented. Reroute,
off-route, free-ride suggestion and route-edit events have vocabulary but no
emitters yet. Do not treat missing events as zero usage. LLM prompt,
response and token/cost tracing is not enabled; it needs a separate redaction design.
Feature flags, experiments and surveys do not influence route decisions.

## Start with three views

1. Planning funnel: `planner_opened` → `route_plan_requested` →
   `route_primary_ready`, broken down by `buildId`.
2. Failure trend: `route_plan_failed` by `errorClass` and `buildId`. Compare
   failed attempts with requested attempts, not total autocapture volume.
3. Slow planning: `route_primary_ready` by `latencyBand`; open associated replays
   to understand repeated clicking, dead clicks or confusing UI.

Use production build filters and exclude your smoke/test builds. Consent affects
coverage; these reports describe acknowledged visitors, not every rider.

## AI access and automation

The deployed host has authenticated PostHog MCP configured and pinned to project
571923. API queries and the MCP handshake/tool discovery were verified during
setup. Open a new Codex session to load the updated connection; the existing
session does not automatically gain newly configured tools. Private credentials
are stored outside the repository and browser bundles.

The [app improvement dashboard](https://us.posthog.com/project/571923/dashboard/2171687)
contains the four starter insights. `ogv-posthog-report.timer` runs daily around
11:00 UTC and writes a read-only 24-hour aggregate report to
`/var/lib/opengravel/analytics/latest.json`. The first run is verified separately
in release evidence. The source is `scripts/posthog-report.py`; its credentials
come from `/etc/opengravel/posthog-admin.env`. `ogv-posthog-triage.timer` (11:30 UTC) then runs `infra/posthog/triage.sh`: a
headless Sonnet agent with the PostHog MCP reads the report and files deduplicated
`posthog-triage` issues on GitHub (max 3/day, evidence + repro + test idea), and may
open a *draft* PR for a small, test-covered fix. It skips entirely (no model spend)
when the report is empty, never merges, deploys, or touches routing/consent/secrets.
Logs: `/var/lib/opengravel/analytics/triage-<date>.log`. Install/refresh the units
with `sudo infra/posthog/install.sh`; pause with `systemctl disable --now ogv-posthog-triage.timer`.

Useful prompts:

- “Compare planning failure rates for the latest build with the previous build.
  Give counts, time window and sample size, then suggest reproduction steps.”
- “Which controls receive repeated/dead clicks? Correlate with masked replays
  and propose the three most useful UX fixes.”
- “Which latency bands worsened after release? Separate routing failures from
  successful but slow plans.”

A useful automation is a daily findings report with build IDs, counts, links to
insights/replays and suggested regression tests. Analytics are evidence for a code
change; they are not authority to mutate routing policy or deploy a fix. A human (or
the normal repo flow) reviews and merges every triage PR.

Sources: [capture API](https://posthog.com/docs/api/capture),
[replay privacy](https://posthog.com/docs/session-replay/privacy),
[PostHog MCP](https://posthog.com/docs/model-context-protocol).
