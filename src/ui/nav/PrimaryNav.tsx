"use client";

import { Fragment, useEffect, useRef } from "react";
import Link from "next/link";

/**
 * The primary navigation, shared by the planner header and the Explore header
 * (04-PLANNER-AND-WORKSPACE-UX §2).
 *
 * It exists as one component because the same markup in two places produced the
 * same defect twice: two adjacent inline links with no separator between them
 * render — and are dumped — as one run of text, so the planner's header read
 * `ExploreRides library` and Explore's read `PlannerRides` (owner review
 * 2026-09-21).
 *
 * The separation is therefore *markup*, not a parent `gap`: a real divider
 * element sits between the links, so the labels cannot concatenate even if the
 * flex or inline layout around them changes. The divider is decoration — it is
 * `aria-hidden`, so each link keeps its own accessible name ("Explore", "My
 * rides") and the divider is never announced as content. The current page is
 * marked with `aria-current="page"`.
 */
export interface PrimaryNavItem {
  readonly href: string;
  readonly label: string;
}

/** The app's three places. Every surface shows the same nav in the same order. */
export const PRIMARY_NAV_ITEMS: readonly PrimaryNavItem[] = [
  { href: "/", label: "Plan" },
  { href: "/explore", label: "Explore" },
  { href: "/rides", label: "My rides" },
];

export interface PrimaryNavProps {
  /** The href of the surface rendering the nav; that link gets `aria-current`. */
  readonly current?: string;
  readonly items?: readonly PrimaryNavItem[];
}

/**
 * Line icons for the phone tab bar (UX rework phase 1). They are decoration:
 * `aria-hidden`, so each link's accessible name stays its visible label.
 */
function NavIcon({ href }: { readonly href: string }) {
  const common = {
    width: 22,
    height: 22,
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: 1.8,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
    "aria-hidden": true,
    className: "og-nav__icon",
  };
  switch (href) {
    case "/":
      // A route between two points.
      return (
        <svg {...common}>
          <circle cx="6" cy="18" r="2.2" />
          <circle cx="18" cy="6" r="2.2" />
          <path d="M8 17c5-1 3-6 8-9" />
        </svg>
      );
    case "/explore":
      return (
        <svg {...common}>
          <circle cx="12" cy="12" r="8.5" />
          <path d="m15.5 8.5-2 5-5 2 2-5z" />
        </svg>
      );
    case "/rides":
      return (
        <svg {...common}>
          <path d="M6 4h12v16l-6-4-6 4z" />
        </svg>
      );
    case "/settings":
      return (
        <svg {...common}>
          <circle cx="12" cy="12" r="3" />
          <path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z" />
        </svg>
      );
    default:
      return null;
  }
}

export function PrimaryNav({ current, items = PRIMARY_NAV_ITEMS }: PrimaryNavProps) {
  const shellRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    const shell = shellRef.current;
    if (shell === null) return;
    const root = document.documentElement.style;
    const property = "--og-tabbar-measured-pill-h";
    const previous = root.getPropertyValue(property);
    let ownedValue = previous;
    // Reserve the rendered bar, including text reflow, for every page's
    // bottom padding and the planner dock. This is only a layout measurement.
    const measure = (): void => {
      const height = shell.getBoundingClientRect().height;
      ownedValue = getComputedStyle(shell).position === "fixed" && height > 0 ? `${height}px` : "";
      if (root.getPropertyValue(property) === ownedValue) return;
      if (ownedValue === "") root.removeProperty(property);
      else root.setProperty(property, ownedValue);
    };
    measure();
    const observer = typeof ResizeObserver === "function" ? new ResizeObserver(measure) : null;
    observer?.observe(shell);
    window.addEventListener("resize", measure);
    return () => {
      observer?.disconnect();
      window.removeEventListener("resize", measure);
      if (root.getPropertyValue(property) !== ownedValue) return;
      if (previous === "") root.removeProperty(property);
      else root.setProperty(property, previous);
    };
  }, []);
  return (
    <div className="og-planner__nav-shell" data-testid="primary-nav" ref={shellRef}>
      <nav className="og-planner__nav" aria-label="Primary">
        {items.map((item, index) => (
          <Fragment key={item.href}>
            {index === 0 ? null : (
              <span className="og-nav__sep" aria-hidden="true">
                ·
              </span>
            )}
            <Link href={item.href} aria-current={item.href === current ? "page" : undefined}>
              <NavIcon href={item.href} />
              <span className="og-nav__label">{item.label}</span>
            </Link>
          </Fragment>
        ))}
      </nav>
      <Link
        className="og-planner__settings-link"
        href="/settings"
        aria-label="Settings"
        aria-current={current === "/settings" ? "page" : undefined}
      >
        <NavIcon href="/settings" />
        <span className="og-nav__label og-nav__label--tab-only" aria-hidden="true">Settings</span>
      </Link>
    </div>
  );
}
