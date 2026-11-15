import json,glob,sys,time,urllib.request
from concurrent.futures import ThreadPoolExecutor
url=sys.argv[1]; caps=[int(x) for x in sys.argv[2].split(',')]
bodies={}
for f in glob.glob('runs/calls-*.json'):
    for x in json.load(open(f))['calls']:
        b=x.get('body')
        if b and b.get('algorithm')=='round_trip': bodies[json.dumps(b,sort_keys=True)]=(f.split('calls-')[1][:14],x['prof'][11:],b['round_trip.distance'])
print(len(bodies),'bodies')
def run(item):
    k,meta=item; b=json.loads(k); out={}
    for cap in caps:
        if cap: b['max_visited_nodes']=cap
        t=time.time()
        try:
            r=json.load(urllib.request.urlopen(urllib.request.Request(url,json.dumps(b).encode(),{'content-type':'application/json'}),timeout=120))
            out[cap]=('ok',round(time.time()-t,1),r['hints'].get('visited_nodes.sum'),round(r['paths'][0]['distance']/1000))
        except urllib.error.HTTPError as e:
            out[cap]=('fail',round(time.time()-t,1),None,None)
    return meta,out
with ThreadPoolExecutor(3) as ex: res=list(ex.map(run,bodies.items()))
json.dump(res,open(sys.argv[3],'w'))
for meta,out in res:
    if any(v[0]=='fail' for v in out.values()) or out[caps[0]][1]>3: print(meta,out)
