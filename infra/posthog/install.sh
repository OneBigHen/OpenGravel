#!/usr/bin/env bash
# Installs the daily PostHog report + triage units on the host (run as root).
set -euo pipefail
here=$(cd "$(dirname "$0")" && pwd)
install -d /usr/local/lib/opengravel
install -m 0755 "$here/../../scripts/posthog-report.py" /usr/local/lib/opengravel/posthog-report.py
install -m 0755 "$here/triage.sh" /usr/local/lib/opengravel/posthog-triage.sh
install -m 0644 "$here"/ogv-posthog-triage.service "$here"/ogv-posthog-triage.timer /etc/systemd/system/
systemctl daemon-reload
systemctl enable --now ogv-posthog-triage.timer
systemctl list-timers ogv-posthog-triage.timer --no-pager
