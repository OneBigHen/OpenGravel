"use client";

import { useEffect, useRef } from "react";

type DialogRef = { readonly current: HTMLElement | null };

const FOCUSABLE =
  'a[href], button, input, select, textarea, [tabindex]:not([tabindex="-1"])';

/**
 * Focus management for OpenGravel's true modals (12 §20): focus enters the
 * dialog's first meaningful control on open, Tab stays inside while the modal
 * is up, Escape closes through the caller's `onClose`, and closing returns
 * focus to the invoker that opened the dialog (12 §15 "focus returns").
 *
 * The mobile context sheet is a sheet, not a modal (04 §19) and must not use
 * this hook — non-modal sheets never trap focus.
 */
export function useDialogFocus(dialogRef: DialogRef, onClose: () => void): void {
  const onCloseRef = useRef(onClose);
  useEffect(() => {
    onCloseRef.current = onClose;
  }, [onClose]);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (dialog === null) return;
    const doc = dialog.ownerDocument;
    const invoker = doc.activeElement instanceof HTMLElement ? doc.activeElement : null;

    const focusables = (): HTMLElement[] =>
      Array.from(dialog.querySelectorAll<HTMLElement>(FOCUSABLE)).filter(
        (element) => !element.hasAttribute("disabled") && !element.hasAttribute("hidden"),
      );

    const first = focusables()[0];
    if (first !== undefined) first.focus();

    const handleKeyDown = (event: KeyboardEvent): void => {
      if (event.key === "Escape") {
        event.preventDefault();
        onCloseRef.current();
        return;
      }
      if (event.key !== "Tab") return;
      const items = focusables();
      const firstItem = items[0];
      const lastItem = items[items.length - 1];
      if (firstItem === undefined || lastItem === undefined) {
        event.preventDefault();
        dialog.focus();
        return;
      }
      const active = doc.activeElement;
      const inside = active instanceof Node && dialog.contains(active);
      if (event.shiftKey && (!inside || active === firstItem)) {
        event.preventDefault();
        lastItem.focus();
      } else if (!event.shiftKey && (!inside || active === lastItem)) {
        event.preventDefault();
        firstItem.focus();
      }
    };
    doc.addEventListener("keydown", handleKeyDown);
    return () => {
      doc.removeEventListener("keydown", handleKeyDown);
      if (invoker !== null && doc.contains(invoker)) invoker.focus();
    };
  }, [dialogRef]);
}
