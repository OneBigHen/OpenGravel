---
id: F08
title: Server audit for the mobile app (read-only report)
assignee: ogv-sol
priority: 70
max_runtime: 2h
---
# F08 · Server audit for mobile

## Goal
A short, evidence-backed report the lead uses to decide server cards. Read-only: the only change is the report.

## Answer, with file:line evidence
1. For each v1 endpoint (ENGINEERING §5):
   - response size on a typical request (run the dev server in fixture mode and measure);
   - latency in fixture mode;
   - fields the app will never use.
2. Rate limits, abuse controls and anything that keys on browser behavior (cookies, `X-Forwarded-For` assumptions, consent banners) that would misbehave for a native client.
3. How `/api/route-plan` handles reroute requests from mid-route positions: is there a cheaper path than a full plan? Name it if one exists. Do not build it.
4. Does `/api/offline/regions` already produce something an iOS client could use in v1.1? Summarize what it serves.
5. Server bugs you notice on the way, each with a one-line reproduction.

## Output
`docs/native-app/SERVER-AUDIT.md`, under 150 lines, as a PR. End with a ranked list of at most 5 recommended server cards (title plus one sentence each).
