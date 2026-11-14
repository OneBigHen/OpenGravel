#!/bin/bash
cd /root/Vibe/wt/og-speed
export GRAPHHOPPER_URL=http://127.0.0.1:8988
run() { # tag
  flock /tmp/og-scorecard.lock npm run scorecard -- --set tuning > runs/score-$1.out 2>&1
  cp scorecard-out/latest.json runs/score-$1.json
}
OGV_LOOP_FIRST_ASK_SCALE=1 OGV_LOOP_MAX_VISITED_NODES=0 run A
run B
echo done > runs/score-done
