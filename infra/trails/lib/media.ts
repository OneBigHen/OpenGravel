import type { TrailPhoto } from "./rich-types";
export interface CommonsPage {
  readonly pageid?: number;
  readonly title?: string;
  readonly imageinfo?: readonly {readonly thumburl?:string;readonly descriptionurl?:string;readonly thumbwidth?:number;readonly thumbheight?:number;readonly mime?:string;readonly extmetadata?:Readonly<Record<string,{readonly value?:string}>>}[];
}
export function plainCredit(html:string):string {
  return html.replace(/<[^>]*>/g," ").replace(/&#(\d+);/g,(_,n:string)=>String.fromCodePoint(Number(n))).replace(/&amp;/g,"&").replace(/&quot;/g,'"').replace(/&#39;/g,"'").replace(/&nbsp;/g," ").replace(/&lt;/g,"<").replace(/&gt;/g,">").replace(/\s+/g," ").trim();
}
export function commonsPhoto(page:CommonsPage,coordinate:TrailPhoto['coordinate']):Omit<TrailPhoto,'distanceFromTrailMeters'>|null {
  const info=page.imageinfo?.[0],meta=info?.extmetadata;
  const author=plainCredit(meta?.Artist?.value ?? ''),licence=plainCredit(meta?.LicenseShortName?.value ?? ''),licenceUrl=meta?.LicenseUrl?.value?.replace(/^http:/,'https:');
  if(!page.pageid || !page.title || !info?.thumburl || !/^https:\/\/(?:upload|thumb)\.wikimedia\.org\/wikipedia\/commons\/thumb\//.test(info.thumburl) || !info.descriptionurl?.startsWith('https://commons.wikimedia.org/') || !author || !licence || !licenceUrl || !/^https:\/\/creativecommons.org\/(?:licenses\/(?:by|by-sa)\/(?:1.0|2.0|2.5|3.0|4.0)|publicdomain\/(?:zero|mark)\/1.0)(?:\/|$)/.test(licenceUrl) || !['image/jpeg','image/png','image/webp'].includes(info.mime ?? '') || !info.thumbwidth || !info.thumbheight) return null;
  return {pageId:page.pageid,title:plainCredit(page.title.replace(/^File:/,'')),thumbnailUrl:info.thumburl,pageUrl:info.descriptionurl,author,licence,licenceUrl,coordinate,width:info.thumbwidth,height:info.thumbheight,...(meta?.Attribution?.value ? {attribution:plainCredit(meta.Attribution.value)} : {})};
}
