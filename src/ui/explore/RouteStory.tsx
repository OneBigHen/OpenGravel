"use client";

import Image from "next/image";
import { useRef, useState } from "react";

import type { CatalogRideStory, RideStopKind } from "@/application/explore/ride-story";

const STOP_LABEL: Readonly<Record<RideStopKind, string>> = {
  fuel: "Fuel",
  food: "Food",
  water: "Water crossing",
  hazard: "Heads up",
  sight: "Worth a stop",
  parking: "Parking",
  start: "Start / finish",
  other: "Marked",
};

const STOP_GLYPH: Readonly<Record<RideStopKind, string>> = {
  fuel: "⛽",
  food: "🍴",
  water: "≈",
  hazard: "!",
  sight: "◎",
  parking: "P",
  start: "⚑",
  other: "•",
};

const COMMENTS_SHOWN = 4;
const DESCRIPTION_CLAMP = 420;

function monthYear(iso: string | undefined): string | null {
  if (iso === undefined) return null;
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return null;
  // UTC keeps the server and client render identical.
  return date.toLocaleDateString("en-US", { month: "short", year: "numeric", timeZone: "UTC" });
}

function Paragraphs({ text }: { readonly text: string }) {
  return text.split(/\n{2,}|\n/).filter((line) => line.trim().length > 0).map((line, index) => <p key={index}>{line}</p>);
}

export function RouteStory({ story, routeName }: { readonly story: CatalogRideStory; readonly routeName: string }) {
  const [expanded, setExpanded] = useState(false);
  const [allComments, setAllComments] = useState(false);
  const [photoIndex, setPhotoIndex] = useState<number | null>(null);
  const dialogRef = useRef<HTMLDialogElement>(null);

  const shared = monthYear(story.sharedAt);
  const description = story.description ?? "";
  const longDescription = description.length > DESCRIPTION_CLAMP;
  const shownDescription = !longDescription || expanded
    ? description
    : `${description.slice(0, description.lastIndexOf(" ", DESCRIPTION_CLAMP)).trim()}…`;
  const comments = allComments ? story.comments : story.comments.slice(0, COMMENTS_SHOWN);
  const hazards = story.stops.filter((stop) => stop.kind === "hazard");
  const photo = photoIndex === null ? undefined : story.photos[photoIndex];

  function openPhoto(index: number): void {
    setPhotoIndex(index);
    dialogRef.current?.showModal();
  }

  function stepPhoto(delta: number): void {
    setPhotoIndex((current) => current === null ? null : (current + delta + story.photos.length) % story.photos.length);
  }

  return (
    <section className="og-route-story" aria-labelledby="route-story-title">
      <header className="og-route-story__head">
        <p className="og-eyebrow">{story.source.kind}</p>
        <h2 id="route-story-title">From {story.source.name}</h2>
        <p className="og-route-story__byline">
          {story.sharedBy === undefined ? "Shared by a group member" : <>Shared by <strong>{story.sharedBy}</strong></>}
          {shared === null ? null : <> · {shared}</>}
          {story.source.url === undefined ? null : (
            <> · <a href={story.source.url} target="_blank" rel="noopener noreferrer">Original post<span aria-hidden="true"> ↗</span><span className="sr-only"> (opens in a new tab)</span></a></>
          )}
        </p>
      </header>

      {description.length === 0 ? null : (
        <div className="og-route-story__post">
          <Paragraphs text={shownDescription} />
          {longDescription ? (
            <button type="button" className="og-route-story__more" aria-expanded={expanded} onClick={() => setExpanded((value) => !value)}>
              {expanded ? "Show less" : "Read the whole post"}
            </button>
          ) : null}
        </div>
      )}

      {story.photos.length === 0 ? null : (
        <ul className="og-route-story__photos" aria-label={`Rider photos (${story.photos.length})`}>
          {story.photos.map((item, index) => (
            <li key={item.src}>
              <button type="button" onClick={() => openPhoto(index)} aria-label={`Open photo ${index + 1} of ${story.photos.length}`}>
                <Image src={item.src} alt="" width={item.width} height={item.height} sizes="(max-width: 640px) 60vw, 240px" />
              </button>
            </li>
          ))}
        </ul>
      )}

      {hazards.length === 0 ? null : (
        <p className="og-route-story__hazards" role="note">
          <strong>Marked in the file:</strong> {hazards.map((stop) => `${stop.name} (mile ${stop.mile})`).join(" · ")}
        </p>
      )}

      {story.stops.length === 0 ? null : (
        <div className="og-route-story__block">
          <h3>Stops marked by the author</h3>
          <ol className="og-route-story__stops">
            {story.stops.map((stop) => (
              <li key={`${stop.name}-${stop.mile}`} data-kind={stop.kind}>
                <span className="og-route-story__stop-glyph" aria-hidden="true">{STOP_GLYPH[stop.kind]}</span>
                <span className="og-route-story__stop-mile">mi {stop.mile}</span>
                <span className="og-route-story__stop-name">{stop.name}</span>
                <span className="og-route-story__stop-kind">{STOP_LABEL[stop.kind]}</span>
              </li>
            ))}
          </ol>
        </div>
      )}

      {story.optionalLegs === undefined ? null : (
        <p className="og-route-story__legs">
          <strong>Optional legs in the original file:</strong>{" "}
          {story.optionalLegs.map((leg) => `${leg.name} (${leg.miles} mi)`).join(" · ")}
        </p>
      )}

      {story.comments.length === 0 ? null : (
        <div className="og-route-story__block">
          <h3>What riders said <span className="og-route-story__count">{story.comments.length}</span></h3>
          <ul className="og-route-story__comments">
            {comments.map((comment, index) => (
              <li key={index}>
                <blockquote><Paragraphs text={comment.text} /></blockquote>
                {monthYear(comment.postedAt) === null ? null : <span className="og-route-story__when">{monthYear(comment.postedAt)}</span>}
              </li>
            ))}
          </ul>
          {story.comments.length > COMMENTS_SHOWN ? (
            <button type="button" className="og-route-story__more" aria-expanded={allComments} onClick={() => setAllComments((value) => !value)}>
              {allComments ? "Show fewer" : `Show all ${story.comments.length} comments`}
            </button>
          ) : null}
        </div>
      )}

      {story.alsoShared === undefined ? null : (
        <p className="og-route-story__also">
          Also shared as{" "}
          {story.alsoShared.map((link, index) => (
            <span key={link.url}>
              {index > 0 ? ", " : ""}
              <a href={link.url} target="_blank" rel="noopener noreferrer">{link.title}</a>
              {monthYear(link.sharedAt) === null ? null : ` (${monthYear(link.sharedAt)})`}
            </span>
          ))}
          . Their replies and photos are included above.
        </p>
      )}

      <p className="og-route-story__credit">
        Route, words and photos by members of {story.source.name}; ride it at your own judgement and check for closures.
      </p>

      <dialog
        ref={dialogRef}
        className="og-route-story__lightbox"
        aria-label={`${routeName} photo`}
        onClose={() => setPhotoIndex(null)}
        onClick={(event) => { if (event.target === event.currentTarget) dialogRef.current?.close(); }}
        onKeyDown={(event) => {
          if (event.key === "ArrowRight") stepPhoto(1);
          if (event.key === "ArrowLeft") stepPhoto(-1);
        }}
      >
        {photo === undefined ? null : (
          <figure>
            <Image src={photo.src} alt={`Rider photo ${photoIndex! + 1} of ${story.photos.length} from ${routeName}`} width={photo.width} height={photo.height} sizes="100vw" />
            <figcaption>
              {story.photos.length > 1 ? <button type="button" className="og-secondary" onClick={() => stepPhoto(-1)}>Previous</button> : null}
              <span>{photoIndex! + 1} / {story.photos.length}</span>
              {story.photos.length > 1 ? <button type="button" className="og-secondary" onClick={() => stepPhoto(1)}>Next</button> : null}
              <button type="button" className="og-primary" onClick={() => dialogRef.current?.close()}>Close</button>
            </figcaption>
          </figure>
        )}
      </dialog>
    </section>
  );
}
