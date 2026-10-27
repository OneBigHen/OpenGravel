import { cleanup, render, screen } from "@testing-library/react";
import { cssRule } from "../../helpers/app-css";
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
    // Design v3: the top bar shows every destination's icon beside its label,
    // and the settings link is the icon alone, so no tier may hide the icon
    // outside the phone tab bar.
    expect(cssRule(".og-nav__icon")).not.toMatch(/display:\s*none/);
    expect(cssRule(".og-planner__settings-link .og-nav__icon")).not.toMatch(/display:\s*none/);
  });
});
