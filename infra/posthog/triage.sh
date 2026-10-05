#!/usr/bin/env bash
# Daily autonomous triage: read the PostHog aggregate report (and PostHog via MCP),
# then file or update GitHub issues. Never merges, deploys or edits routing policy.
set -euo pipefail
REPORT=${POSTHOG_REPORT:-/var/lib/opengravel/analytics/latest.json}
REPO=${OGV_REPO:-OneBigHen/OpenGravel}
LOG_DIR=${OGV_TRIAGE_DIR:-/var/lib/opengravel/analytics}
CLONE=${OGV_TRIAGE_CLONE:-/root/Vibe/wt/og-triage}
exec 9>"$LOG_DIR/.triage.lock"; flock -n 9 || { echo "triage already running"; exit 0; }

# Nothing to analyse -> spend no model quota.
rows=$(python3 -c 'import json,sys; print(len(json.load(open(sys.argv[1]))["rows"]))' "$REPORT")
if [ "$rows" -eq 0 ]; then echo "report empty (0 rows); skipping triage"; exit 0; fi
# Heavy-worker guard (8 GB host): do not run beside a Codex worker or a build.
if pgrep -f "codex exec|next build|vitest" >/dev/null; then echo "heavy worker running; retry next run"; exit 75; fi

[ -d "$CLONE/.git" ] || git clone "git@github.com:$REPO.git" "$CLONE"
git -C "$CLONE" fetch -q origin && git -C "$CLONE" checkout -q --detach origin/main

PROMPT=$(cat <<EOP
You are the unattended OpenGravel analytics triage agent. Today is $(date -u +%F).
Read $REPORT and use the PostHog MCP (project 571923) for detail, replays and error groups.
Rules:
1. Only report real, evidenced problems: failure/slow-plan trends by buildId, repeated or dead clicks on a control, new error groups. Include counts, time window, sample size and links. A missing event is not zero usage; a tiny sample is not a trend - say so or skip.
2. Dedupe: run 'gh issue list -R $REPO --label posthog-triage --state open' first. Comment on an existing issue instead of filing a duplicate. File at most 3 new issues per run, title prefixed 'PostHog:', label 'posthog-triage' (create it if missing).
3. Each issue: evidence, suspected cause from reading the code in $CLONE, reproduction steps, proposed regression test.
4. Draft PR only if the fix is small (<40 changed lines, one area), obviously correct, and you ran lint, typecheck and the focused vitest file (2 workers max) in a worktree of $CLONE; open it with 'gh pr create --draft' referencing the issue. Never merge, never push to main, never deploy, never change routing policy or privacy/consent behaviour, never touch secrets or env files.
5. If nothing is actionable, do nothing and say so. Finish with a 5-line summary.
EOP
)
cd "$CLONE"
timeout 1500 claude -p "$PROMPT" --model sonnet \
  --permission-mode dontAsk \
  --allowedTools "mcp__posthog__*" "Read" "Grep" "Glob" "Edit" "Write" \
    "Bash(gh issue:*)" "Bash(gh pr create:*)" "Bash(gh pr list:*)" "Bash(gh label:*)" "Bash(gh api:*)" \
    "Bash(git status:*)" "Bash(git diff:*)" "Bash(git log:*)" "Bash(git worktree:*)" "Bash(git checkout:*)" "Bash(git add:*)" "Bash(git commit:*)" "Bash(git push -u origin triage/*)" \
    "Bash(npx vitest run:*)" "Bash(npx tsc:*)" "Bash(npx eslint:*)" "Bash(npm ci:*)" \
  > "$LOG_DIR/triage-$(date -u +%F).log" 2>&1
echo "triage complete; log in $LOG_DIR"
