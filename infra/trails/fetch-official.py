#!/usr/bin/env python3
"""Download complete ArcGIS ID batches, retaining source metadata and terms.
Only explicitly reviewed sources are enabled. No assumption that public access
alone grants redistribution. Data files live on the bulk-data volume.
"""
import concurrent.futures, hashlib, json, pathlib, sys, urllib.parse, urllib.request
ROOT = pathlib.Path(sys.argv[1] if len(sys.argv)>1 else '/mnt/wsl/ogv-data/trails/src/official')
SOURCES = {
 'usfs': ('https://apps.fs.usda.gov/arcx/rest/services/EDW/EDW_TrailNFSPublish_01/MapServer/0', 'Public domain (US federal government)', 'https://www.usa.gov/government-works'),
 'nps': ('https://mapservices.nps.gov/arcgis/rest/services/NationalDatasets/NPS_Public_Trails/FeatureServer/0', 'Public domain (US federal government)', 'https://www.usa.gov/government-works'),
 'njdep': ('https://services1.arcgis.com/QWdNfRs7lkPq4g4Q/arcgis/rest/services/NJ_State_Park_Service_Trails_h/FeatureServer/63', 'NJDEP Data Distribution Agreement', 'https://www.arcgis.com/home/item.html?id=0eb7372cf7724f21ae359ad6d2900e24'),
}
def request(url, params=None):
 if params: url += '?' + urllib.parse.urlencode(params)
 req=urllib.request.Request(url,headers={'User-Agent':'OpenGravel-trail-catalog/1.0 (open-source offline catalog)'})
 with urllib.request.urlopen(req,timeout=90) as r: data=r.read()
 return data

def fetch(key, spec):
 url,licence,licence_url=spec
 folder=ROOT/key;folder.mkdir(parents=True,exist_ok=True)
 metadata=json.loads(request(url,{'f':'json'})); (folder/'layer.json').write_text(json.dumps(metadata,indent=2))
 if 'error' in metadata: raise RuntimeError(metadata)
 # PA/NJ rectangle: also captures a small boundary fringe; not a state polygon clip.
 params={'f':'json','where':'1=1','geometry':'-80.53,38.9,-73.88,42.27','geometryType':'esriGeometryEnvelope','inSR':4326,'spatialRel':'esriSpatialRelIntersects','returnIdsOnly':'true'}
 ids=json.loads(request(url+'/query',params))
 if 'objectIds' not in ids: raise RuntimeError(ids)
 object_ids=sorted(ids['objectIds'] or []); features=[]
 for offset in range(0,len(object_ids),150):
  batch=object_ids[offset:offset+150]
  data=json.loads(request(url+'/query',{'f':'geojson','objectIds':','.join(map(str,batch)),'outFields':'*','outSR':4326,'returnGeometry':'true','returnZ':'false','returnM':'false'}))
  if 'features' not in data or len(data['features'])!=len(batch) or data.get('exceededTransferLimit'): raise RuntimeError(f'incomplete {key} batch {offset}: {data.keys()}')
  features.extend(data['features']);print(key,len(features),len(object_ids),flush=True)
 if key=='njdep':
  item='https://www.arcgis.com/sharing/rest/content/items/0eb7372cf7724f21ae359ad6d2900e24'
  (folder/'item.json').write_bytes(request(item,{'f':'json'}))
  (folder/'metadata.xml').write_bytes(request(item+'/info/metadata/metadata.xml'))
 content=(json.dumps({'type':'FeatureCollection','features':features},separators=(',',':'))+'\n').encode()
 (ROOT/(key+'.geojson')).write_bytes(content)
 manifest={'sourceId':key,'url':url,'licence':licence,'licenceUrl':licence_url,'recordCount':len(features),'sha256':hashlib.sha256(content).hexdigest(),'metadataFiles':['layer.json','manifest.json']+(['item.json','metadata.xml'] if key=='njdep' else []),'queryBbox':[-80.53,38.9,-73.88,42.27],'retrievedDate':'2026-10-28','coordinateReferenceSystem':'EPSG:4326; transformed by ArcGIS outSR from the documented source CRS'}
 (folder/'manifest.json').write_text(json.dumps(manifest,indent=2)+'\n')
 return manifest
def fetch_dcnr():
 folder=ROOT/'dcnr';folder.mkdir(parents=True,exist_ok=True)
 portal=json.loads(request('https://data.pa.gov/api/views/hguq-h588.json'))
 if portal.get('licenseId')!='USGOV_WORKS': raise RuntimeError('PA portal public-domain declaration changed; review before importing')
 (folder/'portal.json').write_text(json.dumps(portal,indent=2)+'\n')
 (folder/'layer.json').write_text(json.dumps({'fields':[{'name':c['fieldName'],'description':c.get('description')} for c in portal['columns']]},indent=2)+'\n')
 endpoint='https://data.pa.gov/resource/hguq-h588'
 expected=int(json.loads(request(endpoint+'.json',{'$select':'count(*)'}))[0]['count'])
 features=[]
 for offset in range(0,expected,500):
  page=json.loads(request(endpoint+'.geojson',{'$limit':500,'$offset':offset,'$order':'objectid'}))
  features.extend(page['features'])
 if len(features)!=expected or len({f['properties']['objectid'] for f in features})!=expected: raise RuntimeError('Incomplete/duplicate PA portal download')
 content=(json.dumps({'type':'FeatureCollection','features':features},separators=(',',':'))+'\n').encode()
 (ROOT/'dcnr.geojson').write_bytes(content)
 manifest={'sourceId':'dcnr','url':endpoint+'.json','licence':'Public domain (PA Open Data portal declaration: USGOV_WORKS)','licenceUrl':'https://data.pa.gov/Services-Near-You/Trails-Simple-Geometry/hguq-h588','recordCount':len(features),'sha256':hashlib.sha256(content).hexdigest(),'metadataFiles':['portal.json','layer.json','manifest.json'],'retrievedDate':'2026-10-28','coordinateReferenceSystem':'EPSG:4326; published Socrata GeoJSON','note':'Only this explicitly public-domain portal release; no grant inferred for other DCNR downloads.'}
 (folder/'manifest.json').write_text(json.dumps(manifest,indent=2)+'\n');print(json.dumps(manifest),flush=True)

ROOT.mkdir(parents=True,exist_ok=True)
# Public-domain US Census state mask selects records, without clipping lines.
state_url='https://tigerweb.geo.census.gov/arcgis/rest/services/TIGERweb/State_County/MapServer/0/query'
(ROOT/'states.geojson').write_bytes(request(state_url,{'where':"STATE IN ('42','34')",'f':'geojson','outFields':'STATE,NAME','outSR':4326,'maxAllowableOffset':.0001}))
with concurrent.futures.ThreadPoolExecutor(max_workers=3) as executor:
 for result in executor.map(lambda kv:fetch(*kv),SOURCES.items()):print(json.dumps(result),flush=True)

fetch_dcnr()
