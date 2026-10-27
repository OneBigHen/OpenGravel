import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { AppMenu } from "@/ui/nav/AppMenu";
import { PrimaryNav } from "@/ui/nav/PrimaryNav";
import { appCss } from "../../helpers/app-css";

afterEach(() => cleanup());

describe("the named menu (mobile UX handoff)", () => {
  it("opens Settings and the Day / Night switch, and closes on Escape", () => {
    render(<AppMenu />);
    const button = screen.getByRole("button", { name: "Menu" });
    fireEvent.click(button);
    expect(button).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByRole("link", { name: "Settings" })).toHaveAttribute("href", "/settings");
    expect(screen.getByRole("radiogroup", { name: "Appearance" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("radio", { name: "Night" }));
    expect(document.documentElement.dataset.theme).toBe("night");
    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByRole("link", { name: "Settings" })).toBeNull();
    expect(button).toHaveFocus();
  });

  it("leaves three places in the tab bar: Map, Explore, My rides", () => {
    render(<PrimaryNav current="/" />);
    const nav = screen.getByRole("navigation", { name: "Primary" });
    expect([...nav.querySelectorAll("a")].map((link) => link.textContent)).toEqual(["Map", "Explore", "My rides"]);
    expect(appCss()).toMatch(/grid-template-columns: repeat\(3, minmax\(0, 1fr\)\);/);
  });
});
