"use client";

import { useState } from "react";

import type { PlaceMatch } from "@/application/geocoding/place-search";

/**
 * Set Home by name (RS-04): a rider configuring the app at work can still make
 * Home their house. One field, one search, up to five places to pick from.
 */
export function HomeSearch({
  onSearch,
  onPick,
}: {
  readonly onSearch: (query: string) => Promise<readonly PlaceMatch[]>;
  readonly onPick: (place: PlaceMatch) => void;
}) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<readonly PlaceMatch[] | null>(null);
  const [busy, setBusy] = useState(false);

  const search = async (): Promise<void> => {
    const trimmed = query.trim();
    if (trimmed.length < 2 || busy) return;
    setBusy(true);
    try {
      setResults(await onSearch(trimmed));
    } catch {
      setResults([]);
    } finally {
      setBusy(false);
    }
  };

  return (
    <form
      className="og-settings__home-search"
      role="search"
      aria-label="Find Home by name"
      onSubmit={(event) => {
        event.preventDefault();
        void search();
      }}
    >
      <label>
        Or find it by name
        <span className="og-settings__home-search-row">
          <input
            type="search"
            value={query}
            placeholder="Town or address"
            data-testid="settings-home-query"
            onChange={(event) => setQuery(event.target.value)}
          />
          <button className="og-settings__button og-settings__button--quiet" type="submit" disabled={busy || query.trim().length < 2}>
            {busy ? "Finding…" : "Find"}
          </button>
        </span>
      </label>
      {results === null ? null : results.length === 0 ? (
        <p className="og-settings__section-copy" role="status">No places found. Try a town name.</p>
      ) : (
        <ul className="og-settings__home-results" aria-label="Places to use as Home">
          {results.map((place) => (
            <li key={place.id}>
              <button
                type="button"
                className="og-settings__text-button"
                onClick={() => {
                  onPick(place);
                  setResults(null);
                  setQuery("");
                }}
              >
                {place.label}
              </button>
            </li>
          ))}
        </ul>
      )}
    </form>
  );
}
