// Renders the planner's picked loop for each start onto a real street map at 390x844.
// Usage: node .fable/hermes/loop-city/shoot.mjs <results.json> <label: before|after> [run]
import { readFile } from 'node:fs/promises';
import { chromium } from 'playwright';
const [file, label, runArg] = process.argv.slice(2);
const run = Number(runArg ?? 0);
const NAMES = { hatboro: 'Hatboro', doylestown: 'Doylestown', lansdale: 'Lansdale' };
const rows = JSON.parse(await readFile(file, 'utf8')).filter(r => r.run === run && r.geometry);
const browser = await chromium.launch();
try {
  for (const r of rows) {
    const page = await browser.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 });
    const p = r.picked;
    const caption = `${label === 'before' ? 'Before' : 'After'} · Loop from ${NAMES[r.start]}`;
    const facts = `${p.miles} mi · ${p.minutes} min · ${p.curvyMiles} mi of curves · ${Math.round(p.residentialPct + p.cityPct)}% in town`;
    const html = `<!doctype html><html><head><meta charset="utf-8"><link href="https://unpkg.com/maplibre-gl@4.7.1/dist/maplibre-gl.css" rel="stylesheet"><script src="https://unpkg.com/maplibre-gl@4.7.1/dist/maplibre-gl.js"></script>
<style>html,body{margin:0;height:100%;font-family:system-ui,sans-serif;background:#1b1f1c}#m{position:absolute;inset:0}#c{position:absolute;left:12px;right:12px;bottom:18px;background:rgba(20,24,21,.92);color:#eef2ec;border-radius:16px;padding:14px 16px}#c b{font-size:19px;display:block}#c span{font-size:14px;color:#b9c4b6}</style></head>
<body><div id="m"></div><div id="c"><b>${caption}</b><span>${facts}</span></div><script>
const line=${JSON.stringify(r.geometry)};
const map=new maplibregl.Map({container:'m',style:'https://tiles.openfreemap.org/styles/liberty',attributionControl:false});
let b=new maplibregl.LngLatBounds(line[0],line[0]);line.forEach(c=>b.extend(c));
map.fitBounds(b,{padding:{top:40,bottom:130,left:30,right:30},animate:false});
map.on('load',()=>{map.addSource('r',{type:'geojson',data:{type:'Feature',geometry:{type:'LineString',coordinates:line}}});
map.addLayer({id:'rc',type:'line',source:'r',paint:{'line-color':'#fff','line-width':8}});
map.addLayer({id:'rl',type:'line',source:'r',paint:{'line-color':'#6a3fb8','line-width':5}});
map.addSource('s',{type:'geojson',data:{type:'Feature',geometry:{type:'Point',coordinates:line[0]}}});
map.addLayer({id:'sp',type:'circle',source:'s',paint:{'circle-radius':9,'circle-color':'#2e7d4f','circle-stroke-color':'#fff','circle-stroke-width':3}});
map.once('idle',()=>{document.body.dataset.ready='1'});});
</script></body></html>`;
    await page.setContent(html);
    await page.waitForSelector('body[data-ready="1"]', { timeout: 60000 });
    await page.waitForTimeout(500);
    const out = `.fable/shots/loop-city/${label}-${r.start}-390x844.png`;
    await page.screenshot({ path: out });
    console.log('wrote', out, facts);
    await page.close();
  }
} finally { await browser.close(); }
