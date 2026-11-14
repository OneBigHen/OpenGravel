#!/bin/bash
# usage: timeall.sh URL TAG TRIES [env...]  one fresh process per try (no 60 s share cache)
URL=$1; TAG=$2; TRIES=$3
cd /root/Vibe/wt/og-speed
for i in $(seq 1 $TRIES); do
  for k in Hatboro Crystal Lansdale Phoenixville "Green Lane" Frenchtown; do
    GRAPHHOPPER_URL=$URL CALLS=1 TRIES=1 ONLY="$k" TAG=$TAG-$i flock /tmp/og-scorecard.lock node --conditions=react-server --import tsx .fable/rm7-time.mts 2>&1 | grep '^{' | cut -c1-200
  done
done
