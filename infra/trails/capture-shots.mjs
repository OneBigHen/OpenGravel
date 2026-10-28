/** Real local catalog evidence: no intercepted hike, geometry, geocoder or media APIs. */
import { chromium, expect } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
const base=process.env.HIKE_SHOTS_URL ?? 'http://127.0.0.1:3341';
const out=process.env.HIKE_SHOTS_OUT ?? '/home/zachary/sol/shots/hike-enrich';
const areas=[
  {key:'hawk-mountain',point:{lon:-75.985,lat:40.638},id:'osm:way/28721859'},
  {key:'ricketts-glen',point:{lon:-76.286,lat:41.328},id:'osm:relation/7712014'},
  {key:'delaware-water-gap',point:{lon:-75.1,lat:40.99},id:'njdep:6574'},
];
await mkdir(out,{recursive:true});
const browser=await chromium.launch({headless:true});
const evidence=[];
try {
 for(const theme of ['day','night']) {
  const context=await browser.newContext({viewport:{width:393,height:852},deviceScaleFactor:1,isMobile:true,hasTouch:true});
  await context.addInitScript(({theme,origin})=>{localStorage.setItem('og-activity-mode','hike');localStorage.setItem('og-appearance',theme);if(!sessionStorage.getItem('opengravel.hike.explore-origin'))sessionStorage.setItem('opengravel.hike.explore-origin',JSON.stringify(origin));},{theme,origin:areas[0].point});
  const page=await context.newPage();
  const errors=[];page.on('pageerror',error=>errors.push(error.message));
  for(const area of areas) {
   await page.goto(`${base}/explore`);
   await page.evaluate(point=>{sessionStorage.setItem('opengravel.hike.explore-origin',JSON.stringify(point));sessionStorage.removeItem('opengravel.hike.explore-state');},area.point);
   await page.reload();
   await expect(page.locator('html')).toHaveAttribute('data-theme',theme);
   await expect(page.locator('.og-hike__card').first()).toBeVisible();
   await page.waitForTimeout(1800);
   await page.screenshot({path:join(out,`${theme}-${area.key}-list.png`),animations:'disabled'});
   if(area.key==='hawk-mountain') {
    await page.getByRole('button',{name:/^Filters/}).click();
    await expect(page.getByLabel('Waterfall',{exact:true})).toBeVisible();
    await expect(page.getByLabel('Views',{exact:true})).toBeVisible();
    await page.evaluate(()=>window.scrollTo(0,0));
    await expect(page.getByLabel('Waterfall',{exact:true})).toBeInViewport();
    await expect(page.getByLabel('Views',{exact:true})).toBeInViewport();
    await page.screenshot({path:join(out,`${theme}-filters.png`),animations:'disabled'});
   }
   const response=await page.request.get(`${base}/api/hikes?id=${encodeURIComponent(area.id)}`);
   expect(response.status()).toBe(200);const {hikes}=await response.json();const hike=hikes[0];expect(hike).toBeTruthy();
   await page.goto(`${base}/explore/hikes/${encodeURIComponent(area.id)}`);
   await expect(page.getByRole('heading',{name:hike.name,exact:true})).toBeVisible();
   await page.locator('.og-hike__map canvas').waitFor();
   await page.waitForTimeout(2500);
   await page.evaluate(()=>window.scrollTo(0,0));
   await page.screenshot({path:join(out,`${theme}-${area.key}-trail.png`),animations:'disabled'});
   await expect(page.getByRole('heading',{name:'Along the trail',exact:true})).toBeVisible();
   await page.locator('.og-hike__features').evaluate(el=>el.closest('section').scrollIntoView({block:'start'}));
   await page.screenshot({path:join(out,`${theme}-${area.key}-features.png`),animations:'disabled'});
   if(hike.photos?.length) {
    await expect(page.getByRole('heading',{name:'Photos near the trail',exact:true})).toBeVisible();
    await page.locator('.og-hike__photos').evaluate(el=>el.closest('section').scrollIntoView({block:'start'}));
    await page.waitForTimeout(1200);
    await page.screenshot({path:join(out,`${theme}-${area.key}-photos.png`),animations:'disabled'});
    await expect(page.locator('.og-hike__photos img').first()).toHaveJSProperty('complete',true);
    expect(await page.locator('.og-hike__photos img').first().evaluate(img=>img.naturalWidth)).toBeGreaterThan(0);
   }
   expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
   for(const source of hike.sources)if(source.metadataUrl){const result=await page.request.get(`${base}${source.metadataUrl}`);expect(result.status()).toBe(200);const manifest=await result.json();for(const file of manifest.metadataFiles ?? []){const url=new URL(file,`${base}${source.metadataUrl}`).toString();expect((await page.request.get(url)).status()).toBe(200);}}
   if(hike.sources.some(s=>s.sourceId==='njdep')) await expect(page.getByText(/secondary product has not been verified by NJDEP/)).toBeVisible();
   evidence.push({theme,area:area.key,id:hike.id,name:hike.name,features:hike.features?.length ?? 0,photos:hike.photos?.length ?? 0,descriptions:hike.descriptions?.length ?? 0,sourceIds:[...new Set(hike.sources.map(s=>s.sourceId))]});
  }
  expect(errors).toEqual([]);
  await context.close();
 }
 await writeFile(join(out,'browser-evidence.json'),JSON.stringify(evidence,null,2)+'\n');
 console.log(JSON.stringify(evidence,null,2));
} finally {await browser.close();}
