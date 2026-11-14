#!/bin/bash
# usage: bg.sh <journey-prefix...>  -> runs on PC in background, log at ~/dev/og-pc/qa_rider-sweep/qa-out/run-<name>.log
cd /root/Vibe/wt/og-qa
n="$*"; n=${n// /_}
/root/bin/og-pc qa/rider-sweep "mkdir -p qa-out; nohup node scripts/qa/rider-sweep/run.mjs $* > qa-out/run-$n.log 2>&1 &
echo started" 
