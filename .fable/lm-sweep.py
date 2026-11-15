import json,glob,sys,time,urllib.request
from concurrent.futures import ThreadPoolExecutor
url=sys.argv[1]
bodies={}
for f in glob.glob('runs/calls-*.json'):
    for x in json.load(open(f))['calls']:
        b=x.get('body')
        if b and b.get('algorithm')=='round_trip': b=dict(b); b['max_visited_nodes']=1500000; bodies[json.dumps(b,sort_keys=True)]=1
def one(b):
    t=time.time()
    try:
        r=json.load(urllib.request.urlopen(urllib.request.Request(url,json.dumps(b).encode(),{'content-type':'application/json'}),timeout=120))
        return ('ok',round(time.time()-t,2),r['hints'].get('visited_nodes.sum'),r['paths'][0]['distance'],r['paths'][0]['time'])
    except urllib.error.HTTPError as e: return ('fail',round(time.time()-t,2),None,None,None)
res=[]
for k in bodies:
    b=json.loads(k); a=one(b); b['lm.disable']=True; c=one(b); res.append((a,c))
same=sum(1 for a,c in res if a[3]==c[3]); print(len(res),'same dist',same)
print('time with LM',round(sum(a[1] for a,c in res),1),'without',round(sum(c[1] for a,c in res),1))
for a,c in res:
    if a[3]!=c[3]: print(a,c)
