#!/usr/bin/env python3
"""Copies 14 real library records into tests/fixtures/route-library/source/ with
each GPX trimmed to under 300 points (evenly thinned, ends kept). Run once;
the output is committed. Usage: make-fixture.py <library dir> <fixture dir>"""
import hashlib, json, math, re, shutil, sys
from pathlib import Path

PICKS = [
    "NC/nc-diamondback-loop",                      # Standout twisty road, NC + TN
    "NC/nc-cherohala-skyway",                      # scenic road with stops
    "TX/tx-lovelady-loop",                         # dirt road with rider notes and stops
    "PA/pa-lancaster-county-loop-tour-ephrata-parkesburg-holtwood-marietta",  # a loop (ends 89 m apart)
    "MI/mi-orv-route-slc",                         # trail bundle, cut to 3 segments
    "OK/ok-white-water-orv-area",                  # riding area with no track and no coordinates
    "NE/ne-desoto-trail",                          # link-only road with a source box
    "AZ/az-arizona-bdr",                           # BDR, link-only, lane bdr
    "CA/ca-fort-bragg-to-medford",                 # about 295 miles, CA + OR
    "PA/pa-us-220-pennsdale-athens",               # 2010 track
    "AL/al-the-heart-run",                         # rough track: 7 points over 90 miles
    "PA/pa-pa-151-south-heights-hookstown",
    "PA/pa-pa-231-prosperity-avella",
    "PA/pa-pa-864-picture-rocks-montoursville",
]
MAX_POINTS = 280


def haversine(a, b):
    r = 6371000.0
    p = math.pi / 180
    dl, dn = (b[0] - a[0]) * p, (b[1] - a[1]) * p
    x = math.sin(dl / 2) ** 2 + math.cos(a[0] * p) * math.cos(b[0] * p) * math.sin(dn / 2) ** 2
    return 2 * r * math.asin(math.sqrt(x))


def thin(points, limit):
    """Keeps `limit` points spaced evenly by distance along the line (ends kept)."""
    if len(points) <= limit:
        return points
    run = [0.0]
    for i in range(1, len(points)):
        run.append(run[-1] + haversine(points[i - 1], points[i]))
    kept, j = [points[0]], 0
    for k in range(1, limit - 1):
        target = run[-1] * k / (limit - 1)
        while j < len(points) - 1 and run[j] < target:
            j += 1
        if points[j] is not kept[-1]:
            kept.append(points[j])
    kept.append(points[-1])
    return kept


def main(library, fixture):
    library, fixture = Path(library), Path(fixture)
    for pick in PICKS:
        state, name = pick.split("/")
        record = json.loads((library / "routes" / pick.split("/")[0] / f"{name}.json").read_text())
        out = fixture / "routes" / state
        out.mkdir(parents=True, exist_ok=True)
        gpx = record["gpx"]
        if gpx["availability"] == "hosted":
            text = (library / "routes" / state / gpx["local_file"]).read_text(errors="ignore")
            meta = re.search(r"<metadata>.*?</metadata>", text, re.S)
            segments = [re.findall(r'<trkpt[^>]*lat="([-\d.]+)"[^>]*lon="([-\d.]+)"', s) or
                        [(a, b) for b, a in re.findall(r'<trkpt[^>]*lon="([-\d.]+)"[^>]*lat="([-\d.]+)"', s)]
                        for s in re.findall(r"<trkseg>(.*?)</trkseg>", text, re.S)]
            segments = [[(float(a), float(b)) for a, b in s] for s in segments if s]
            route_only = not segments
            if route_only:  # a route export (rtept) with no track at all: keep it as a route
                pts = re.findall(r'<rtept[^>]*lat="([-\d.]+)"[^>]*lon="([-\d.]+)"', text)
                segments = [[(float(a), float(b)) for a, b in pts]]
            if gpx.get("is_bundle"):
                segments = [thin(s, 90) for s in segments[:3]]
            else:
                segments = [thin([p for s in segments for p in s], MAX_POINTS)]
            if route_only:
                body = "<rte><name>" + record["name"] + "</name>" + "".join(f'<rtept lat="{la}" lon="{lo}"/>' for la, lo in segments[0]) + "</rte>"
            else:
                body = "<trk><name>" + record["name"] + "</name>" + "".join(
                    "<trkseg>" + "".join(f'<trkpt lat="{la}" lon="{lo}"/>' for la, lo in s) + "</trkseg>" for s in segments
                ) + "</trk>"
            xml = ('<?xml version="1.0" encoding="UTF-8"?>\n<gpx version="1.1" creator="fixture" xmlns="http://www.topografix.com/GPX/1/1">\n'
                   + (meta.group(0) if meta else "") + f"\n{body}\n</gpx>\n")
            xml = xml.replace("&", "&amp;") if "&amp;" not in xml and "&" in record["name"] else xml
            (out / gpx["local_file"]).write_text(xml)
            flat = [p for s in segments for p in s]
            km = sum(haversine(s[i - 1], s[i]) for s in segments for i in range(1, len(s))) / 1000
            gpx["points"] = len(flat)
            gpx["distance_km"] = round(km, 2)
            gpx["bounds"] = {"west": min(p[1] for p in flat), "south": min(p[0] for p in flat),
                             "east": max(p[1] for p in flat), "north": max(p[0] for p in flat)}
            gpx["sha256"] = hashlib.sha256(xml.encode()).hexdigest()
            record["scraper"]["notes"] = (record["scraper"].get("notes", "") + f" [fixture: GPX trimmed to {len(flat)} points]").strip()
        (out / f"{name}.json").write_text(json.dumps(record, indent=1, ensure_ascii=False) + "\n")
        print("wrote", pick)


main(sys.argv[1], sys.argv[2])
