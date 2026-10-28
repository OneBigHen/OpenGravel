#!/usr/bin/env python3
"""Measure fixed hike probes on the isolated router, retaining full geometry/details."""
import argparse
import json
import math
from pathlib import Path
import urllib.error
import urllib.request

TRAILS = {"path", "footway", "track", "steps", "bridleway", "cycleway", "pedestrian"}
ROAD_ORDER = ["motorway", "trunk", "primary", "secondary", "tertiary", "unclassified", "residential", "service", "living_street"]


def distance(a, b):
    lon1, lat1, lon2, lat2 = map(math.radians, (*a, *b))
    h = math.sin((lat2-lat1)/2)**2 + math.cos(lat1)*math.cos(lat2)*math.sin((lon2-lon1)/2)**2
    return 12742000 * math.asin(min(1, math.sqrt(h)))


def measure(probe, trails_only=False):
    payload = {"profile": "hike", "points": [p[::-1] for p in probe["points"]],
               "points_encoded": False, "instructions": False,
               "details": ["road_class", "foot_road_access", "hike_rating", "foot_network"]}
    if trails_only:
        payload.update({"ch.disable": True, "lm.disable": True, "custom_model": {"priority": [{
            "if": "road_class != PATH && road_class != FOOTWAY && road_class != TRACK && road_class != STEPS && road_class != BRIDLEWAY && road_class != CYCLEWAY && road_class != PEDESTRIAN",
            "multiply_by": "0"}]}})
    req = urllib.request.Request("http://127.0.0.1:8995/route", json.dumps(payload).encode(), {"Content-Type": "application/json"})
    try:
        with urllib.request.urlopen(req, timeout=90) as response:
            raw = json.load(response)
    except urllib.error.HTTPError as error:
        return {**probe, "status": "unavailable", "response": json.load(error)}
    path = raw["paths"][0]
    coords = path["points"]["coordinates"]
    by_class = {}
    for start, end, road_class in path["details"]["road_class"]:
        by_class[road_class] = by_class.get(road_class, 0) + sum(distance(coords[i], coords[i+1]) for i in range(start, end))
    length = sum(by_class.values())
    pct = lambda classes: round(100 * sum(by_class.get(c, 0) for c in classes) / length, 2) if length else 0
    snaps = path["snapped_waypoints"]["coordinates"]
    return {**probe, "status": "routed", "distanceMeters": path["distance"],
            "timeSeconds": path["time"] / 1000,
            "snapMeters": [round(distance(p[::-1], snap), 1) for p, snap in zip(probe["points"], snaps)],
            "pathTrackPercent": pct({"path", "track"}), "trailPercent": pct(TRAILS),
            "maxRoadClass": next((c for c in ROAD_ORDER if by_class.get(c, 0) > 0), "none"),
            "metersByClass": by_class, "response": raw}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--out", required=True)
    parser.add_argument("--trails-only", action="store_true", help="diagnose connectivity with every non-trail class forbidden")
    args = parser.parse_args()
    probes = json.loads(Path(__file__).with_name("probes.json").read_text())
    with open(args.out, "w") as output:
        for probe in probes:
            result = measure(probe, args.trails_only)
            output.write(json.dumps(result) + "\n")
            output.flush()
            print(json.dumps({k: v for k, v in result.items() if k != "response"}), flush=True)


if __name__ == "__main__":
    main()
