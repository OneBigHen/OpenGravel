"use client";

import { useRef } from "react";

import type { NearbyPlace, PlaceCardModel } from "@/application/places";
import { useDialogFocus } from "@/ui/hooks/use-dialog-focus";

export interface PlaceCardProps {
  readonly place: NearbyPlace;
  readonly card: PlaceCardModel;
  readonly attribution: string | null;
  readonly onClose: () => void;
  readonly onAddStop?: (place: NearbyPlace) => void;
}

export function PlaceCard({ place, card, attribution, onClose, onAddStop }: PlaceCardProps) {
  const cardRef = useRef<HTMLElement | null>(null);
  useDialogFocus(cardRef, onClose);

  return (
    <section
      ref={cardRef}
      className="og-places-card"
      data-testid="place-card"
      data-live={card.live ? "true" : "false"}
      role="dialog"
      aria-label={`${card.title} place details`}
    >
      <div className="og-places-card__topline">
        <p className={`og-places-card__when${card.live ? " og-places-card__when--live" : ""}`}>
          {card.live ? <span className="og-places-card__live-dot" aria-hidden="true" /> : null}
          {card.when}
        </p>
        <button
          type="button"
          className="og-places-card__close"
          aria-label="Close place details"
          onClick={onClose}
        >
          <span aria-hidden="true">×</span>
        </button>
      </div>
      {place.imageUrl == null ? null : (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          className="og-places-card__photo"
          src={place.imageUrl}
          alt=""
          loading="lazy"
          decoding="async"
          referrerPolicy="no-referrer"
          onError={(event) => {
            event.currentTarget.hidden = true;
          }}
        />
      )}
      <h2 className="og-places-card__title">{card.title}</h2>
      {card.eventTime === null ? null : <p className="og-places-card__time">{card.eventTime}</p>}
      {card.meta.length === 0 ? null : <p className="og-places-card__meta">{card.meta}</p>}
      {card.specials.length === 0 ? null : (
        <ul className="og-places-card__specials" aria-label="Specials">
          {card.specials.slice(0, 3).map((special, index) => <li key={`${special}-${index}`}>{special}</li>)}
        </ul>
      )}
      {card.perks.length === 0 ? null : <p className="og-places-card__perks">{card.perks}</p>}
      {attribution === null ? null : <p className="og-places-card__attribution">{attribution}</p>}
      {card.updated === null ? null : <p className="og-places-card__updated">{card.updated}</p>}
      <div className="og-places-card__actions">
        <a href={card.detailUrl} target="_blank" rel="noopener noreferrer">Details</a>
        {card.directionsUrl === null ? null : (
          <a href={card.directionsUrl} target="_blank" rel="noopener noreferrer">Directions</a>
        )}
        {onAddStop === undefined ? null : (
          <button type="button" onClick={() => onAddStop(place)}>Add as stop</button>
        )}
      </div>
    </section>
  );
}
