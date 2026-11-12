#!/usr/bin/env python3
"""Probe the motorcycle router v2 against production (ROUTING-MASTER.md section 5, "Verify").

Exits non-zero on any miss. Standard library only.

  probe-graph.py --url http://127.0.0.1:8988 --prod http://127.0.0.1:8989 \
      --atlas data/scorecard/gravel-atlas-v3.sqlite \
      --field-json scorecard-out/field-check.json \
      --turn-costs-bytes 1048676 \
      --memory-cmd 'command that prints the v2 router process RSS in bytes' \
      [--out probe-graph.json]

Checks:
  1. /info: version 11.0, the same four profiles, every production value plus og_curve, og_through,
     og_through_street and osm_way_id, the same bounding box.
  2. No route changed: 20 fixed pairs on each of the four profiles, distance and time within 1% of
     production. turn_costs is the same size as production's (1,048,676 bytes): no restriction lost.
  3. Field: the field-check.ts result (rider line curvier on at least 5 of 6; Spearman 0.8 or better).
  4. Through: 20 atlas corridors with a way in and a way out read og_through true at their midpoint
     (95%), and 20 with no way out read false (95%). Chosen by a fixed rule: highest quality first.
  5. Speed and memory: 40 single routes per profile, p95 0.6 s or less; serving memory after at least
     200 requests 3.3 GiB or less.
"""
import argparse
import json
import math
import sqlite3
import subprocess
import sys
import time
import urllib.request

PROFILES = ["motorcycle_fastest", "motorcycle_twisty", "motorcycle_scenic", "motorcycle_adventure"]
NEW_VALUES = ["og_curve", "og_through", "og_through_street", "osm_way_id"]
TURN_COSTS_BYTES = 1_048_676
P95_LIMIT_S = 0.6
MEMORY_LIMIT_BYTES = 3.3 * 1024 ** 3
PARITY_TOLERANCE = 0.01
THROUGH_SHARE = 0.95

# 20 fixed A-to-B pairs across PA and NJ, (lat, lon). Chosen before any run; never tuned.
PAIRS = [
    ("Allentown", (40.6023, -75.4714), "Stroudsburg", (40.9868, -75.1946)),
    ("Harrisburg", (40.2732, -76.8867), "Lancaster", (40.0379, -76.3055)),
    ("State College", (40.7934, -77.8600), "Lock Haven", (41.1370, -77.4469)),
    ("Williamsport", (41.2412, -77.0011), "Wellsboro", (41.7487, -77.3005)),
    ("Scranton", (41.4080, -75.6624), "Honesdale", (41.5768, -75.2588)),
    ("Reading", (40.3356, -75.9269), "Pottsville", (40.6856, -76.1955)),
    ("Doylestown", (40.3101, -75.1299), "New Hope", (40.3643, -74.9513)),
    ("Gettysburg", (39.8309, -77.2311), "Chambersburg", (39.9376, -77.6611)),
    ("Altoona", (40.5187, -78.3947), "Huntingdon", (40.4848, -78.0103)),
    ("Pittsburgh", (40.4406, -79.9959), "Washington PA", (40.1740, -80.2462)),
    ("Erie", (42.1292, -80.0851), "Meadville", (41.6414, -80.1514)),
    ("Bedford", (40.0187, -78.5039), "Somerset", (40.0084, -79.0781)),
    ("Clarion", (41.2148, -79.3853), "Ridgway", (41.4203, -78.7286)),
    ("Newton NJ", (41.0580, -74.7530), "Milford PA", (41.3223, -74.8024)),
    ("Frenchtown NJ", (40.5260, -75.0620), "Flemington", (40.5123, -74.8593)),
    ("Lambertville", (40.3659, -74.9429), "Clinton NJ", (40.6368, -74.9099)),
    ("Chatsworth NJ", (39.8176, -74.5354), "Batsto", (39.6418, -74.6477)),
    ("Blairstown", (40.9829, -74.9596), "Hackettstown", (40.8540, -74.8291)),
    ("Morristown NJ", (40.7968, -74.4815), "Princeton", (40.3573, -74.6672)),
    ("Jim Thorpe", (40.8759, -75.7324), "Hawley", (41.4759, -75.1821)),
]

failures = []
report = {}


def check(ok, line):
    print(("PASS " if ok else "FAIL ") + line)
    if not ok:
        failures.append(line)
    return ok


def get(url):
    with urllib.request.urlopen(url, timeout=60) as r:
        return json.load(r)


def post_route(base, body):
    req = urllib.request.Request(base + "/route", data=json.dumps(body).encode(), headers={"content-type": "application/json"})
    started = time.perf_counter()
    try:
        with urllib.request.urlopen(req, timeout=120) as r:
            payload = json.load(r)
    except urllib.error.HTTPError as e:
        payload = {"error": e.code, "message": e.read().decode(errors="replace")[:300]}
    return payload, time.perf_counter() - started


def route_body(profile, a, b, **extra):
    body = {"profile": profile, "points": [[a[1], a[0]], [b[1], b[0]]], "instructions": False, "calc_points": False}
    body.update(extra)
    return body


def check_info(url, prod):
    v2, p = get(url + "/info"), get(prod + "/info")
    check(v2.get("version") == "11.0" and p.get("version") == "11.0", f"/info version: v2 {v2.get('version')}, production {p.get('version')}")
    names = [x["name"] for x in v2.get("profiles", [])]
    check(names == [x["name"] for x in p.get("profiles", [])] == PROFILES, f"/info profiles: {names}")
    missing = [k for k in list(p.get("encoded_values", {})) + NEW_VALUES if k not in v2.get("encoded_values", {})]
    check(not missing, f"/info values: v2 lists every production value plus {', '.join(NEW_VALUES)}" + (f"; missing {missing}" if missing else ""))
    check(v2.get("bbox") == p.get("bbox"), f"/info bounding box: v2 {v2.get('bbox')}, production {p.get('bbox')}")
    report["info"] = {"version": v2.get("version"), "profiles": names, "bbox": v2.get("bbox"), "values": sorted(v2.get("encoded_values", {}))}


def check_parity(url, prod, timings):
    rows = []
    worst = 0.0
    for profile in PROFILES:
        for a_name, a, b_name, b in PAIRS:
            got, seconds = post_route(url, route_body(profile, a, b))
            want, _ = post_route(prod, route_body(profile, a, b))
            timings.setdefault(profile, []).append(seconds)
            if "paths" not in got or "paths" not in want:
                rows.append({"profile": profile, "pair": f"{a_name} to {b_name}", "error": got.get("message") or want.get("message")})
                check(False, f"parity {profile} {a_name} to {b_name}: no route ({got.get('message') or want.get('message')})")
                continue
            g, w = got["paths"][0], want["paths"][0]
            dd = abs(g["distance"] - w["distance"]) / max(1, w["distance"])
            dt = abs(g["time"] - w["time"]) / max(1, w["time"])
            worst = max(worst, dd, dt)
            rows.append({"profile": profile, "pair": f"{a_name} to {b_name}", "km": round(w["distance"] / 1000, 2), "distanceDiff": dd, "timeDiff": dt})
            if dd > PARITY_TOLERANCE or dt > PARITY_TOLERANCE:
                check(False, f"parity {profile} {a_name} to {b_name}: distance {g['distance']:.0f} vs {w['distance']:.0f} m, time {g['time'] / 1000:.0f} vs {w['time'] / 1000:.0f} s")
    misses = [r for r in rows if "error" in r or r["distanceDiff"] > PARITY_TOLERANCE or r["timeDiff"] > PARITY_TOLERANCE]
    identical = sum(1 for r in rows if "error" not in r and r["distanceDiff"] == 0 and r["timeDiff"] == 0)
    check(not misses, f"no route changed: {len(rows) - len(misses)} of {len(rows)} routes within 1% of production ({identical} identical, worst difference {worst * 100:.3f}%)")
    report["parity"] = rows


def check_turn_costs(size):
    if size is None:
        check(False, "turn_costs size not given (--turn-costs-bytes)")
        return
    check(size == TURN_COSTS_BYTES, f"turn_costs {size:,} bytes (production {TURN_COSTS_BYTES:,})")
    report["turnCostsBytes"] = size


def check_field(path):
    if not path:
        check(False, "field check result not given (--field-json)")
        return
    with open(path) as f:
        field = json.load(f)
    check(field["riderWins"] >= 5, f"field: rider line reads curvier on {field['riderWins']} of {field['rides']} Curvy rides (need 5)")
    check(field["spearman"] >= 0.8, f"field: Spearman {field['spearman']:.3f} between mean og_curve and bend share over {field['linesMeasured']} lines (need 0.8)")
    report["field"] = {k: field[k] for k in ("riderWins", "rides", "spearman", "linesMeasured", "router")}


def along(coords, fraction):
    """Point at `fraction` of a [[lon, lat], ...] line's length, as (lat, lon)."""
    def dist(p, q):
        la1, la2 = math.radians(p[1]), math.radians(q[1])
        a = math.sin((la2 - la1) / 2) ** 2 + math.cos(la1) * math.cos(la2) * math.sin(math.radians(q[0] - p[0]) / 2) ** 2
        return 2 * 6371000 * math.asin(math.sqrt(a))
    legs = [dist(coords[i - 1], coords[i]) for i in range(1, len(coords))]
    target, run = sum(legs) * fraction, 0.0
    for i, leg in enumerate(legs):
        if run + leg >= target and leg > 0:
            t = (target - run) / leg
            p, q = coords[i], coords[i + 1]
            return (p[1] + (q[1] - p[1]) * t, p[0] + (q[0] - p[0]) * t)
        run += leg
    return (coords[-1][1], coords[-1][0])


def haversine(a, b):
    """Metres between two (lat, lon) points."""
    la1, la2 = math.radians(a[0]), math.radians(b[0])
    h = math.sin((la2 - la1) / 2) ** 2 + math.cos(la1) * math.cos(la2) * math.sin(math.radians(b[1] - a[1]) / 2) ** 2
    return 2 * 6371000 * math.asin(math.sqrt(h))


ON_CORRIDOR_METERS = 30


def through_at(url, coords, fraction=0.5):
    """og_through on the corridor itself at `fraction` of its length: route from 5% before to 5% after that
    point and read the value on the path segment nearest to it. The reading only counts when the path passes
    within ON_CORRIDOR_METERS of the point; otherwise the router took another road and nothing was read."""
    target = along(coords, fraction)
    a, b = along(coords, max(0.0, fraction - 0.05)), along(coords, min(1.0, fraction + 0.05))
    body = route_body("motorcycle_adventure", a, b, calc_points=True, points_encoded=False, details=["og_through", "og_through_street"])
    payload, _ = post_route(url, body)
    if "paths" not in payload:
        return None, payload.get("message")
    path = payload["paths"][0]
    points = [(c[1], c[0]) for c in path["points"]["coordinates"]]
    if len(points) < 2:
        return None, "path has no segment"
    best, best_d = 0, float("inf")
    for i in range(len(points) - 1):
        # distance to the segment, sampled: good enough at corridor scale
        for t in (0.0, 0.25, 0.5, 0.75, 1.0):
            q = (points[i][0] + (points[i + 1][0] - points[i][0]) * t, points[i][1] + (points[i + 1][1] - points[i][1]) * t)
            d = haversine(q, target)
            if d < best_d:
                best, best_d = i, d
    if best_d > ON_CORRIDOR_METERS:
        return None, f"route passes {best_d:.0f} m from the corridor point (another road was read)"
    for start, end, value in path["details"]["og_through"]:
        if start <= best < end:
            return bool(value), None
    return None, "no detail on the nearest segment"


def check_through(url, atlas):
    if not atlas:
        check(False, "atlas not given (--atlas)")
        return
    db = sqlite3.connect(f"file:{atlas}?mode=ro", uri=True)
    sets = {
        "way in and way out": ("select id, geometry_json from corridors where entry_links > 0 and exit_links > 0 and routable = 1 "
                               "order by quality desc, id limit 20", True),
        "no way out": ("select id, geometry_json from corridors where entry_links > 0 and exit_links = 0 "
                       "order by quality desc, id limit 20", False),
    }
    report["through"] = {}
    for name, (sql, expected) in sets.items():
        rows = db.execute(sql).fetchall()
        results = []
        for cid, geometry in rows:
            coords = json.loads(geometry)
            value, problem = through_at(url, coords, 0.5)
            row = {"id": cid, "through": value, "problem": problem}
            if not expected:
                # Information only, never scored: the dead end itself, near the corridor's last node.
                row["tipThrough"], row["tipProblem"] = through_at(url, coords, 0.97)
            results.append(row)
        right = sum(1 for r in results if r["through"] is expected)
        unread = [r["id"] for r in results if r["through"] is None]
        check(len(rows) == 20 and right >= THROUGH_SHARE * 20,
              f"through: {right} of {len(rows)} corridors with {name} read {str(expected).lower()} (need 19)" + (f"; unread {unread}" if unread else ""))
        if not expected:
            tips = [r for r in results if r.get("tipThrough") is not None]
            print(f"     (information only: at the dead-end tip, {sum(1 for r in tips if r['tipThrough'] is False)} of {len(tips)} readable no-way-out corridors read false)")
        report["through"][name] = results


def check_speed_and_memory(url, memory_cmd, timings):
    # 40 single routes per profile: the 20 pairs both ways (the forward runs were timed during parity).
    for profile in PROFILES:
        for _, a, _, b in PAIRS:
            _, seconds = post_route(url, route_body(profile, b, a))
            timings[profile].append(seconds)
    report["speed"] = {}
    for profile in PROFILES:
        t = sorted(timings[profile])
        p95 = t[math.ceil(0.95 * len(t)) - 1]
        report["speed"][profile] = {"routes": len(t), "p50": t[len(t) // 2], "p95": p95, "max": t[-1]}
        check(p95 <= P95_LIMIT_S, f"speed {profile}: p95 {p95:.3f} s over {len(t)} single routes (limit {P95_LIMIT_S} s; p50 {t[len(t) // 2]:.3f} s)")
    if not memory_cmd:
        check(False, "memory command not given (--memory-cmd)")
        return
    rss = int(subprocess.check_output(memory_cmd, shell=True, text=True).strip().split()[-1])
    report["memoryBytes"] = rss
    check(rss <= MEMORY_LIMIT_BYTES, f"serving memory after the probe's requests: {rss / 1024 ** 3:.2f} GiB (limit 3.3 GiB)")


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--url", required=True, help="v2 router")
    ap.add_argument("--prod", required=True, help="production router")
    ap.add_argument("--atlas")
    ap.add_argument("--field-json")
    ap.add_argument("--turn-costs-bytes", type=int)
    ap.add_argument("--memory-cmd")
    ap.add_argument("--out")
    args = ap.parse_args()
    timings = {}
    check_info(args.url, args.prod)
    check_parity(args.url, args.prod, timings)
    check_turn_costs(args.turn_costs_bytes)
    check_field(args.field_json)
    check_through(args.url, args.atlas)
    check_speed_and_memory(args.url, args.memory_cmd, timings)
    report["failures"] = failures
    if args.out:
        with open(args.out, "w") as f:
            json.dump(report, f, indent=2)
    print(f"\n{'ALL PASSED' if not failures else str(len(failures)) + ' FAILED'}")
    sys.exit(1 if failures else 0)


if __name__ == "__main__":
    main()
