"use client";

import { useEffect, useId, useRef, useState } from "react";
import Link from "next/link";

import { setAppearanceMode, type AppearanceMode } from "@/ui/appearance/appearance";
import { useAppearanceMode } from "@/ui/appearance/use-appearance";

const MODES: readonly { readonly mode: AppearanceMode; readonly label: string }[] = [
  { mode: "auto", label: "Auto" },
  { mode: "day", label: "Day" },
  { mode: "night", label: "Night" },
];

/**
 * The named menu on phones and tablets (mobile UX handoff, owner 2026-10-27):
 * the tab bar carries only Map, Explore and My rides, so Settings and the
 * Day / Night switch live behind one labelled button in the top bar of every
 * page. Wide screens keep Settings in their top bar and never show this.
 */
export function AppMenu({ className }: { readonly className?: string }) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const buttonRef = useRef<HTMLButtonElement | null>(null);
  const panelId = useId();
  const mode = useAppearanceMode();

  useEffect(() => {
    if (!open) return;
    // The panel is fixed to the viewport's right edge, under the button, so it
    // never opens off-screen when a narrow header wraps the button left.
    const place = (): void => {
      const box = buttonRef.current?.getBoundingClientRect();
      if (box !== undefined) rootRef.current?.style.setProperty("--og-appmenu-top", `${Math.round(box.bottom + 8)}px`);
    };
    place();
    window.addEventListener("resize", place);
    const onPointer = (event: PointerEvent): void => {
      if (event.target instanceof Node && rootRef.current?.contains(event.target) === true) return;
      setOpen(false);
    };
    const onKey = (event: KeyboardEvent): void => {
      if (event.key !== "Escape") return;
      setOpen(false);
      buttonRef.current?.focus();
    };
    document.addEventListener("pointerdown", onPointer);
    document.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("resize", place);
      document.removeEventListener("pointerdown", onPointer);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <div className={`og-appmenu${className === undefined ? "" : ` ${className}`}`} ref={rootRef} data-open={open ? "true" : undefined}>
      <button
        ref={buttonRef}
        type="button"
        className="og-appmenu__button"
        data-testid="app-menu"
        aria-label="Menu"
        aria-expanded={open}
        aria-controls={panelId}
        onClick={() => setOpen((value) => !value)}
      >
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
          <path d="M4 7h16M4 12h16M4 17h10" />
        </svg>
      </button>
      {open ? (
        <div className="og-appmenu__panel" id={panelId} role="group" aria-label="Menu">
          <p className="og-appmenu__title">OpenGravel</p>
          <div className="og-appmenu__modes" role="radiogroup" aria-label="Appearance">
            {MODES.map((entry) => (
              <button
                key={entry.mode}
                type="button"
                role="radio"
                aria-checked={mode === entry.mode}
                data-testid={`app-menu-theme-${entry.mode}`}
                onClick={() => setAppearanceMode(entry.mode)}
              >
                {entry.label}
              </button>
            ))}
          </div>
          <Link className="og-appmenu__link" href="/settings" prefetch={false} data-testid="app-menu-settings" onClick={() => setOpen(false)}>
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <circle cx="12" cy="12" r="3" />
              <path d="M12 2.5v2.2M12 19.3v2.2M2.5 12h2.2M19.3 12h2.2M5.3 5.3l1.6 1.6M17.1 17.1l1.6 1.6M5.3 18.7l1.6-1.6M17.1 6.9l1.6-1.6" />
            </svg>
            Settings
          </Link>
          <Link className="og-appmenu__link" href="/rides" prefetch={false} onClick={() => setOpen(false)}>
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M12 3v12M7 10l5 5 5-5M5 21h14" />
            </svg>
            Import a GPX
          </Link>
        </div>
      ) : null}
    </div>
  );
}
