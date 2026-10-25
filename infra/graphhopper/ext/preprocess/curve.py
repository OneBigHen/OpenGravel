"""Local Franco-v1 curvature pre-pass. No OSM IDs, nodes, ways or relations are split.

Adds og:curve=v1;<latE7>:<lonE7>:<distance_mm>:<curve_area_mm>;... to road ways.
The cumulative windowed curve area lets a TagParser integrate exactly over each GH
edge's two endpoints even after GH simplifies the interior geometry. Not a road score.
"""
from array import array
from bisect import bisect_right
from collections import defaultdict, deque
import argparse
import base64
import zlib
import json
import hashlib
import math
from pathlib import Path
import time

R = 6371000
IGNORED = {"footway", "construction", "cycleway", "path", "steps"}
STREETS = {"residential", "residential_link", "service", "service_link", "living_street", "living_street_link"}


def distance(a, b):
    la, lb = math.radians(a[0]), math.radians(b[0])
    h = math.sin((lb-la)/2)**2 + math.cos(la)*math.cos(lb)*math.sin(math.radians(b[1]-a[1])/2)**2
    return 2*R*math.asin(min(1, math.sqrt(h)))


def heading(a, b):
    la, lb = math.radians(a[0]), math.radians(b[0])
    dl = math.radians(b[1]-a[1])
    return math.atan2(math.sin(dl)*math.cos(lb), math.cos(la)*math.sin(lb)-math.sin(la)*math.cos(lb)*math.cos(dl))


def angle(a, b):
    return abs(((b-a+math.pi*3) % (math.pi*2))-math.pi)


def vertex_weights(line):
    """Exact app Franco-v1 primitive, before graph-specific suppression/windowing."""
    n = len(line)
    if n < 2:
        return [0.0]*n, []
    lengths = [distance(a, b) for a, b in zip(line, line[1:])]
    headings = [heading(a, b) for a, b in zip(line, line[1:])]
    cos = math.cos(math.radians(line[0][0]))
    xy = [((lon-line[0][1])*111320*cos, (lat-line[0][0])*110540) for lat, lon in line]
    weights = [0.0]*n
    for i in range(1, n-1):
        if lengths[i-1] < 1 or lengths[i] < 1:
            continue
        a, b, c = xy[i-1:i+2]
        ab, bc, ca = math.dist(a,b), math.dist(b,c), math.dist(c,a)
        area2 = abs((b[0]-a[0])*(c[1]-a[1])-(b[1]-a[1])*(c[0]-a[0]))
        if area2 < 1e-6 or min(ab,bc,ca) < 1:
            continue
        radius = ab*bc*ca/(2*area2)
        weight = 2 if radius < 30 else 1.6 if radius < 60 else 1.3 if radius < 100 else 1 if radius < 175 else 0
        if not weight:
            continue
        noisy = False
        for count in range(3,8):
            target = min(n-1,i+count)
            gap = sum(lengths[i:target])
            deflection = angle(headings[i-1], headings[i])
            for vertex in range(i+1,target-1):
                deflection += angle(headings[vertex],headings[vertex+1])
            if gap > 0 and deflection < gap/175:
                noisy = True
                break
        if not noisy:
            weights[i] = weight
    return weights, lengths


def raw_measure(line):
    weights, lengths = vertex_weights(line)
    return sum(length*max(weights[i],weights[i+1]) for i,length in enumerate(lengths))


def masked_integral(positions, density, control_positions):
    """Clip weighted segment portions within 30m along-road of each control."""
    intervals=[]
    for control in sorted(control_positions):
        left,right=max(0,control-30),min(positions[-1],control+30)
        if intervals and left <= intervals[-1][1]:
            intervals[-1]=(intervals[-1][0],max(right,intervals[-1][1]))
        else:
            intervals.append((left,right))
    knots=sorted(set(positions+[v for interval in intervals for v in interval]))
    values=[]; areas=[0.0]; block=0
    for left,right in zip(knots,knots[1:]):
        mid=(left+right)/2
        while block<len(intervals) and intervals[block][1]<mid: block+=1
        blocked=block<len(intervals) and intervals[block][0]<=mid<=intervals[block][1]
        index=min(len(density)-1,max(0,bisect_right(positions,mid)-1))
        value=0 if blocked else density[index]
        values.append(value); areas.append(areas[-1]+(right-left)*value)
    return knots,values,areas


def window_integrals(line, controls=()):
    """400 m centred window of weighted curve metres/metre, capped at one.

    Clip the window at collection ends, rather than manufacturing 400 m of straight
    road. Suppress all curve vertices within 30 m of a junction/control along the
    collection. Symmetric noise rejection makes source way direction irrelevant.
    """
    fw, lengths = vertex_weights(line)
    rw, _ = vertex_weights(line[::-1])
    weights = [min(a,b) for a,b in zip(fw,rw[::-1])]
    positions = [0.0]
    for length in lengths:
        positions.append(positions[-1]+length)
    # O(n) nearest-control suppression along the collection, no all-pairs geometry scan.
    last = -math.inf
    controls = set(controls)
    for i in range(len(line)):
        if i in controls:
            last = positions[i]
        if positions[i]-last <= 30:
            weights[i] = 0
    last = math.inf
    for i in range(len(line)-1,-1,-1):
        if i in controls:
            last = positions[i]
        if last-positions[i] <= 30:
            weights[i] = 0
    # Also catch a tight bend that comes physically back near the junction after
    # travelling more than 30 m. Use a local spatial grid, then the app's haversine.
    if controls:
        lon_scale = 111320*max(.01,math.cos(math.radians(line[0][0])))
        buckets = defaultdict(list)
        def cell(point):
            return (math.floor(point[0]*110540/60),math.floor(point[1]*lon_scale/60))
        for i in controls:
            buckets[cell(line[i])].append(line[i])
        for i,weight in enumerate(weights):
            if not weight:
                continue
            row,col = cell(line[i])
            if any(distance(line[i],control) <= 30
                   for dr in (-1,0,1) for dc in (-1,0,1)
                   for control in buckets.get((row+dr,col+dc),())):
                weights[i] = 0
    density = [max(weights[i],weights[i+1]) for i in range(len(lengths))]
    knots,raw_density,raw_area = masked_integral(positions,density,[positions[i] for i in controls])

    def area_at(position):
        if position >= knots[-1]:
            return raw_area[-1]
        i = min(len(raw_density)-1,max(0,bisect_right(knots,position)-1))
        return raw_area[i]+(position-knots[i])*raw_density[i]

    smooth_area = [0.0]
    for i,length in enumerate(lengths):
        midpoint = (positions[i]+positions[i+1])/2
        left, right = max(0,midpoint-200), min(positions[-1],midpoint+200)
        value = min(1,max(0,(area_at(right)-area_at(left))/(right-left))) if right>left else 0
        smooth_area.append(smooth_area[-1]+length*value)
    return positions,smooth_area


def make_tag(line, positions, areas):
    # Coordinates and cumulative integrals are integral for deterministic compact output.
    text = "v1;"+";".join(f"{round(lat*1e7)}:{round(lon*1e7)}:{round(pos*1000)}:{round(area*1000)}"
                           for (lat,lon),pos,area in zip(line,positions,areas))
    return "v1z:"+base64.b64encode(zlib.compress(text.encode(),6)).decode()


def identity(tags):
    name = tags.get("name", "").strip().casefold()
    refs = {"ref:"+part.strip().casefold() for part in tags.get("ref", "").split(";") if part.strip()}
    if name: refs.add("name:"+name)
    # Any shared normalized name or individual ref preserves continuity, even
    # when OSM class/ref-list tagging changes at an otherwise degree-two node.
    return frozenset(refs) if refs else None


class Road:
    __slots__ = ("nodes","coords","key","street")
    def __init__(self,nodes,coords,key,street):
        self.nodes=array("q",nodes)
        self.coords=array("d",coords)
        self.key=key
        self.street=street
    def line(self):
        return list(zip(self.coords[::2],self.coords[1::2]))


def score_roads(roads, degree, controls, emit):
    """Join only matching named/ref ways at degree-two endpoints. Preserve boundaries."""
    endpoints=defaultdict(list)
    for wid,road in roads.items():
        endpoints[road.nodes[0]].append(wid)
        endpoints[road.nodes[-1]].append(wid)
    visited=set()
    collections=0
    for wid,road in roads.items():
        if wid in visited:
            continue
        chain=deque([(wid,False)])
        visited.add(wid)
        if not road.street and road.key is not None:
            for at_front in (True,False):
                while True:
                    current,reverse=chain[0] if at_front else chain[-1]
                    r=roads[current]
                    end=r.nodes[-1 if reverse == at_front else 0]
                    # front: start of oriented way; back: end of oriented way.
                    if degree.get(end,0) != 2 or len(endpoints[end]) != 2:
                        break
                    choices=[candidate for candidate in endpoints[end] if candidate not in visited]
                    if not choices:
                        break
                    nxt=choices[0]
                    other=roads[nxt]
                    if other.street or not other.key or not r.key or not other.key.intersection(r.key):
                        break
                    reversed_other=(other.nodes[0] == end) if at_front else (other.nodes[-1] == end)
                    entry=(nxt,reversed_other)
                    if at_front:
                        chain.appendleft(entry)
                    else:
                        chain.append(entry)
                    visited.add(nxt)
        line=[]
        node_ids=[]
        spans=[]
        for current,reverse in chain:
            r=roads[current]
            points=r.line()
            nodes=list(r.nodes)
            if reverse:
                points.reverse(); nodes.reverse()
            start=max(0,len(line)-1)
            if line:
                line.extend(points[1:]); node_ids.extend(nodes[1:])
            else:
                line.extend(points); node_ids.extend(nodes)
            spans.append((current,reverse,start,start+len(points)))
        suppress={i for i,node in enumerate(node_ids) if degree.get(node,0)>2 or node in controls}
        if road.street:
            positions=[0.0]
            for a,b in zip(line,line[1:]): positions.append(positions[-1]+distance(a,b))
            areas=[0.0]*len(line)
        else:
            positions,areas=window_integrals(line,suppress)
        for current,reverse,start,end in spans:
            points=line[start:end]
            pos=positions[start:end]
            area=areas[start:end]
            if reverse:
                points=points[::-1]
                pos=[pos[-1]-v for v in pos[::-1]]
                area=[area[-1]-v for v in area[::-1]]
            else:
                pos=[v-pos[0] for v in pos]
                area=[v-area[0] for v in area]
            emit(current,make_tag(points,pos,area))
        collections+=1
    return collections


def write_tagged_file(source, output, db):
    import osmium
    reader=osmium.io.Reader(str(source))
    header=reader.header()
    reader.close()
    writer=osmium.SimpleWriter(str(output),header=header)
    class Write(osmium.SimpleHandler):
        def node(self,node): writer.add_node(node)
        def way(self,way):
            row=db.execute("SELECT tag FROM curves WHERE way_id=?",(way.id,)).fetchone()
            if row:
                tags=dict(way.tags)
                payload=row[0][4:]
                parts=[payload[i:i+240] for i in range(0,len(payload),240)]
                # OSM tag values are limited to 255 bytes. Keep ASCII chunks below that limit.
                tags["og:curve"]="v1z:"+str(len(parts))
                tags.update({f"og:curve:{i}":part for i,part in enumerate(parts)})
                writer.add_way(way.replace(tags=tags))
            else:
                writer.add_way(way)
        def relation(self,relation): writer.add_relation(relation)
    try:
        Write().apply_file(str(source))
    finally:
        writer.close()


def main():
    import osmium  # pyosmium is needed only for the PBF passes, not the shared geometry tests.
    import sqlite3
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--memory-gb",type=int,default=24,help="Linux process address-space ceiling (default 24 GiB)")
    parser.add_argument("input",type=Path)
    parser.add_argument("output",type=Path)
    args=parser.parse_args()
    import resource
    if args.memory_gb < 1: parser.error("memory-gb must be positive")
    ceiling=args.memory_gb*1024**3
    resource.setrlimit(resource.RLIMIT_AS,(ceiling,ceiling))
    if args.output.exists() or args.input.resolve()==args.output.resolve():
        parser.error("output must be NEW; never replace the source extract")
    db_path=Path(str(args.output)+".curve.sqlite")
    if db_path.exists(): parser.error("sidecar exists; use a new output name")
    start=time.monotonic()
    with args.input.open("rb") as source:
        input_sha=hashlib.file_digest(source,"sha256").hexdigest()
    with Path(__file__).open("rb") as source:
        algorithm_sha=hashlib.file_digest(source,"sha256").hexdigest()
    roads={}; degree=defaultdict(int); controls=set()
    class Collect(osmium.SimpleHandler):
        def node(self,node):
            if node.tags.get("barrier") or node.tags.get("ford") or node.tags.get("highway") in ("traffic_signals","stop","give_way"):
                controls.add(node.id)
        def way(self,way):
            highway=way.tags.get("highway")
            if "og:curve" in way.tags:
                raise ValueError("Input already has og:curve tags; use the original extract")
            if not highway or highway in IGNORED or len(way.nodes)<2:
                return
            # Fail on incomplete extracts instead of making a false straight connector.
            nodes=[n.ref for n in way.nodes]
            coords=[c for n in way.nodes for c in (n.lat,n.lon)]
            roads[way.id]=Road(nodes,coords,identity(dict(way.tags)),highway in STREETS)
            for i,node in enumerate(nodes): degree[node]+=1 if i in (0,len(nodes)-1) else 2
    Collect().apply_file(str(args.input),locations=True,idx="flex_mem")
    print(f"COLLECT ways={len(roads)} nodes={len(degree)} controls={len(controls)} seconds={time.monotonic()-start:.2f}",flush=True)
    db=sqlite3.connect(db_path)
    db.execute("CREATE TABLE curves (way_id INTEGER PRIMARY KEY, tag TEXT NOT NULL)")
    count=0
    def emit(wid,tag):
        nonlocal count
        db.execute("INSERT INTO curves VALUES (?,?)",(wid,tag))
        count+=1
        if count%100000==0:
            db.commit()
            print(f"SCORED ways={count}",flush=True)
    collections=score_roads(roads,degree,controls,emit)
    db.commit()
    del roads,degree,controls
    try:
        write_tagged_file(args.input,args.output,db)
    finally:
        db.close()
    with args.output.open("rb") as generated:
        output_sha=hashlib.file_digest(generated,"sha256").hexdigest()
    metadata={"inputSha256":input_sha,"outputSha256":output_sha,"algorithmSha256":algorithm_sha,"version":"og-curve-window-v1","ways":count,"collections":collections,"seconds":time.monotonic()-start,"input":str(args.input.resolve()),"output":str(args.output.resolve())}
    Path(str(args.output)+".json").write_text(json.dumps(metadata,indent=2)+"\n")
    print(json.dumps(metadata),flush=True)


if __name__ == "__main__":
    main()
