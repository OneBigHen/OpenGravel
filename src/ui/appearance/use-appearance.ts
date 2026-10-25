"use client";

/**
 * The theme as a component sees it (Day / Night).
 *
 * Two questions, and they are not the same one: which *mode* the rider chose
 * (Auto / Day / Night, which Settings edits), and which theme is *on screen*
 * right now. During a ride those differ, because Auto resolves from the sun at
 * the rider's own coordinate, so a surface that draws with the theme listens to
 * `data-theme` rather than re-deciding from the mode.
 */

import { useSyncExternalStore } from "react";

import {
  APPEARANCE_CHANGE_EVENT,
  THEME_CHANGE_EVENT,
  readAppearanceMode,
  readResolvedTheme,
  type AppearanceMode,
  type ResolvedTheme,
} from "./appearance";

function subscribeModes(onChange: () => void): () => void {
  window.addEventListener(APPEARANCE_CHANGE_EVENT, onChange);
  return () => window.removeEventListener(APPEARANCE_CHANGE_EVENT, onChange);
}

function subscribeTheme(onChange: () => void): () => void {
  window.addEventListener(THEME_CHANGE_EVENT, onChange);
  return () => window.removeEventListener(THEME_CHANGE_EVENT, onChange);
}

export function useAppearanceMode(): AppearanceMode {
  return useSyncExternalStore<AppearanceMode>(subscribeModes, readAppearanceMode, () => "auto");
}

export function useResolvedTheme(): ResolvedTheme {
  return useSyncExternalStore<ResolvedTheme>(subscribeTheme, readResolvedTheme, () => "day");
}
