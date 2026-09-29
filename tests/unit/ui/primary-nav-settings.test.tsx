import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { PrimaryNav } from "@/ui/nav/PrimaryNav";

afterEach(() => cleanup());

describe("shared navigation settings link", () => {
  it("shows Settings as a secondary destination", () => {
    render(<PrimaryNav current="/settings" />);
    const nav = screen.getByRole("navigation", { name: "Primary" });
    expect(nav.querySelectorAll("a")).toHaveLength(3);
    expect(screen.getByRole("link", { name: "Settings" })).toHaveAttribute("href", "/settings");
    expect(screen.getByRole("link", { name: "Settings" })).toHaveAttribute("aria-current", "page");
    expect(nav).not.toContainElement(screen.getByRole("link", { name: "Settings" }));
  });
});

describe("settings link icon", () => {
  it("keeps the gear visible on the wider tiers, where the link has no text", async () => {
    const { readFileSync } = await import("node:fs");
    const css = readFileSync("src/app/globals.css", "utf8");
    // Outside any media query the nav icons are hidden; the settings gear is the
    // exception, or the desktop link renders as an empty ring.
    expect(css).toMatch(/\n\.og-planner__settings-link \.og-nav__icon \{\s*display: block;/);
  });
});
