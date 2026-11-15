#!/bin/bash
cd /root/Vibe/wt/og-speed
export GRAPHHOPPER_URL=http://127.0.0.1:8988
tag=$1; shift
env "$@" flock /tmp/og-scorecard.lock npm run scorecard -- --set tuning > runs/score-$tag.out 2>&1
cp scorecard-out/latest.json runs/score-$tag.json
echo done > runs/score-$tag.done
