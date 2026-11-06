/* eslint-disable @next/next/no-img-element -- Commons thumbnail URLs are already sized; no originals or proxy. */
import type { HikeRecord } from "../../../infra/trails/lib/types";
import type { TrailPhoto } from "../../../infra/trails/lib/rich-types";
export function PhotoThumb({photo}:{photo:TrailPhoto}) {
  return <span className="og-hike__thumb"><img src={photo.thumbnailUrl} alt={photo.title} width={104} height={104} loading="lazy" decoding="async" /></span>;
}
export function TrailMedia({hike}:{hike:HikeRecord}) {
  return <>{!!hike.descriptions?.length && <section className="og-hike__section"><h2>From the open encyclopedia</h2>{hike.descriptions.map(d=><article key={d.sourceUrl}><h3>{d.subject}{d.kind === "park" ? " · park" : d.kind === "feature" ? " · nearby feature" : " · trail"}</h3><p>{d.text}</p><p className="og-hike__fine"><a href={d.sourceUrl}>{d.author} ↗</a> · <a href={d.licenceUrl}>{d.licence}</a>{d.revision && <> · <a href={`${d.sourceUrl}?oldid=${d.revision}`}>Source revision</a></>} · Extract; the article may have changed.</p></article>)}</section>}{!!hike.photos?.length && <section className="og-hike__section"><h2>Photos near the trail</h2><p className="og-hike__fine">Geotagged within 300 m of the mapped line. Photos may show nearby places rather than trail conditions.</p><div className="og-hike__photos">{hike.photos.map(p=><figure key={p.pageId}><a href={p.pageUrl}><img src={p.thumbnailUrl} alt={p.title} width={p.width} height={p.height} loading="lazy" decoding="async" /></a><figcaption><a href={p.pageUrl}>{p.title}</a><br />{p.attribution ?? p.author} · <a href={p.licenceUrl}>{p.licence}</a><br />{p.distanceFromTrailMeters} m from mapped trail · Wikimedia Commons</figcaption></figure>)}</div></section>}</>;
}
