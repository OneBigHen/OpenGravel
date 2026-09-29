"use client";

import type { MouseEvent } from "react";

/**
 * "Skip to main content" for keyboard and switch users (AQ-04): the first tab
 * stop on every page. It moves focus to the first field in the page's
 * `[data-skip-target]` (the planner's route fields, AQ-05), else to the page
 * heading, past the navigation.
 */
export function SkipLink() {
  const skip = (event: MouseEvent<HTMLAnchorElement>): void => {
    const marked = document.querySelector<HTMLElement>("[data-skip-target]");
    const visible = (element: HTMLElement): boolean => element.getClientRects().length > 0;
    const field = marked === null
      ? null
      : [...marked.querySelectorAll<HTMLElement>("input, button, select, textarea, a[href]")].find(visible) ?? null;
    // Past the page's navigation: its heading, else the main region itself.
    const target = field ?? document.querySelector<HTMLElement>("main h1") ?? document.querySelector<HTMLElement>("main");
    if (target === null) return;
    event.preventDefault();
    if (field === null && !target.hasAttribute("tabindex")) target.setAttribute("tabindex", "-1");
    target.focus();
  };
  return (
    <a className="og-skip-link" href="#main" onClick={skip}>
      Skip to main content
    </a>
  );
}
