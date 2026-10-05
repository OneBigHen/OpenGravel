#!/usr/bin/env python3
"""Read-only, aggregate PostHog report for app improvement and AI analysis."""
import datetime
import json
import os
from pathlib import Path
import urllib.request


def main():
    host = os.environ.get("POSTHOG_HOST", "https://us.posthog.com")
    if host not in ("https://us.posthog.com", "https://eu.posthog.com"):
        raise ValueError("Unsupported PostHog host")
    project = int(os.environ["POSTHOG_PROJECT_ID"])
    query = """SELECT event, properties.buildId AS build,
        properties.errorClass AS error_class, properties.latencyBand AS latency,
        count() AS count FROM events
        WHERE timestamp >= now() - INTERVAL 1 DAY
        AND event IN ('planner_opened', 'route_plan_requested',
          'route_primary_ready', 'route_plan_failed', '$rageclick',
          '$dead_click', '$exception')
        GROUP BY event, build, error_class, latency
        ORDER BY count DESC LIMIT 200"""
    request = urllib.request.Request(
        f"{host}/api/projects/{project}/query/",
        data=json.dumps({"query": {"kind": "HogQLQuery", "query": query}}).encode(),
        headers={"Authorization": "Bearer " + os.environ["POSTHOG_PERSONAL_API_KEY"],
                 "Content-Type": "application/json"},
    )
    with urllib.request.urlopen(request, timeout=60) as response:
        result = json.load(response)
    if not isinstance(result.get("results"), list):
        raise ValueError("Query did not return completed results")
    now = datetime.datetime.now(datetime.timezone.utc)
    report = {
        "generatedAt": now.isoformat(), "projectId": project,
        "window": "last 24 hours", "definition": "one-off aggregate, not a governed metric",
        "coverage": "consenting visitors; memory-only identity; exclude test/smoke builds",
        "columns": result.get("columns", []), "rows": result["results"],
        "analysisPrompt": "Compare requested, ready and failed counts by build. Report sample sizes. Review friction and latency bands; propose reproductions and regression tests. Missing events are not zero usage. Do not deploy automatically.",
    }
    folder = Path(os.environ.get("POSTHOG_REPORT_DIR", "/var/lib/opengravel/analytics"))
    folder.mkdir(parents=True, exist_ok=True, mode=0o700)
    target = folder / "latest.json"
    temporary = folder / "latest.json.tmp"
    temporary.write_text(json.dumps(report, indent=2) + "\n")
    temporary.chmod(0o600)
    temporary.replace(target)
    print(f"PostHog aggregate report updated: {len(report['rows'])} groups")


if __name__ == "__main__":
    main()
