#!/bin/bash
# rebuild the atlas on the Windows PC and install it here
set -e
cd /root/Vibe/wt/.wt/og-rt-integrate-rider-modes
scp -q scripts/build-gravel-atlas.ts windows-zac:C:/Users/Public/bga.ts
ssh windows-zac 'wsl -d Ubuntu -- bash -lc "cd ~/ga && cp /mnt/c/Users/Public/bga.ts scripts/build-gravel-atlas.ts && export PATH=\$HOME/ga/node-v24.15.0-linux-x64/bin:\$PATH && node node_modules/.bin/tsx scripts/build-gravel-atlas.ts --input ways.ndjson --output atlas.sqlite"' | tee /tmp/claude-0/atlas-build.json | head -30
ssh windows-zac 'wsl -d Ubuntu -- bash -lc "cat ~/ga/atlas.sqlite"' > /tmp/claude-0/atlas.sqlite
cp /tmp/claude-0/atlas.sqlite /var/lib/opengravel/gravel-atlas-v3.sqlite.new && mv /var/lib/opengravel/gravel-atlas-v3.sqlite.new /var/lib/opengravel/gravel-atlas-v3.sqlite && chmod 644 /var/lib/opengravel/gravel-atlas-v3.sqlite
ls -la /var/lib/opengravel/gravel-atlas-v3.sqlite
