"use client";

/**
 * "Search along this ride": the place search a rider already knows, pointed at
 * the road ahead (maps-for-riders §3; the ride sheet, not the planner).
 *
 * Gas and Food are quick answers to a question the rider already had; this row
 * answers the one they did not — a coffee, a motel, a town on the way — without
 * leaving the ride, retyping the destination or opening the planner on a
 * mounted phone.
 *
 * What it keeps true:
 *
 * - **It is the app's own place search.** The same `PlaceSearchPort` the planner
 *   calls, biased to where the rider is now, so one geocoder answers both
 *   surfaces and an unavailable provider is one quiet line here too.
 * - **Results are ordered by the ride, not by relevance.** Distance ahead along
 *   the line the rider is following, nearest first, and what the stop adds in
 *   time when the ride itself has measured pace left to judge it with
 *   (`along-ride-places.ts`).
 * - **Free Ride has no line**, so the same list orders by distance from the
 *   rider, says "away" instead of "ahead", and its one action is "Go": it starts
 *   navigating to that place through the session's own return planner.
 * - **Nothing changes until the rider confirms.** A tap on a result selects it;
 *   only the confirm button adds the stop or starts the route, through exactly
 *   the reroute path the Gas and Food rows use (§1: the map never edits the
 *   ride by itself).
 * - **Unknown is not a number.** Without a fix there is no distance at all, and
 *   without a measured ride time there is no "+N min" — never a zero to fill the
 *   space.
 */

import { useCallback, useEffect, useId, useRef, useState, type KeyboardEvent } from "react";

import { PLACE_CATEGORIES, type PlaceCategory } from "@/application/geocoding/place-query";
import {
  PLACE_QUERY_MAX_LENGTH,
  PLACE_QUERY_MIN_LENGTH,
  type PlaceMatch,
  type PlaceSearchPort,
} from "@/application/geocoding/place-search";
import type { Coordinate } from "@/domain/ride/types";

import {
  alongRideDistanceLabel,
  alongRideExtraLabel,
  alongRidePlaces,
  type AlongRidePlace,
} from "./along-ride-places";
import "./ride-stop-search.css";

/** Wait this long after the last keystroke before asking, as the planner does. */
export const ALONG_RIDE_SEARCH_DEBOUNCE_MS = 250;

/**
 * The one line a rider reads when the geocoder cannot answer here. The planner's
 * own copy ends with "you can still set the point on the map", which is advice
 * the ride sheet offers no map tool for, so the ride says only what is true.
 */
export const RIDE_PLACE_SEARCH_UNAVAILABLE = "Place search is unavailable right now.";

/**
 * The two chips the ride was missing. Their provider queries (and category ids)
 * come from the app's one category table, so a rider's word and the provider's
 * lookup cannot drift apart between the planner and the ride.
 */
interface StopChip {
  readonly id: string;
  readonly label: string;
  readonly category: PlaceCategory | null;
}

const STOP_CHIPS: readonly StopChip[] = [
  { id: "coffee", label: "Coffee", category: PLACE_CATEGORIES.get("coffee") ?? null },
  { id: "lodging", label: "Lodging", category: PLACE_CATEGORIES.get("lodging") ?? null },
];

type Answer =
  | { readonly status: "idle" }
  | { readonly status: "searching"; readonly query: string }
  | { readonly status: "ok"; readonly query: string; readonly places: readonly PlaceMatch[] }
  | { readonly status: "unavailable"; readonly query: string };

export interface RideStopSearchProps {
  /**
   * `along` sits inside the ride sheet's "Add a stop" panel for a guided ride;
   * `nearby` is the Free Ride's own row, where there is no line to look along.
   */
  readonly mode: "along" | "nearby";
  /** Absent when the deployment has no place search: the panel then stays closed. */
  readonly search?: PlaceSearchPort | undefined;
  readonly position: Coordinate | null;
  /** The line the rider is following; empty in Free Ride. */
  readonly routeLine: readonly Coordinate[];
  /** The ride's own distance and time left, for the detour estimate. */
  readonly remainingMeters?: number | null;
  readonly remainingSeconds?: number | null;
  /** A reroute or return is already being planned. */
  readonly busy: boolean;
  /** Whether the fix is fresh and accurate enough to route from. */
  readonly fixGood: boolean;
  /** Routes via the chosen place through the caller's own command. */
  readonly onGo: (place: PlaceMatch) => void;
}

export function RideStopSearch({
  mode,
  search,
  position,
  routeLine,
  remainingMeters = null,
  remainingSeconds = null,
  busy,
  fixGood,
  onGo,
}: RideStopSearchProps) {
  // Inside "Add a stop" the rider has already opened the panel; the Free Ride's
  // row is its own toggle.
  const [open, setOpen] = useState(mode === "along");
  const [query, setQuery] = useState("");
  const [answer, setAnswer] = useState<Answer>({ status: "idle" });
  const [chip, setChip] = useState<string | null>(null);
  const [chosen, setChosen] = useState<AlongRidePlace | null>(null);
  // The field text whose search has already been issued (a chip pressed it), so
  // the debounce does not ask the provider the same question twice.
  const issued = useRef<string | null>(null);
  const inFlight = useRef<AbortController | null>(null);
  const input = useRef<HTMLInputElement | null>(null);
  const panelId = useId();
  const fieldId = useId();
  const listId = useId();

  const runQuery = useCallback(
    (text: string, chipId: string | null): void => {
      if (search === undefined) return;
      const trimmed = text.trim();
      if (trimmed.length < PLACE_QUERY_MIN_LENGTH) {
        setAnswer({ status: "idle" });
        return;
      }
      inFlight.current?.abort();
      const controller = new AbortController();
      inFlight.current = controller;
      setAnswer({ status: "searching", query: trimmed });
      void search
        .search(trimmed, {
          ...(position === null ? {} : { bias: position }),
          signal: controller.signal,
        })
        .then(
          (outcome) => {
            if (controller.signal.aborted) return;
            setAnswer(
              outcome.status === "ok"
                ? { status: "ok", query: trimmed, places: outcome.places }
                : { status: "unavailable", query: trimmed },
            );
          },
          () => {
            if (controller.signal.aborted) return;
            setAnswer({ status: "unavailable", query: trimmed });
          },
        )
        .finally(() => {
          // Keep the active chip beside the answer it produced, not the next one.
          if (!controller.signal.aborted) setChip(chipId);
        });
    },
    [position, search],
  );

  // Typing asks once the rider stops: a search per keystroke is a rate-limit slot
  // per keystroke, and a list that jumps while they type.
  useEffect(() => {
    if (search === undefined) return;
    const typed = query.trim();
    if (typed.length < PLACE_QUERY_MIN_LENGTH) return;
    if (issued.current === typed) return;
    const timer = window.setTimeout(() => {
      issued.current = typed;
      setChip(null);
      runQuery(typed, null);
    }, ALONG_RIDE_SEARCH_DEBOUNCE_MS);
    return () => window.clearTimeout(timer);
  }, [query, runQuery, search]);

  // A search still on its way when the rider leaves must not land anywhere.
  useEffect(() => () => inFlight.current?.abort(), []);

  // The Free Ride row is a search box: opening it is the tap that asks for the
  // keyboard, so it goes to the field.
  useEffect(() => {
    if (open && mode === "nearby") input.current?.focus();
  }, [open, mode]);

  if (search === undefined) return null;
  const nearby = mode === "nearby";
  const rows =
    answer.status === "ok"
      ? alongRidePlaces({
          places: answer.places,
          line: routeLine,
          position,
          remainingMeters,
          remainingSeconds,
        })
      : [];

  const startChip = (next: StopChip): void => {
    if (next.category === null) return;
    setChip(next.id);
    setQuery(next.label);
    issued.current = next.label;
    // The rider's own word stays in the field; the provider is asked with the
    // category's lookup words from the shared category table.
    runQuery(next.category.query, next.id);
  };

  const runNow = (): void => {
    const typed = query.trim();
    if (typed.length < PLACE_QUERY_MIN_LENGTH) return;
    issued.current = typed;
    setChip(null);
    runQuery(typed, null);
  };

  /** The second line of the confirm: how far, and what it costs. */
  const confirmMeta = (row: AlongRidePlace): string | null => {
    const parts = [alongRideDistanceLabel(row), alongRideExtraLabel(row.extraMinutes)].filter(
      (part): part is string => part !== null,
    );
    return parts.length === 0 ? null : parts.join(" · ");
  };

  const go = (row: AlongRidePlace): void => {
    setChosen(null);
    setQuery("");
    setAnswer({ status: "idle" });
    issued.current = null;
    setChip(null);
    if (nearby) setOpen(false);
    onGo(row.place);
  };

  return (
    <section className="og-ride-search" aria-label={nearby ? "Search near me" : "Search along this ride"}>
      {nearby ? (
        <button
          type="button"
          className="og-ride__sheet-row"
          data-testid="ride-stop-search"
          aria-expanded={open}
          aria-controls={panelId}
          onClick={(): void => setOpen(!open)}
        >
          <span className="og-ride__sheet-row-label">Search near me</span>
          <span className="og-ride__sheet-row-hint">Coffee, food, anywhere</span>
        </button>
      ) : null}
      {!open ? null : (
        <div className="og-ride-search__panel" id={panelId}>
          <input
            ref={input}
            id={fieldId}
            type="search"
            className="og-ride-search__field"
            data-testid="ride-stop-search-field"
            aria-label={nearby ? "Search near me" : "Search along this ride"}
            placeholder="Coffee, a town, an address"
            autoComplete="off"
            enterKeyHint="search"
            maxLength={PLACE_QUERY_MAX_LENGTH}
            value={query}
            disabled={busy}
            onChange={(event): void => {
              const next = event.target.value;
              setQuery(next);
              // Too short to be a place: the last answer no longer belongs to
              // what is in the field, so the list clears with the text.
              if (next.trim().length < PLACE_QUERY_MIN_LENGTH) {
                issued.current = null;
                setChip(null);
                setAnswer({ status: "idle" });
              }
            }}
            onKeyDown={(event: KeyboardEvent<HTMLInputElement>): void => {
              if (event.key !== "Enter") return;
              event.preventDefault();
              runNow();
            }}
          />
          {/* Two rider words, asked with the category table's own lookup. */}
          <div className="og-ride-search__chips" role="group" aria-label="Quick places">
            {STOP_CHIPS.map((stopChip) =>
              stopChip.category === null ? null : (
                <button
                  key={stopChip.id}
                  type="button"
                  className="og-ride__action og-ride-search__chip"
                  data-testid={`ride-stop-${stopChip.id}`}
                  aria-pressed={chip === stopChip.id}
                  disabled={busy}
                  onClick={(): void => startChip(stopChip)}
                >
                  {stopChip.label}
                </button>
              ),
            )}
          </div>
          <div className="og-ride-search__answer" id={listId}>
            {/* The list itself is one region, so its arrival is said once, as a
                count, instead of every row being read out as it paints. */}
            <p className="og-visually-hidden" role="status">
              {answer.status !== "ok"
                ? ""
                : rows.length === 0
                  ? "No places found."
                  : `${rows.length} ${rows.length === 1 ? "place" : "places"} found.`}
            </p>
            {chosen !== null ? (
              <div className="og-ride-search__confirm" data-testid="ride-stop-confirm">
                <p className="og-ride-search__confirm-text">
                  <strong>{chosen.place.name}</strong>
                  {confirmMeta(chosen) === null ? null : ` · ${confirmMeta(chosen)}`}
                </p>
                <div className="og-ride-search__confirm-actions">
                  <button
                    type="button"
                    className="og-ride__action og-ride__action--primary"
                    data-testid="ride-stop-confirm-go"
                    disabled={busy || !fixGood}
                    title={
                      !fixGood
                        ? "Routing to a stop needs a fresh, accurate GPS fix."
                        : busy
                          ? "A route is already being planned."
                          : undefined
                    }
                    onClick={(): void => go(chosen)}
                  >
                    {nearby ? "Go" : "Add as next stop"}
                  </button>
                  <button
                    type="button"
                    className="og-ride__action"
                    data-testid="ride-stop-confirm-cancel"
                    onClick={(): void => setChosen(null)}
                  >
                    Cancel
                  </button>
                </div>
              </div>
            ) : answer.status === "searching" ? (
              <p className="og-ride-search__note" role="status">
                Searching…
              </p>
            ) : answer.status === "unavailable" ? (
              <p className="og-ride-search__note" role="status">
                {RIDE_PLACE_SEARCH_UNAVAILABLE}
              </p>
            ) : answer.status === "ok" && rows.length === 0 ? (
              <p className="og-ride-search__note" role="status">
                No places found for “{answer.query}”.
              </p>
            ) : rows.length === 0 ? null : (
              <ul
                className="og-ride-search__results"
                data-testid="ride-stop-results"
                aria-label={nearby ? "Places near you" : "Places along this ride"}
              >
                {rows.map((row) => {
                  const distance = alongRideDistanceLabel(row);
                  const extra = alongRideExtraLabel(row.extraMinutes);
                  return (
                    <li key={row.place.id}>
                      <button
                        type="button"
                        className="og-ride-search__result"
                        data-testid="ride-stop-option"
                        onClick={(): void => setChosen(row)}
                      >
                        {distance === null ? null : (
                          <span className="og-ride-search__distance">{distance}</span>
                        )}
                        <span className="og-ride-search__name">
                          {row.place.name}
                          {row.place.context === "" ? null : <small>{row.place.context}</small>}
                        </span>
                        {extra === null ? null : (
                          <span className="og-ride-search__extra">{extra}</span>
                        )}
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        </div>
      )}
    </section>
  );
}
