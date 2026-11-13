// PF measurements.  node .fable/pf-measure.mjs BASE OUTDIR TAG theme(day|night) look(map|satellite) scenes(lum,counts,ride)
import { chromium } from "playwright";
import { mkdirSync } from "node:fs";
const [base, out, tag, theme = "night", look = "map", scenes = "lum,counts,ride"] = process.argv.slice(2);
mkdirSync(out, { recursive: true });
const W = 390, H = 844;
const b = await chromium.launch();
const LANG = { latitude: 40.1746, longitude: -74.9227, accuracy: 5 };
async function open(scale = 1) {
  const ctx = await b.newContext({ viewport: { width: W, height: H }, isMobile: true, hasTouch: true, deviceScaleFactor: scale, colorScheme: theme === "night" ? "dark" : "light", geolocation: LANG, permissions: ["geolocation"], locale: "en-US", timezoneId: "America/New_York" });
  await ctx.addInitScript(([t, l]) => {
    try { localStorage.setItem("og-appearance", t); localStorage.setItem("opengravel-basemap-look", l); localStorage.setItem("opengravel-vnext-satellite", l === "satellite" ? "1" : "0"); } catch {}
    Object.defineProperty(Object.prototype, "painter", { configurable: true, set(v) { Object.defineProperty(this, "painter", { value: v, writable: true, configurable: true, enumerable: true }); if (typeof this.getStyle === "function") (window.__maps ??= []).push(this); } });
  }, [theme, look]);
  const p = await ctx.newPage();
  return { ctx, p };
}
// decode a PNG buffer in the page and run fn(imageData) there
async function analyse(p, buf, fnSrc, arg) {
  const a = await p.context().newPage();
  const r = await a.evaluate(async ([b64, src, arg]) => {
    const img = new Image(); img.src = "data:image/png;base64," + b64; await img.decode();
    const c = document.createElement("canvas"); c.width = img.width; c.height = img.height; const g = c.getContext("2d"); g.drawImage(img, 0, 0);
    return new Function("data", "w", "h", "arg", src)(g.getImageData(0, 0, img.width, img.height).data, img.width, img.height, arg);
  }, [buf.toString("base64"), fnSrc, arg]);
  await a.close(); return r;
}
async function startPlace(p) {
  await p.goto(base + "/", { waitUntil: "load", timeout: 90000 }).catch(() => {});
  await p.waitForTimeout(7000);
}
if (scenes.includes("lum")) {
  const { ctx, p } = await open(1); await startPlace(p);
  const f = p.getByTestId("top-place-search"); await f.fill("Reading Terminal Market"); await f.press("Enter");
  await p.getByTestId("place-sheet").waitFor({ timeout: 30000 }); await p.waitForTimeout(4000);
  const buf = await p.screenshot({ path: `${out}/${tag}-place.png` });
  const lum = await analyse(p, buf, `let s=0,n=0; for(let y=150;y<520;y++) for(let x=0;x<w;x++){ if(x>320) continue; const i=(y*w+x)*4; s+=0.2126*data[i]+0.7152*data[i+1]+0.0722*data[i+2]; n++; } return s/n;`);
  console.log(JSON.stringify({ tag, meanMapLuminance: +lum.toFixed(2) }));
  await ctx.close();
}
if (scenes.includes("counts")) {
  const { ctx, p } = await open(1); await startPlace(p);
  await p.evaluate(() => (window.__maps.at(-1)).jumpTo({ zoom: 10 }));
  await p.waitForTimeout(9000);
  const r = await p.evaluate(() => { const m = window.__maps.at(-1); const have = (ids) => ids.filter((i) => m.getLayer(i));
    const roads = m.queryRenderedFeatures({ layers: have(["ogv-info-line", "ogv-info-line-minor"]) }).filter((f) => f.properties.layerId === "great-roads");
    const pts = have(["ogv-info-point"]).length ? m.queryRenderedFeatures({ layers: ["ogv-info-point"] }) : [];
    const lines = new Set(roads.map((f) => f.properties.id)); return { zoom: m.getZoom(), greatRoadsRendered: lines.size, infoPoints: pts.length }; });
  console.log(JSON.stringify({ tag, ...r }));
  await ctx.close();
}
if (scenes.includes("ride")) {
  const { ctx, p } = await open(1); await startPlace(p);
  const f = p.getByTestId("top-place-search"); await f.fill("Reading Terminal Market"); await f.press("Enter");
  await p.getByTestId("place-sheet").waitFor({ timeout: 30000 });
  await p.getByTestId("place-directions").click();
  await p.getByTestId("start-ride").waitFor({ timeout: 60000 }); await p.waitForTimeout(12000);
  const line = await p.evaluate(() => { for (const m of window.__maps ?? []) { try { const fs = m.querySourceFeatures("ogv-routes").filter((f) => f.properties?.state === "selected" && f.geometry.type === "LineString"); if (fs.length) return fs.sort((a, b) => b.geometry.coordinates.length - a.geometry.coordinates.length)[0].geometry.coordinates; } catch {} } return null; });
  await p.getByTestId("start-ride").click(); await p.waitForTimeout(4000);
  const pts = []; for (let i = 0; i + 1 < line.length && pts.length < 400; i++) { const [x1, y1] = line[i], [x2, y2] = line[i + 1]; const d = Math.hypot((x2 - x1) * 85000, (y2 - y1) * 111000); const n = Math.max(1, Math.round(d / 15)); for (let k = 0; k < n; k++) pts.push([x1 + ((x2 - x1) * k) / n, y1 + ((y2 - y1) * k) / n]); }
  for (let i = 0; i < 60; i++) { await ctx.setGeolocation({ longitude: pts[i][0], latitude: pts[i][1], accuracy: 5 }); await p.waitForTimeout(700); }
  await p.waitForTimeout(2500);
  await p.screenshot({ path: `${out}/${tag}-ride.png` });
  // puck position, zoom
  const info = await p.evaluate(() => { const m = window.__maps.at(-1); const fs = m.queryRenderedFeatures({ layers: ["ogv-rider-heading"] }); const pos = fs[0] ? m.project(fs[0].geometry.coordinates) : null;
    return { pos: pos ? [pos.x, pos.y] : null, zoom: m.getZoom(), pitch: m.getPitch() }; });
  // hide every basemap label and our arrows, and the UI, so only roads, the line and the puck remain
  await p.evaluate(() => { const m = window.__maps.at(-1); for (const l of m.getStyle().layers) if (l.type === "symbol" && l.id !== "ogv-rider-heading") m.setLayoutProperty(l.id, "visibility", "none"); document.querySelectorAll(".og-ride__top,.og-ride__strip,.og-ride__float").forEach((e) => (e.style.visibility = "hidden")); });
  await p.waitForTimeout(1500);
  const buf = await p.screenshot({ path: `${out}/${tag}-ride-clean.png` });
  const core = theme === "night" ? [201, 162, 240] : [123, 79, 160];
  const res = await analyse(p, buf, `
    const [px,py]=arg.pos, core=arg.core; const near=(i,c,t)=>Math.abs(data[i]-c[0])+Math.abs(data[i+1]-c[1])+Math.abs(data[i+2]-c[2])<t;
    const L=(i)=>{const f=(v)=>{v/=255;return v<=0.03928?v/12.92:Math.pow((v+0.055)/1.055,2.4)};return 0.2126*f(data[i])+0.7152*f(data[i+1])+0.0722*f(data[i+2])};
    // puck: blue fill bbox, grown through white ring pixels
    let x0=1e9,x1=-1,y0=1e9,y1=-1; for(let y=Math.max(0,py-60);y<Math.min(h,py+60);y++)for(let x=Math.max(0,px-60);x<Math.min(w,px+60);x++){const i=(y*w+x)*4; if(data[i+2]>190&&data[i]<130&&data[i+1]>110&&data[i+2]-data[i]>90){x0=Math.min(x0,x);x1=Math.max(x1,x);y0=Math.min(y0,y);y1=Math.max(y1,y);}}
    const blue={w:x1-x0+1,h:y1-y0+1};
    // line 60px ahead (screen up)
    const ay=Math.round(py-60); let best=null; for(let yy=ay-30;yy<=ay+30;yy+=10){ let run=0,sx=-1; const mid=Math.round(px); let l=mid,r=mid; if(!near((yy*w+mid)*4,core,60)){ let found=false; for(let d=1;d<40&&!found;d++){ if(near((yy*w+mid-d)*4,core,60)){l=r=mid-d;found=true} else if(near((yy*w+mid+d)*4,core,60)){l=r=mid+d;found=true} } if(!found) continue; } while(near((yy*w+l-1)*4,core,60))l--; while(near((yy*w+r+1)*4,core,60))r++; best={y:yy,width:r-l+1,cx:Math.round((l+r)/2)}; if(yy===ay)break; }
    let contrast=null; if(best){ const ci=(best.y*w+best.cx)*4; const lc=L(ci); let max=0,mx=0,my=0; for(let y=Math.max(0,best.y-60);y<Math.min(h,best.y+60);y++)for(let x=Math.max(0,best.cx-60);x<Math.min(w,best.cx+60);x++){ if(Math.hypot(x-best.cx,y-best.y)>60)continue; if(Math.hypot(x-px,y-py)<45)continue; const i=(y*w+x)*4; if(near(i,core,140))continue; if(data[i+2]-data[i+1]>35)continue; const v=L(i); if(v>max){max=v;mx=x;my=y;}} contrast={lineLum:+lc.toFixed(3),brightestOther:+max.toFixed(3),at:[mx,my],rgb:[data[(my*w+mx)*4],data[(my*w+mx)*4+1],data[(my*w+mx)*4+2]],ratio:+((Math.max(lc,max)+0.05)/(Math.min(lc,max)+0.05)).toFixed(2)}; }
    const ci2=((Math.round(py)-10)*w+Math.round(px))*4; return {blue,puckRgbAbove:[data[ci2],data[ci2+1],data[ci2+2]],line:best,contrast};`, { pos: info.pos, core });
  const feats = res.contrast ? await p.evaluate(([x, y]) => (window.__maps.at(-1)).queryRenderedFeatures([x, y]).map((f) => f.layer.id + ":" + (f.properties?.class ?? "")), res.contrast.at) : [];
  console.log(JSON.stringify({ featsAtBrightest: feats }));
  console.log(JSON.stringify({ tag, puckPos: info.pos, puckYPct: info.pos ? +(info.pos[1] / H * 100).toFixed(1) : null, zoom: info.zoom, ...res }));
  await ctx.close();
}
await b.close();
