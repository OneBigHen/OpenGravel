#!/bin/bash
c="cd ~/dev/og-pc/qa_rider-sweep/qa-out; grep -v '^IDS' run-$1.log | cut -c1-${2:-900}; pgrep -f run.mjs >/dev/null && echo RUNNING || echo FINISHED"
b=$(printf '%s' "$c" | base64 -w0)
ssh windows-zac "wsl -e bash -lc \"echo $b | base64 -d | bash\"" 2>&1 | grep -v bogus
