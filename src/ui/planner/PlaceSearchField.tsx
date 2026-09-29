"use client";

/**
 * The place search combobox for the Start and Destination rows (M1).
 *
 * A rider types a town, an address or a place and picks one; the pick is handed
 * up as a `PlaceMatch` and becomes one typed `start.set` / `finish.set` in the
 * workspace. The field never writes the document itself and never blocks
 * planning: a slow or failed search is one quiet status line, and the map
 * placement chip beside it keeps working.
 *
 * Keyboard (WAI-ARIA combobox, list autocomplete): ↓/↑ move through the options,
 * Enter picks the active option — or the first one when none is active, even if
 * the answer is still on its way — and Escape closes the list and clears the
 * query. The Start field offers "Current location" as its first option.
 *
 * With `describe`, the field is also the ride advisor's box (UX rework 2, #13):
 * text that reads like a ride ("2 h twisty loop, no highways") offers "Plan
 * this ride" first and Enter asks the advisor; text that could be either
 * offers it after the places.
 */

import { useEffect, useId, useRef, useState, type KeyboardEvent } from "react";

import {
  PLACE_QUERY_MAX_LENGTH,
  PLACE_QUERY_MIN_LENGTH,
  type PlaceMatch,
  type PlaceSearchPort,
} from "@/application/geocoding/place-search";
import { readQuery } from "@/application/advisor/ride-description";
import { placeKey, type RememberedPlace } from "@/application/geocoding/place-memory";
import type { Coordinate } from "@/domain/ride/types";

/** Wait this long after the last keystroke before asking (and spending a rate-limit slot). */
export const PLACE_SEARCH_DEBOUNCE_MS = 250;

export interface CurrentLocationOption {
  readonly onUse: () => void;
  readonly locating: boolean;
  /** Why the last attempt failed, in the rider's words; `null` when it did not. */
  readonly failure: string | null;
}

export interface PlaceSearchFieldProps {
  readonly slot: "start" | "finish";
  readonly search: PlaceSearchPort;
  readonly onPick: (place: PlaceMatch, query: string) => void;
  readonly bias?: Coordinate;
  readonly currentLocation?: CurrentLocationOption;
  readonly disabled?: boolean;
  /** Focus the field on mount: the rider tapped a chosen place to change it. */
  readonly autoFocus?: boolean;
  /** The field lost focus with nothing typed: the rider changed their mind. */
  readonly onIdleBlur?: () => void;
  /** Hands a ride description to the advisor instead of searching places. */
  readonly describe?: (text: string) => void;
  /** Home, saved places and recents matching a query (NV-02). */
  readonly remembered?: (query: string, limit: number) => readonly RememberedPlace[];
}

/** How many remembered places an empty box shows, and how many lead a typed query. */
const REMEMBERED_EMPTY_LIMIT = 6;
const REMEMBERED_TYPED_LIMIT = 3;

const REMEMBERED_NOTE: Readonly<Record<RememberedPlace["kind"], string>> = {
  home: "Home",
  saved: "Saved",
  recent: "Recent",
};

type SearchState =
  | { readonly phase: "idle" }
  | { readonly phase: "searching"; readonly query: string }
  | { readonly phase: "done"; readonly query: string; readonly places: readonly PlaceMatch[] }
  | { readonly phase: "unavailable"; readonly query: string; readonly reason: string };

/** The last answer, keyed by the query it answers; the phase is derived from it. */
type Answer =
  | { readonly query: string; readonly status: "ok"; readonly places: readonly PlaceMatch[] }
  | { readonly query: string; readonly status: "unavailable"; readonly reason: string };

type Option =
  | { readonly kind: "location"; readonly id: string }
  | { readonly kind: "describe"; readonly id: string }
  | { readonly kind: "remembered"; readonly id: string; readonly entry: RememberedPlace }
  | { readonly kind: "place"; readonly id: string; readonly place: PlaceMatch };

/** Map-app phrasing (UX rework phase 2): where from, and where to. */
const PLACEHOLDERS = { start: "Starting point", finish: "Where to?" } as const;
const DESCRIBE_PLACEHOLDER = "Where to, or a ride idea";

export function PlaceSearchField({
  autoFocus = false,
  onIdleBlur,
  slot,
  search,
  onPick,
  bias,
  currentLocation,
  disabled = false,
  describe,
  remembered,
}: PlaceSearchFieldProps) {
  const baseId = useId();
  const listId = `${baseId}-list`;
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [answer, setAnswer] = useState<Answer | null>(null);
  const [activeIndex, setActiveIndex] = useState(-1);
  const pickFirstWhenReady = useRef(false);
  const onPickRef = useRef(onPick);
  useEffect(() => {
    onPickRef.current = onPick;
  }, [onPick]);

  const trimmed = query.trim();
  const reading = describe === undefined ? "place" : readQuery(trimmed);
  const typed = trimmed.length >= PLACE_QUERY_MIN_LENGTH;
  // A ride description is not a place: no geocoding request for it.
  const searchable = typed && reading !== "ride";
  const state: SearchState = !searchable
    ? { phase: "idle" }
    : answer === null || answer.query !== trimmed
      ? { phase: "searching", query: trimmed }
      : answer.status === "ok"
        ? { phase: "done", query: trimmed, places: answer.places }
        : { phase: "unavailable", query: trimmed, reason: answer.reason };

  useEffect(() => {
    if (!searchable) return;
    const controller = new AbortController();
    const timer = setTimeout(() => {
      search
        .search(trimmed, {
          signal: controller.signal,
          ...(bias === undefined ? {} : { bias }),
        })
        .then((outcome) => {
          if (controller.signal.aborted) return;
          // Enter pressed before the answer arrived picks the first result now.
          const first = outcome.status === "ok" ? outcome.places[0] : undefined;
          if (pickFirstWhenReady.current && first !== undefined) {
            pickFirstWhenReady.current = false;
            onPickRef.current(first, trimmed);
            setQuery("");
            setActiveIndex(-1);
            setOpen(false);
            return;
          }
          pickFirstWhenReady.current = false;
          setAnswer(
            outcome.status === "ok"
              ? { query: trimmed, status: "ok", places: outcome.places }
              : { query: trimmed, status: "unavailable", reason: outcome.reason },
          );
        })
        .catch(() => {
          // An abort is a newer keystroke taking over; nothing to report.
        });
    }, PLACE_SEARCH_DEBOUNCE_MS);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [trimmed, searchable, search, bias]);

  // Remembered places lead: all of them in an empty box, the matching few
  // ahead of the geocoder's answers once the rider types (NV-02).
  const memory =
    remembered === undefined || reading === "ride" || (trimmed.length > 0 && !typed)
      ? []
      : remembered(trimmed, typed ? REMEMBERED_TYPED_LIMIT : REMEMBERED_EMPTY_LIMIT);
  const rememberedKeys = new Set(memory.map((entry) => placeKey(entry.place.coordinate)));
  const places = (state.phase === "done" ? state.places : []).filter(
    (place) => !rememberedKeys.has(placeKey(place.coordinate)),
  );
  const describeOption: Option[] = reading === "place" ? [] : [{ kind: "describe", id: `${baseId}-describe` }];
  const options: Option[] = [
    ...(currentLocation !== undefined && !typed
      ? [{ kind: "location" as const, id: `${baseId}-location` }]
      : []),
    ...(reading === "ride" ? describeOption : []),
    ...memory.map((entry, index) => ({ kind: "remembered" as const, id: `${baseId}-memory-${index}`, entry })),
    ...places.map((place, index) => ({ kind: "place" as const, id: `${baseId}-option-${index}`, place })),
    ...(reading === "maybe" ? describeOption : []),
  ];

  function reset(): void {
    setQuery("");
    setActiveIndex(-1);
    setOpen(false);
    pickFirstWhenReady.current = false;
  }

  function choose(option: Option): void {
    if (option.kind === "location") {
      currentLocation?.onUse();
    } else if (option.kind === "describe") {
      describe?.(trimmed);
    } else if (option.kind === "remembered") {
      onPick(option.entry.place, trimmed);
    } else {
      onPick(option.place, trimmed);
    }
    reset();
  }

  function onKeyDown(event: KeyboardEvent<HTMLInputElement>): void {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setOpen(true);
      if (options.length > 0) setActiveIndex((index) => (index + 1) % options.length);
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setOpen(true);
      if (options.length > 0) {
        setActiveIndex((index) => (index <= 0 ? options.length - 1 : index - 1));
      }
    } else if (event.key === "Enter") {
      event.preventDefault();
      const active = options[activeIndex];
      if (active !== undefined) {
        choose(active);
        return;
      }
      if (reading === "ride") {
        choose({ kind: "describe", id: `${baseId}-describe` });
        return;
      }
      const firstRemembered = options.find((option) => option.kind === "remembered");
      if (firstRemembered !== undefined && typed) {
        choose(firstRemembered);
        return;
      }
      const firstPlace = options.find((option) => option.kind === "place");
      if (firstPlace !== undefined && state.phase === "done") {
        choose(firstPlace);
      } else if (searchable && state.phase === "searching") {
        pickFirstWhenReady.current = true;
      }
    } else if (event.key === "Escape") {
      if (query !== "" || open) {
        event.preventDefault();
        reset();
      }
    }
  }

  const status =
    reading === "ride"
      ? null
      : state.phase === "searching"
      ? "Searching…"
      : state.phase === "unavailable"
        ? state.reason
        : state.phase === "done" && state.places.length === 0
          ? `No places match “${state.query}”.`
          : currentLocation?.locating === true
            ? "Finding your location…"
            : (currentLocation?.failure ?? null);
  const showList = open && options.length > 0;
  const activeId = showList ? options[activeIndex]?.id : undefined;
  const noun = slot === "start" ? "start" : "destination";

  return (
    <div className="og-place-search" data-testid={`${slot}-search-field`}>
      <input
        type="search"
        className="og-place-search__input"
        data-testid={`${slot}-search`}
        role="combobox"
        aria-label={`Search for a ${noun}`}
        aria-autocomplete="list"
        aria-expanded={showList}
        aria-controls={listId}
        {...(activeId === undefined ? {} : { "aria-activedescendant": activeId })}
        placeholder={describe === undefined ? PLACEHOLDERS[slot] : DESCRIBE_PLACEHOLDER}
        autoComplete="off"
        enterKeyHint="search"
        spellCheck={false}
        maxLength={PLACE_QUERY_MAX_LENGTH}
        disabled={disabled}
        value={query}
        onChange={(event) => {
          setQuery(event.target.value);
          setActiveIndex(-1);
          setOpen(true);
          pickFirstWhenReady.current = false;
        }}
        onFocus={() => setOpen(true)}
        autoFocus={autoFocus}
        onBlur={() => {
          setOpen(false);
          if (query.trim() === "") onIdleBlur?.();
        }}
        onKeyDown={onKeyDown}
      />
      <ul
        id={listId}
        role="listbox"
        aria-label={`${noun === "start" ? "Start" : "Destination"} suggestions`}
        className="og-place-search__list"
        data-testid={`${slot}-search-results`}
        hidden={!showList}
      >
        {options.map((option, index) => (
          <li
            key={option.id}
            id={option.id}
            role="option"
            aria-selected={index === activeIndex}
            className="og-place-search__option"
            data-testid={
              option.kind === "location"
                ? "place-option-location"
                : option.kind === "describe"
                  ? "place-option-describe"
                  : option.kind === "remembered"
                    ? `place-option-${option.entry.kind}`
                    : "place-option"
            }
            // Keep focus in the input so blur does not close the list first.
            onMouseDown={(event) => event.preventDefault()}
            onClick={() => choose(option)}
          >
            {option.kind === "location" ? (
              <>
                <span className="og-place-search__name">Current location</span>
                <span className="og-place-search__context">Start from where you are</span>
              </>
            ) : option.kind === "describe" ? (
              <>
                <span className="og-place-search__name">
                  <span className="og-advisor__mark" aria-hidden="true">{"\u2733\uFE0E"}</span> Plan this ride
                </span>
                <span className="og-place-search__context">“{trimmed}”</span>
              </>
            ) : option.kind === "remembered" ? (
              <>
                <span className="og-place-search__name">
                  <span className="og-place-search__kind" data-kind={option.entry.kind} aria-hidden="true">
                    {option.entry.kind === "home" ? "\u2302" : option.entry.kind === "saved" ? "\u2605" : "\u21BA"}
                  </span>{" "}
                  {option.entry.kind === "home" ? "Home" : option.entry.place.name}
                </span>
                <span className="og-place-search__context">
                  {[
                    REMEMBERED_NOTE[option.entry.kind],
                    option.entry.kind === "home" ? option.entry.place.label : option.entry.place.context,
                  ]
                    .filter((part) => part !== "" && part !== "Home")
                    .join(" · ")}
                </span>
              </>
            ) : (
              <>
                <span className="og-place-search__name">{option.place.name}</span>
                {option.place.context === "" ? null : (
                  <span className="og-place-search__context">{option.place.context}</span>
                )}
              </>
            )}
          </li>
        ))}
      </ul>
      {status === null ? null : (
        <p className="og-place-search__status" role="status" data-testid={`${slot}-search-status`}>
          {status}
        </p>
      )}
    </div>
  );
}
