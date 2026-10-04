#!/usr/bin/env python3
"""Stream a PBF into NDJSON GeoJSON features for scripts/build-gravel-atlas.ts.

Use this where osmium-tool is not installed (pip install osmium). Emits:
  - LineString ways that could be dirt corridors or paved backroads, with all
    OSM tags as properties plus "@id";
  - Point nodes that suppress Franco curvature (stop, give_way, signals,
    crossings, mini roundabouts, traffic calming, barriers, junction tags).
The TypeScript builder stays the single place where legality is decided.
"""
import json
import sys

import osmium

DIRT = {"gravel", "fine_gravel", "compacted", "dirt", "ground", "unpaved", "earth"}
ROAD = {"track", "unclassified", "tertiary", "residential", "secondary", "service", "path", "bridleway", "cycleway", "footway"}
BACKROAD = {"unclassified", "tertiary", "residential"}
CONTROL_HIGHWAY = {"stop", "give_way", "traffic_signals", "crossing", "mini_roundabout", "speed_camera"}


# Roads a motor vehicle can continue onto; paths, steps and footways do not count as a way out.
DRIVABLE = {"motorway", "trunk", "primary", "secondary", "tertiary", "unclassified", "residential", "service", "track", "road", "living_street", "motorway_link", "trunk_link", "primary_link", "secondary_link", "tertiary_link"}


class Counter(osmium.SimpleHandler):
    """Pass 1: how many drivable ways use each node, so corridor ends can tell a dead end from a way on."""

    def __init__(self):
        super().__init__()
        self.uses = {}

    def way(self, w):
        if w.tags.get("highway") not in DRIVABLE:
            return
        uses = self.uses
        for n in w.nodes:
            uses[n.ref] = uses.get(n.ref, 0) + 1


class Handler(osmium.SimpleHandler):
    def __init__(self, out, uses):
        super().__init__()
        self.out = out
        self.uses = uses
        self.ways = 0
        self.points = 0

    def way(self, w):
        tags = {t.k: t.v for t in w.tags}
        highway = tags.get("highway")
        if highway is None or highway not in ROAD:
            return
        if not (highway == "track" or highway in BACKROAD or tags.get("surface") in DIRT):
            return
        coords = []
        for n in w.nodes:
            if n.location.valid():
                coords.append([n.lon, n.lat])
        if len(coords) < 2:
            return
        props = dict(tags)
        props["@id"] = f"way/{w.id}"
        # Other drivable ways meeting each end (0 = a dead end).
        first_ref, last_ref = w.nodes[0].ref, w.nodes[len(w.nodes) - 1].ref
        props["@links"] = [max(0, self.uses.get(first_ref, 1) - 1), max(0, self.uses.get(last_ref, 1) - 1)]
        self.out.write(json.dumps({"type": "Feature", "geometry": {"type": "LineString", "coordinates": coords}, "properties": props}, separators=(",", ":")) + "\n")
        self.ways += 1

    def node(self, n):
        if not n.tags:
            return
        tags = {t.k: t.v for t in n.tags}
        reason = tags.get("highway") in CONTROL_HIGHWAY or any(k in tags for k in ("crossing", "traffic_calming", "barrier", "junction"))
        if not reason or not n.location.valid():
            return
        props = {k: tags[k] for k in ("highway", "crossing", "traffic_calming", "barrier", "junction") if k in tags}
        self.out.write(json.dumps({"type": "Feature", "geometry": {"type": "Point", "coordinates": [n.lon, n.lat]}, "properties": props}, separators=(",", ":")) + "\n")
        self.points += 1


def main():
    if len(sys.argv) != 3:
        sys.exit("usage: extract-gravel-atlas-ways.py input.osm.pbf output.ndjson")
    counter = Counter()
    counter.apply_file(sys.argv[1])
    with open(sys.argv[2], "w", encoding="utf-8") as out:
        handler = Handler(out, counter.uses)
        handler.apply_file(sys.argv[1], locations=True)
    print(json.dumps({"ways": handler.ways, "controlPoints": handler.points}))


if __name__ == "__main__":
    main()
