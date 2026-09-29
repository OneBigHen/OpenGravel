/**
 * Focus behavior contract (12 §15 "focus visible … focus return", §20 modal and
 * sheet behavior; 05 §21 map keyboard path; 11.1 share sheet).
 *
 * One focus ring for the app, visible on keyboard focus everywhere including
 * the keyboard-reachable map canvas, and the three true modals move focus in,
 * keep Tab inside, and hand it back to the invoker on close.
 */

import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { useState, type ReactElement } from "react";
import { afterEach, describe, expect, it } from "vitest";

import { MemoryShareRepository } from "@/application/sharing/memory-share-repository";
import { createShareService } from "@/application/sharing/share-commands";
import type { Coordinate, SurfaceIntent } from "@/domain/ride/types";
import type { ShareSource } from "@/domain/sharing/types";
import { ShareSheet } from "@/ui/sharing/ShareSheet";

const CSS = readFileSync("src/app/globals.css", "utf8");
const CSS_RULES_SOURCE = CSS.replace(/\/\*[\s\S]*?\*\//g, "");

const RULES: ReadonlyArray<{ selector: string; body: string }> = [...CSS_RULES_SOURCE.matchAll(/([^{}]+)\{([^{}]*)\}/g)].map(
  (match) => ({ selector: (match[1] as string).trim(), body: match[2] as string }),
);

function exactRuleBody(selector: string): string | null {
  const found = RULES.filter((rule) => rule.selector === selector);
  return found.length === 0 ? null : (found[found.length - 1] as { body: string }).body;
}

afterEach(cleanup);

describe("focus — one visible ring (12 §15)", () => {
  it("has a global :focus-visible outline", () => {
    const body = exactRuleBody(":focus-visible");
    expect(body, "globals.css must declare a global :focus-visible ring").not.toBeNull();
    expect(body as string).toMatch(/outline:\s*(var\(--og-focus-width\)|[1-9][0-9]*px)/);
  });

  it("keeps the keyboard-reachable map canvas focus visible", () => {
    const suppressed = exactRuleBody(".og-map canvas:focus");
    const suppressionHidesOutline = suppressed !== null && /outline:\s*(none|0)/.test(suppressed);
    const replacement = exactRuleBody(".og-map canvas:focus-visible");
    const replacementVisible =
      replacement !== null && /outline:\s*(?!none|0\b)(var\(--og-focus-width\)|[1-9][0-9]*px)/.test(replacement);
    if (suppressionHidesOutline) {
      expect(replacementVisible, ".og-map canvas:focus suppresses the outline without a :focus-visible replacement").toBe(
        true,
      );
    }
    expect(replacementVisible, "the map canvas needs a :focus-visible ring (05 §21)").toBe(true);
  });
});

describe("focus — every modal wires shared focus management (12 §20)", () => {
  it("each role=\"dialog\" component calls useDialogFocus", () => {
    const root = path.join(process.cwd(), "src", "ui");
    const files: string[] = [];
    const walk = (dir: string): void => {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) walk(full);
        else if (entry.name.endsWith(".tsx")) files.push(full);
      }
    };
    walk(root);
    const offenders: string[] = [];
    for (const file of files) {
      const source = readFileSync(file, "utf8");
      if (!source.includes('role="dialog"')) continue;
      if (!source.includes("useDialogFocus(")) offenders.push(path.relative(process.cwd(), file));
    }
    expect(offenders).toEqual([]);
  });
});

const ROUTE: readonly Coordinate[] = Array.from({ length: 8 }, (_, index) => ({
  lon: -75.43,
  lat: 40.13 + index * 0.001,
}));

const SURFACE: SurfaceIntent = {
  preference: "mostly-pavement",
  unknownSurfacePolicy: "avoid-when-possible",
};

function source(): ShareSource {
  return {
    sourceRevision: 7,
    title: "Pine Loop",
    route: { segments: [ROUTE] },
    summary: { distanceMeters: 2_100, durationSeconds: 6_000 },
    surface: SURFACE,
    provenance: "import",
    authorPseudonym: null,
  };
}

function service() {
  return createShareService({
    repository: new MemoryShareRepository(),
    linkBase: "https://opengravel.test",
    now: () => "2026-01-01T10:00:00.000Z",
  });
}

function Harness(): ReactElement {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" onClick={() => setOpen(true)}>
        Open share
      </button>
      {open ? (
        <ShareSheet service={service()} source={source()} onClose={() => setOpen(false)} />
      ) : null}
    </>
  );
}

describe("focus — modal dialog lifecycle (12 §20)", () => {
  it("moves focus into the dialog on open", () => {
    render(<Harness />);
    fireEvent.click(screen.getByRole("button", { name: "Open share" }));
    const dialog = screen.getByRole("dialog", { name: "Share this ride" });
    expect(dialog.contains(document.activeElement)).toBe(true);
  });

  it("closes on Escape and returns focus to the invoker", () => {
    render(<Harness />);
    const invoker = screen.getByRole("button", { name: "Open share" });
    // Real browsers move focus to the clicked control before the dialog mounts
    // (mousedown focus); jsdom needs the explicit step for the refocus proof.
    invoker.focus();
    fireEvent.click(invoker);
    expect(screen.getByRole("dialog", { name: "Share this ride" })).toBeInTheDocument();
    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByRole("dialog", { name: "Share this ride" })).toBeNull();
    expect(document.activeElement).toBe(invoker);
  });

  it("keeps Tab inside the dialog", () => {
    render(<Harness />);
    fireEvent.click(screen.getByRole("button", { name: "Open share" }));
    const dialog = screen.getByRole("dialog", { name: "Share this ride" });
    const focusables = [...dialog.querySelectorAll<HTMLElement>("button, input, a[href], select, textarea")].filter(
      (element) => !(element as HTMLInputElement).disabled,
    );
    expect(focusables.length).toBeGreaterThan(1);
    const first = focusables[0] as HTMLElement;
    const last = focusables[focusables.length - 1] as HTMLElement;
    last.focus();
    fireEvent.keyDown(dialog, { key: "Tab" });
    expect(document.activeElement).toBe(first);
    first.focus();
    fireEvent.keyDown(dialog, { key: "Tab", shiftKey: true });
    expect(document.activeElement).toBe(last);
  });

  it("every control in the dialog has an accessible name (12 §19)", () => {
    render(<Harness />);
    fireEvent.click(screen.getByRole("button", { name: "Open share" }));
    const dialog = screen.getByRole("dialog", { name: "Share this ride" });
    const unnamed: string[] = [];
    for (const element of dialog.querySelectorAll<HTMLElement>("button, input, select, textarea, a[href]")) {
      const wrappedLabel = element.closest("label")?.textContent?.trim();
      const associated =
        element.id.length > 0 ? (dialog.ownerDocument.querySelector(`label[for="${element.id}"]`)?.textContent ?? "") : "";
      const name =
        element.getAttribute("aria-label") ||
        element.getAttribute("title") ||
        wrappedLabel ||
        associated.trim() ||
        element.textContent?.trim() ||
        "";
      if (name.length === 0) unnamed.push(`${element.tagName.toLowerCase()}.${element.className}`);
    }
    expect(unnamed).toEqual([]);
  });
});
