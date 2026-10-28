import {describe,it,expect} from "vitest";
import {commonsPhoto,plainCredit} from "../../../../infra/trails/lib/media";
const good={pageid:1,title:"File:Falls.jpg",imageinfo:[{thumburl:"https://upload.wikimedia.org/wikipedia/commons/thumb/a/ab/Falls.jpg/640px-Falls.jpg",descriptionurl:"https://commons.wikimedia.org/wiki/File:Falls.jpg",mime:"image/jpeg",thumbwidth:640,thumbheight:480,extmetadata:{Artist:{value:'<a href="x">Jane &amp; John</a>'},LicenseShortName:{value:"CC BY-SA 4.0"},LicenseUrl:{value:"https://creativecommons.org/licenses/by-sa/4.0/"}}}]};
describe("Commons photo provenance",()=>{
 it("keeps author licence source page and a thumbnail, strips credit HTML",()=>{
  expect(commonsPhoto(good,{lon:-75,lat:40})).toMatchObject({author:"Jane & John",licence:"CC BY-SA 4.0",pageUrl:good.imageinfo[0]!.descriptionurl,thumbnailUrl:good.imageinfo[0]!.thumburl});
  const current={...good,imageinfo:[{...good.imageinfo[0]!,thumburl:good.imageinfo[0]!.thumburl.replace('upload.wikimedia','thumb.wikimedia'),extmetadata:{...good.imageinfo[0]!.extmetadata,LicenseUrl:{value:'https://creativecommons.org/licenses/by-sa/4.0'}}}]};
  expect(commonsPhoto(current,{lon:-75,lat:40})?.licence).toBe('CC BY-SA 4.0');
  expect(plainCredit('<b>Credit</b> &#169;')).toBe('Credit ©');
 });
 it("refuses originals and unknown or non-open licences instead of assuming Commons means permitted",()=>{
  const info=good.imageinfo[0]!;
  expect(commonsPhoto({...good,imageinfo:[{...info,thumburl:'https://upload.wikimedia.org/wikipedia/commons/a/ab/Falls.jpg'}]},{lon:0,lat:0})).toBeNull();
  expect(commonsPhoto({...good,imageinfo:[{...info,extmetadata:{...info.extmetadata,LicenseUrl:{value:'https://example.org/all-rights-reserved'}}}]},{lon:0,lat:0})).toBeNull();
  expect(commonsPhoto({...good,imageinfo:[{...info,extmetadata:{...info.extmetadata,Artist:{value:''}}}]},{lon:0,lat:0})).toBeNull();
 });
});
