#!/bin/bash
cd /root/Vibe/wt/og-speed
for i in 1 2; do for k in Hatboro Crystal Lansdale Phoenixville "Green Lane" Frenchtown; do
 for cfg in A C; do
  if [ $cfg = A ]; then E="OGV_LOOP_FIRST_ASK_SCALE=1 OGV_LOOP_MAX_VISITED_NODES=0"; else E="OGV_LOOP_FIRST_ASK_SCALE=1"; fi
  env $E GRAPHHOPPER_URL=http://127.0.0.1:8989 CALLS=1 TRIES=1 ONLY="$k" TAG=ab$cfg-$i node --conditions=react-server --import tsx .fable/rm7-time.mts 2>&1 | grep '^{' | sed "s/^{/{\"cfg\":\"$cfg\",/" | cut -c1-230
 done; done; done
