#!/usr/bin/env python3
"""Write the small artifact manifest consumed by future publish/download tooling."""

from __future__ import annotations

import hashlib
import json
import os
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parents[3]
DATA_ROOT = Path(os.environ.get("OGV_MAP_DATA_ROOT", ROOT / "infra/maps/data"))
OUT = DATA_ROOT / "out"
REGION_ENV = ROOT / "infra/maps/regions/pa-nj.env"


def parse_env(path: Path) -> dict[str, str]:
    values: dict[str, str] = {}
    for raw in path.read_text().splitlines():
        line = raw.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        values[key] = value.strip().strip('"')
    return values


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for block in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(block)
    return digest.hexdigest()


env = parse_env(REGION_ENV)
artifacts = []
for path in sorted(OUT.glob("*.pmtiles")):
    artifacts.append(
        {
            "name": path.name,
            "bytes": path.stat().st_size,
            "sha256": sha256(path),
        }
    )

if not artifacts:
    raise SystemExit(f"no PMTiles artifacts found in {OUT}")

manifest = {
    "schemaVersion": 1,
    "region": {
        "id": env["REGION_ID"],
        "name": env["REGION_NAME"],
        "bounds": [
            float(env["BBOX_WEST"]),
            float(env["BBOX_SOUTH"]),
            float(env["BBOX_EAST"]),
            float(env["BBOX_NORTH"]),
        ],
    },
    "generatedAt": datetime.now(timezone.utc).isoformat().replace("+00:00", "Z"),
    "tools": {
        "planetiler": env["PLANETILER_IMAGE"],
    },
    "sources": {
        "osm": [env["OSM_URL_PA"], env["OSM_URL_NJ"]],
    },
    "artifacts": artifacts,
}

OUT.mkdir(parents=True, exist_ok=True)
target = OUT / "manifest.json"
target.write_text(json.dumps(manifest, indent=2) + "\n")
print(target)
for artifact in artifacts:
    print(f"{artifact['name']}: {artifact['bytes']:,} bytes {artifact['sha256']}")
