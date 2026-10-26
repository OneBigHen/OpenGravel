import { beforeEach, describe, expect, it } from "vitest";

import {
  LIST_POSITION_MAX_AGE_MS,
  peekListPosition,
  rememberListPosition,
  takeListPosition,
} from "@/ui/explore/list-position";

const KEY = "opengravel.explore.list-position";

beforeEach(() => {
  window.sessionStorage.clear();
});

describe("where the rider was in the list", () => {
  it("hands the offset back once", () => {
    rememberListPosition(612);
    // The way back can look at where it leads without spending the note.
    expect(peekListPosition()).toBe(612);
    expect(takeListPosition()).toBe(612);
    // Forward, a reload or a second visit must not yank the list again.
    expect(takeListPosition()).toBeNull();
  });

  it("forgets an offset that is too old to mean anything", () => {
    rememberListPosition(612, 1_000);
    expect(takeListPosition(1_000 + LIST_POSITION_MAX_AGE_MS + 1)).toBeNull();
  });

  it("keeps a rounded, non-negative offset", () => {
    rememberListPosition(612.4);
    expect(takeListPosition()).toBe(612);
    rememberListPosition(-40);
    expect(takeListPosition()).toBe(0);
    // A non-number is not a place: nothing is written at all.
    rememberListPosition(Number.NaN);
    expect(window.sessionStorage.getItem(KEY)).toBeNull();
  });

  it("treats an unreadable note as no note, and still clears it", () => {
    window.sessionStorage.setItem(KEY, "{not json");
    expect(takeListPosition()).toBeNull();
    expect(window.sessionStorage.getItem(KEY)).toBeNull();
  });

  it("ignores a note without a usable offset", () => {
    window.sessionStorage.setItem(KEY, JSON.stringify({ y: "high", at: Date.now() }));
    expect(takeListPosition()).toBeNull();
  });
});
