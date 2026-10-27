"use client";

import { useEffect, useRef, type ComponentPropsWithoutRef, type ReactNode, type RefObject } from "react";

export type SheetDetent = "peek" | "half" | "full";
export interface SheetProps extends Omit<ComponentPropsWithoutRef<"section">, "onToggle" | "children"> {
  readonly label: string;
  readonly detent: SheetDetent;
  readonly onToggle: () => void;
  readonly onStep: (direction: "up" | "down") => void;
  /** A drag lands on the height nearest where it was let go (or the next one, on a flick). */
  readonly onSnap?: ((detent: SheetDetent) => void) | undefined;
  readonly onDismiss?: (() => void) | undefined;
  /** Non-modal: the map stays reachable. Focus is moved only for a new surface. */
  readonly focusKey?: string | undefined;
  readonly head?: ReactNode;
  readonly handleContent?: ReactNode;
  readonly handleLabel?: string;
  readonly headRef?: RefObject<HTMLDivElement | null>;
  readonly bodyRef?: RefObject<HTMLDivElement | null>;
  readonly bodyId?: string;
  /** Desktop rail keeps its established labels/layout while sharing controls. */
  readonly rail?: boolean;
  readonly children: ReactNode;
}

export function Sheet({ label, detent, onToggle, onStep, onSnap, onDismiss, focusKey, head, handleContent,
  handleLabel, headRef, bodyRef, bodyId = "og-sheet-body", rail = false, children, className = "", ...attributes }: SheetProps) {
  const root = useRef<HTMLElement>(null);
  const handle = useRef<HTMLButtonElement>(null);
  const drag = useRef<{ x: number; y: number; t: number; id: number; height: number; head: boolean; active: boolean; lastY: number; lastT: number; velocity: number } | null>(null);
  const swallowed = useRef(false);
  const previous = useRef(detent);
  useEffect(() => {
    if (focusKey === undefined) return;
    const invoker = document.activeElement;
    (root.current?.querySelector<HTMLElement>("[data-sheet-focus], h2[tabindex], button:not(.og-sheet__handle)") ?? handle.current)?.focus({ preventScroll: true });
    return () => { if (invoker instanceof HTMLElement && invoker.isConnected) invoker.focus({ preventScroll: true }); };
  }, [focusKey]);
  useEffect(() => {
    if (previous.current !== detent && detent === "peek" && root.current?.contains(document.activeElement)) {
      handle.current?.focus({ preventScroll: true });
    }
    previous.current = detent;
  }, [detent]);
  const resetDrag = () => {
    drag.current = null;
    root.current?.removeAttribute("data-dragging");
    root.current?.style.removeProperty("--og-sheet-drag-h");
  };
  return <section {...attributes} ref={root} role="dialog" aria-label={label}
    className={`og-shared-sheet ${className}`} data-sheet-detent={detent} data-detent={attributes["data-detent" as keyof typeof attributes] ?? detent}
    data-sheet-rail={rail ? "true" : undefined}
    /*
      Drag like Google Maps' sheet: from the grab bar or the head anywhere, and
      on a phone from the body too while it is not the full sheet (the body
      scrolls only when full). The sheet follows the finger; on release it
      lands on the nearest height, or the next one in the flick's direction.
    */
    onPointerDown={(event) => {
      const element = event.target instanceof Element ? event.target : null;
      const inHandle = element?.closest(".og-sheet__handle") != null;
      const inHead = element?.closest(".og-sheet__head") != null;
      if (rail ? !inHead || event.pointerType === "mouse" && !inHandle : event.pointerType === "mouse" && !inHandle) return;
      if (!inHead && (detent === "full" || element?.closest("input, textarea, select, [contenteditable]") != null)) return;
      const height = root.current?.getBoundingClientRect().height ?? 0;
      drag.current = { x: event.clientX, y: event.clientY, t: event.timeStamp, id: event.pointerId, height, head: inHead, active: false, lastY: event.clientY, lastT: event.timeStamp, velocity: 0 };
    }}
    onPointerMove={(event) => {
      const start = drag.current;
      if (start === null || start.id !== event.pointerId) return;
      const dy = event.clientY - start.y;
      if (!start.active) {
        if (Math.abs(dy) <= 6) return;
        // A sideways swipe belongs to a chip row, not the sheet.
        if (Math.abs(event.clientX - start.x) > Math.abs(dy)) { drag.current = null; return; }
        start.active = true;
        swallowed.current = true;
        root.current?.setPointerCapture?.(event.pointerId);
      }
      const dt = Math.max(1, event.timeStamp - start.lastT);
      start.velocity = (event.clientY - start.lastY) / dt;
      start.lastY = event.clientY; start.lastT = event.timeStamp;
      if (!rail) {
        root.current?.setAttribute("data-dragging", "true");
        root.current?.style.setProperty("--og-sheet-drag-h", `${Math.max(96, Math.min(window.innerHeight - 72, start.height - dy))}px`);
      }
    }}
    onPointerUp={(event) => {
      const start = drag.current; resetDrag();
      if (start === null || start.id !== event.pointerId) return;
      const dy = event.clientY - start.y;
      // A release far from the press is a swipe even when no move was reported.
      if (!start.active && (Math.abs(dy) < 36 || Math.abs(event.clientX - start.x) > Math.abs(dy))) return;
      swallowed.current = true;
      window.setTimeout(() => { swallowed.current = false; }, 0);
      // A flick or a short swipe goes one height; a long drag lands where it was let go.
      const flick = start.active && Math.abs(start.velocity) > 0.45;
      if (onSnap === undefined || rail || flick || Math.abs(dy) < 160) {
        if (flick || Math.abs(dy) >= 36) onStep((flick ? start.velocity : dy) < 0 ? "up" : "down");
        return;
      }
      const share = (start.height - dy) / window.innerHeight;
      onSnap(share > 0.66 ? "full" : share > 0.3 ? "half" : "peek");
    }}
    onPointerCancel={() => { resetDrag(); swallowed.current = false; }}
    onClickCapture={(event) => {
      if (!swallowed.current) return;
      swallowed.current = false; event.preventDefault(); event.stopPropagation();
    }}
    onKeyDown={(event) => {
      attributes.onKeyDown?.(event);
      if (event.key !== "Escape" || event.defaultPrevented) return;
      event.preventDefault(); event.stopPropagation();
      if (onDismiss) onDismiss(); else onStep("down");
    }}>
    <div className="og-sheet__head" data-testid="sheet-head" ref={headRef}>
      <button ref={handle} type="button" className="og-sheet__handle" data-testid="sheet-handle" data-detent={attributes["data-detent" as keyof typeof attributes] ?? detent}
        aria-expanded={rail ? detent === "full" : detent !== "peek"} aria-controls={bodyId}
        aria-label={handleLabel ?? `${label}: ${detent}. ${detent === "full" ? "Collapse to peek" : detent === "half" ? "Expand fully" : "Expand to half"}`}
        onClick={onToggle} onKeyDown={(event) => {
          if (event.key === "ArrowUp" || event.key === "ArrowDown" || event.key === "Home" || event.key === "End") {
            event.preventDefault();
            onStep(event.key === "ArrowUp" || event.key === "End" ? "up" : "down");
          }
        }}>{handleContent}</button>
      {head}
    </div>
    <div className="og-sheet__body" id={bodyId} data-testid="sheet-scroll" ref={bodyRef}>{children}</div>
  </section>;
}
