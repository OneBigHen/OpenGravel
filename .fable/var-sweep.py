import json,glob,sys,time,urllib.request
url=sys.argv[1]; variants=[json.loads(v) for v in sys.argv[2:]]
bodies={}
for f in glob.glob('runs/calls-prod-base*.json')+glob.glob('runs/calls-prodB*.json')+glob.glob('runs/calls-cap*.json'):
    for x in json.load(open(f))['calls']:
        b=x.get('body')
        if b and b.get('algorithm')=='round_trip': b=dict(b); b['max_visited_nodes']=1500000; bodies[json.dumps(b,sort_keys=True)]=1
def one(b):
    t=time.time()
    try:
        r=json.load(urllib.request.urlopen(urllib.request.Request(url,json.dumps(b).encode(),{'content-type':'application/json'}),timeout=120))
        return (round(time.time()-t,2),r['hints'].get('visited_nodes.sum'),r['paths'][0]['distance'],r['paths'][0]['points']['coordinates'][:1] and len(r['paths'][0]['points']['coordinates']))
    except urllib.error.HTTPError: return (round(time.time()-t,2),None,None,None)
print(len(bodies),'bodies')
base=[]; res={json.dumps(v):[] for v in variants}
for k in bodies:
    b=json.loads(k); base.append(one(b))
    for v in variants:
        bb=dict(b); bb.update(v); res[json.dumps(v)].append(one(bb))
def tot(l): return round(sum(x[0] for x in l),1), sum(x[1] or 0 for x in l)/1e6
print('base time/nodesM',tot(base))
for v,l in res.items():
    same=sum(1 for a,c in zip(base,l) if a[2]==c[2])
    print(v,'time/nodesM',tot(l),'same route',same,'/',len(base))
