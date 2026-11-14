#!/usr/bin/env python3
"""One serving trial of a motorcycle router graph: start it, measure it, stop it, print one JSON line.

  serve-trial.py --dir BUILD_DIR --config config.yml --xmx 4g --pairs ne|panj [--port 8992] [--admin 8993]
                 [--drop-caches] [--label text]

Measures: start to health, start to first answer (the first route request), the first answer's own time,
then 2 passes of the sample routes (30 A-to-B pairs x fastest, twisty, adventure = 90 requests per pass),
padded to 200 mixed requests with scenic mixed in, p50 and p95
per profile, and the java process memory (VmRSS, RssAnon, RssFile, VmHWM) after the 200 requests.
--drop-caches empties the operating system file cache first (needs `wsl -u root`), for the cold number.
Standard library only. Never touches ports other than --port/--admin.
"""
import argparse, json, math, os, random, signal, subprocess, sys, time, urllib.request, urllib.error

P = {  # name: (lat, lon)
 "Burlington":(44.4759,-73.2121),"Montpelier":(44.2601,-72.5754),"Rutland":(43.6106,-72.9726),"Brattleboro":(42.8509,-72.5579),
 "StJohnsbury":(44.4195,-72.0151),"Bennington":(42.8781,-73.1968),"Stowe":(44.4654,-72.6874),"Killington":(43.6045,-72.8201),
 "Concord":(43.2081,-71.5376),"Conway":(43.9779,-71.1198),"Lincoln":(44.0462,-71.6692),"Keene":(42.9337,-72.2781),
 "Portland":(43.6591,-70.2568),"Augusta":(44.3106,-69.7795),"Bangor":(44.8012,-68.7778),"Rangeley":(44.9667,-70.6439),
 "Greenville":(45.4609,-69.5903),"BarHarbor":(44.3876,-68.2039),"Rockland":(44.1037,-69.1089),"Farmington":(44.6700,-70.1514),
 "Millinocket":(45.6573,-68.7098),"Boston":(42.3601,-71.0589),"Worcester":(42.2626,-71.8023),"Springfield":(42.1015,-72.5898),
 "Pittsfield":(42.4501,-73.2454),"Hyannis":(41.6532,-70.2833),"Hartford":(41.7658,-72.6734),"Providence":(41.8240,-71.4128),
 "Norfolk":(41.9684,-73.2000),"Albany":(42.6526,-73.7562),"LakePlacid":(44.2795,-73.9799),"SaranacLake":(44.3295,-74.1313),
 "OldForge":(43.7106,-74.9732),"IndianLake":(43.7812,-74.2693),"TupperLake":(44.2237,-74.4660),"Syracuse":(43.0481,-76.1474),
 "Binghamton":(42.0987,-75.9180),"Ithaca":(42.4440,-76.5019),"Woodstock":(42.0409,-74.1182),"Margaretville":(42.1459,-74.6560),
 "Hunter":(42.2123,-74.2182),"Kingston":(41.9270,-73.9974),"Poughkeepsie":(41.7004,-73.9210),"LakeGeorge":(43.4259,-73.7123),
 "Plattsburgh":(44.6995,-73.4529),"Roscoe":(41.9373,-74.9157),"Wellsboro":(41.7487,-77.3003),"Coudersport":(41.7745,-78.0206),
 "Ridgway":(41.4237,-78.7289),"Williamsport":(41.2412,-77.0011),"Bradford":(41.9556,-78.6439),"Scranton":(41.4090,-75.6624),
 "Stroudsburg":(40.9868,-75.1946),"Harrisburg":(40.2732,-76.8867),"StateCollege":(40.7934,-77.8600),"Emporium":(41.5114,-78.2328),
 "Newton":(41.0587,-74.7524),"Philadelphia":(39.9526,-75.1652),"Pittsburgh":(40.4406,-79.9959),"Allentown":(40.6084,-75.4902),
 "Lancaster":(40.0379,-76.3055),"Erie":(42.1292,-80.0851),"Altoona":(40.5187,-78.3947),"Gettysburg":(39.8309,-77.2311),
 "Hershey":(40.2859,-76.6502),"JimThorpe":(40.8751,-75.7324),"Milford":(41.3222,-74.8023),"Honesdale":(41.5762,-75.2585),
 "AtlanticCity":(39.3643,-74.4229),"CapeMay":(38.9351,-74.9060),"Trenton":(40.2171,-74.7429),"Johnstown":(40.3267,-78.9220),
 "Somerset":(40.0084,-79.0781),"Uniontown":(39.9001,-79.7164),"Clarion":(41.2145,-79.3845),"Warren":(41.8437,-79.1451),
 "Towanda":(41.7684,-76.4413),"Pottsville":(40.6856,-76.1955),"Lewisburg":(40.9645,-76.8844),"Huntingdon":(40.4984,-78.0108),
 "Bedford":(40.0186,-78.5039),"Chambersburg":(39.9376,-77.6611),"Hackettstown":(40.8537,-74.8296),
}
NE_PAIRS = [("Burlington","Montpelier"),("Burlington","StJohnsbury"),("Rutland","Brattleboro"),("Bennington","Stowe"),
 ("Killington","StJohnsbury"),("LakePlacid","Burlington"),("LakePlacid","OldForge"),("SaranacLake","IndianLake"),
 ("TupperLake","LakeGeorge"),("Plattsburgh","TupperLake"),("Albany","Brattleboro"),("Kingston","Margaretville"),
 ("Woodstock","Roscoe"),("Hunter","Binghamton"),("Poughkeepsie","Scranton"),("Roscoe","Stroudsburg"),("Ithaca","Wellsboro"),
 ("Wellsboro","Coudersport"),("Ridgway","Williamsport"),("StateCollege","Wellsboro"),("Portland","Rangeley"),
 ("Augusta","Greenville"),("Bangor","BarHarbor"),("Rockland","Bangor"),("Farmington","Millinocket"),("Conway","Concord"),
 ("Lincoln","Keene"),("Pittsfield","Worcester"),("Syracuse","OldForge"),("Hyannis","Boston")]
PANJ_PAIRS = [("Wellsboro","Coudersport"),("Ridgway","Williamsport"),("Bradford","Emporium"),("StateCollege","Wellsboro"),
 ("Harrisburg","Williamsport"),("Newton","Scranton"),("Stroudsburg","Honesdale"),("JimThorpe","Milford"),("Warren","Ridgway"),
 ("Clarion","Coudersport"),("Somerset","Altoona"),("Uniontown","Bedford"),("Gettysburg","Lewisburg"),("Chambersburg","Huntingdon"),
 ("Lancaster","Allentown"),("Philadelphia","Allentown"),("AtlanticCity","Trenton"),("CapeMay","Philadelphia"),
 ("Hackettstown","Trenton"),("Pittsburgh","Somerset"),("Erie","Warren"),("Towanda","Scranton"),("Pottsville","Williamsport"),
 ("Hershey","Gettysburg"),("Altoona","StateCollege"),("Johnstown","Pittsburgh"),("Erie","Clarion"),("Allentown","Scranton"),
 ("Lancaster","Bedford"),("Williamsport","Scranton")]
MAIN = ["motorcycle_fastest", "motorcycle_twisty", "motorcycle_adventure"]

def hav(a, b):
    r = 6371.0; p1, p2 = math.radians(a[0]), math.radians(b[0])
    dl = math.radians(b[1]-a[1]); dp = p2-p1
    h = math.sin(dp/2)**2 + math.cos(p1)*math.cos(p2)*math.sin(dl/2)**2
    return 2*r*math.asin(math.sqrt(h))

def route(port, a, b, profile, timeout=120):
    url = f"http://127.0.0.1:{port}/route?point={a[0]},{a[1]}&point={b[0]},{b[1]}&profile={profile}&points_encoded=false&instructions=false"
    t = time.perf_counter()
    try:
        with urllib.request.urlopen(url, timeout=timeout) as r:
            d = json.loads(r.read())
        ok = "paths" in d and bool(d["paths"])
        km = d["paths"][0]["distance"]/1000 if ok else None
        return time.perf_counter()-t, ok, km
    except urllib.error.HTTPError as e:
        return time.perf_counter()-t, False, None
    except Exception:
        return time.perf_counter()-t, False, None

def mem(pid):
    out = {}
    try:
        for line in open(f"/proc/{pid}/status"):
            k, _, v = line.partition(":")
            if k in ("VmRSS", "RssAnon", "RssFile", "VmHWM"):
                out[k] = round(int(v.split()[0]) / 1048576, 3)  # GB
    except Exception as e:
        out["error"] = str(e)
    return out

def pct(xs, q):
    xs = sorted(xs)
    if not xs: return None
    i = (len(xs)-1)*q; lo = int(math.floor(i)); hi = int(math.ceil(i))
    return xs[lo] + (xs[hi]-xs[lo])*(i-lo)

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--dir", required=True); ap.add_argument("--config", default="config-v2.yml")
    ap.add_argument("--xmx", required=True); ap.add_argument("--xms", default="1g")
    ap.add_argument("--pairs", choices=["ne", "panj"], required=True)
    ap.add_argument("--port", type=int, default=8992); ap.add_argument("--admin", type=int, default=8993)
    ap.add_argument("--drop-caches", action="store_true"); ap.add_argument("--label", default="")
    ap.add_argument("--check-pairs", action="store_true")
    a = ap.parse_args()
    names = NE_PAIRS if a.pairs == "ne" else PANJ_PAIRS
    pairs = [(n1, n2, P[n1], P[n2]) for n1, n2 in names]
    if a.check_pairs:
        for n1, n2, p1, p2 in pairs: print(f"{n1}-{n2} {hav(p1,p2):.0f} km")
        return
    for n1, n2, p1, p2 in pairs:
        assert 50 <= hav(p1, p2) <= 200, (n1, n2, hav(p1, p2))
    assert a.port not in (8989, 8990)
    if a.drop_caches:
        subprocess.run(["bash", "-c", "sync; wsl.exe -u root -- sh -c 'sync; echo 3 > /proc/sys/vm/drop_caches'"], check=False)
    os.chdir(a.dir)
    log = open(f"serve-trial-{a.label or 'x'}.log", "w")
    cmd = ["java", f"-Xms{a.xms}", f"-Xmx{a.xmx}", "-cp", "og-ext/og-ext.jar:graphhopper-web-11.0.jar",
           f"-Ddw.server.application_connectors[0].port={a.port}", f"-Ddw.server.admin_connectors[0].port={a.admin}",
           "com.graphhopper.application.GraphHopperApplication", "server", a.config]
    t0 = time.perf_counter()
    proc = subprocess.Popen(cmd, stdout=log, stderr=subprocess.STDOUT, start_new_session=True)
    res = {"label": a.label, "xmx": a.xmx, "config": a.config, "pairs": a.pairs, "cold_caches": a.drop_caches}
    try:
        while True:
            if proc.poll() is not None:
                res["error"] = f"java exited {proc.returncode} before health (see {log.name})"; print(json.dumps(res)); return
            try:
                urllib.request.urlopen(f"http://127.0.0.1:{a.port}/health", timeout=1).read(); break
            except Exception: time.sleep(0.25)
            if time.perf_counter()-t0 > 600: res["error"] = "no health in 600 s"; print(json.dumps(res)); return
        res["start_to_health_s"] = round(time.perf_counter()-t0, 2)
        n1, n2, p1, p2 = pairs[0]
        dt, ok, km = route(a.port, p1, p2, MAIN[0])
        res["first_route_s"] = round(dt, 2); res["first_route_ok"] = ok
        res["start_to_first_answer_s"] = round(time.perf_counter()-t0, 2)
        res["mem_after_first_answer"] = mem(proc.pid)
        reqs = [(p1, p2, pr) for (_, _, p1, p2) in pairs for pr in MAIN]
        passes = []; total = 1; fails = []
        for ps in range(2):
            random.Random(ps).shuffle(reqs)
            todo = reqs
            lat = {pr: [] for pr in MAIN}; ok_n = 0
            for p1, p2, pr in todo:
                dt, ok, km = route(a.port, p1, p2, pr); total += 1
                if ok: lat[pr].append(dt); ok_n += 1
                else: fails.append((p1, p2, pr))
            passes.append({"n": len(todo), "ok": ok_n,
              **{pr.replace("motorcycle_", ""): {"p50": round(pct(v, .5), 3) if v else None, "p95": round(pct(v, .95), 3) if v else None} for pr, v in lat.items()},
              "all": {"p50": round(pct(sum(lat.values(), []), .5), 3), "p95": round(pct(sum(lat.values(), []), .95), 3)}})
        # pad to exactly 200 with scenic and mixed
        k = 0
        while total < 200:
            _, _, p1, p2 = pairs[k % len(pairs)]; pr = ["motorcycle_scenic"] + MAIN
            dt, ok, km = route(a.port, p1, p2, pr[k % 4]); total += 1; k += 1
            if not ok: fails.append((p1, p2, pr[(k-1) % 4]))
        res["requests_total"] = total; res["failed"] = len(fails)
        res["passes"] = passes
        res["mem_after_200"] = mem(proc.pid)
        res["oom_in_log"] = any("OutOfMemory" in l for l in open(log.name, errors="replace"))
    finally:
        try: os.killpg(proc.pid, signal.SIGTERM)
        except Exception: pass
        try: proc.wait(timeout=20)
        except Exception: os.killpg(proc.pid, signal.SIGKILL)
    print(json.dumps(res))
main()
