"use client";

import Link from "next/link";

import { PrimaryNav } from "@/ui/nav/PrimaryNav";

/**
 * The slim app bar every non-planner surface shares (UX rework phase 9): the
 * brand, the tagline and the primary navigation in one line, matching the
 * planner's own bar, so moving between Plan, Explore, My rides and Settings
 * never changes the frame around the page. On a phone the brand folds away
 * and the navigation is the bottom tab bar.
 */
export function AppBar({ current }: { readonly current: string }) {
  return (
    <div className="og-appbar" data-testid="app-bar">
      <Link href="/" className="og-appbar__brand" aria-label="OpenGravel home">
        OpenGravel
      </Link>
      <span className="og-appbar__tagline">Find the ride worth taking.</span>
      <PrimaryNav current={current} />
    </div>
  );
}
