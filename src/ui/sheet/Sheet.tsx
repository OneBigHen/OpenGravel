"use client";

import { useEffect, useRef, type ComponentPropsWithoutRef, type ReactNode, type RefObject } from "react";

export type SheetDetent = "peek" | "half" | "full";
export interface SheetProps extends Omit<ComponentPropsWithoutRef<"section">, "onToggle" | "children"> {
  readonly label: string;
  readonly detent: SheetDetent;
  readonly onToggle: () => void;
  readonly onStep: (direction: "up" | "down") => void;
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

export function Sheet({ label, detent, onToggle, onStep, onDismiss, focusKey, head, handleContent,
  handleLabel, headRef, bodyRef, bodyId = "og-sheet-body", rail = false, children, className = "", ...attributes }: SheetProps) {
  const root = useRef<HTMLElement>(null);
  const handle = useRef<HTMLButtonElement>(null);
  const drag = useRef<{ y: number; id: number; height: number } | null>(null);
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
    onKeyDown={(event) => {
      attributes.onKeyDown?.(event);
      if (event.key !== "Escape" || event.defaultPrevented) return;
      event.preventDefault(); event.stopPropagation();
      if (onDismiss) onDismiss(); else onStep("down");
    }}>
    <div className="og-sheet__head" data-testid="sheet-head" ref={headRef}
      onPointerDown={(event) => {
        const target = event.target instanceof Element ? event.target.closest(".og-sheet__handle") : null;
        if (target === null && (!rail || event.pointerType === "mouse")) return;
        drag.current = { y: event.clientY, id: event.pointerId, height: root.current?.getBoundingClientRect().height ?? 0 };
        if (target !== null) handle.current?.setPointerCapture?.(event.pointerId);
      }}
      onPointerMove={(event) => {
        const start = drag.current;
        if (start === null || start.id !== event.pointerId) return;
        const dy = event.clientY - start.y;
        if (Math.abs(dy) <= 4) return;
        swallowed.current = true;
        if (!rail) {
          root.current?.setAttribute("data-dragging", "true");
          root.current?.style.setProperty("--og-sheet-drag-h", `${Math.max(96, Math.min(window.innerHeight - 72, start.height - dy))}px`);
        }
      }}
      onPointerUp={(event) => {
        const start = drag.current; resetDrag();
        if (start === null || start.id !== event.pointerId) return;
        const dy = event.clientY - start.y;
        if (Math.abs(dy) >= 36) { swallowed.current = true; onStep(dy < 0 ? "up" : "down"); }
        window.setTimeout(() => { swallowed.current = false; }, 0);
      }}
      onPointerCancel={() => { resetDrag(); swallowed.current = false; }}
      onClickCapture={(event) => {
        if (!swallowed.current) return;
        swallowed.current = false; event.preventDefault(); event.stopPropagation();
      }}>
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
