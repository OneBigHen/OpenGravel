import json,glob,sys,time,urllib.request
from concurrent.futures import ThreadPoolExecutor
bodies=[]
seen=set()
for f in glob.glob('runs/calls-prod-base*.json')+glob.glob('runs/calls-prodB*.json')+glob.glob('runs/calls-cap*.json'):
    for x in json.load(open(f))['calls']:
        b=x.get('body')
        if b and b.get('algorithm')=='round_trip':
            b=dict(b); b['max_visited_nodes']=1500000; k=json.dumps(b,sort_keys=True)
            if k not in seen: seen.add(k); bodies.append(b)
def one(url,b):
    try: r=json.load(urllib.request.urlopen(urllib.request.Request(url,json.dumps(b).encode(),{'content-type':'application/json'}),timeout=300)); return r['hints'].get('visited_nodes.sum') or 0
    except urllib.error.HTTPError: return 0
for url in sys.argv[1:]:
    res=[]
    for p in range(3):
        t=time.time(); n=sum(one(url,b) for b in bodies); res.append((round(time.time()-t,1),round(n/1e6,1)))
    t=time.time()
    with ThreadPoolExecutor(8) as ex: n=sum(ex.map(lambda b: one(url,b),bodies))
    print(url,'seq passes',res,'par8',round(time.time()-t,1))
