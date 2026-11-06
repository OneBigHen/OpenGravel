import {describe,it,expect} from 'vitest';
import {mkdtempSync,writeFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {readMediaCache} from '../../../../infra/trails/lib/media-cache';
describe('Wikimedia record cache',()=>{
 it('reuses entities, redirected extracts and photo credits across changed request batches',()=>{
  const dir=mkdtempSync(join(tmpdir(),'media-records-'));
  try {
   writeFileSync(join(dir,'old-batch.json'),JSON.stringify({query:{pages:[{pageid:9,title:'File:View.jpg',imageinfo:[{thumburl:'https://thumb.wikimedia.org/example'}]}]}}));
   writeFileSync(join(dir,'article.json'),JSON.stringify({query:{pages:[{title:'Park',extract:'A public park.',lastrevid:42}],redirects:[{from:'Old park',to:'Park'}]}}));
   writeFileSync(join(dir,'entity.json'),JSON.stringify({entities:{Q1:{sitelinks:{enwiki:{title:'Park'}}}}}));
   writeFileSync(join(dir,'interrupted.json'),'{');
   const cached=readMediaCache(dir);
   expect(cached.photos.get(9)?.title).toBe('File:View.jpg');
   expect(cached.extracts.get('Old park')).toEqual({title:'Park',text:'A public park.',revision:42});
   expect(cached.entities.get('Q1')?.sitelinks?.enwiki?.title).toBe('Park');
  } finally {rmSync(dir,{recursive:true,force:true});}
 });
});
