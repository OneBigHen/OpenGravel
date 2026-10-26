import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { ExplorePanel } from "@/ui/explore/ExplorePanel";
import { ExploreMap } from "@/ui/explore/ExploreMap";
import { RouteDetail } from "@/ui/explore/RouteDetail";
import { rememberListPosition } from "@/ui/explore/list-position";
import { RouteCommunity } from "@/ui/explore/RouteCommunity";
import type { CatalogEntry } from "@/application/explore/catalog";
import { TRAFFIC_CORRIDOR_POINTS } from "@/application/preparation/planner-context";
import type { RoutePreparationContext } from "@/application/preparation/prepare-route";
import type { PreparationProviderRegistry, ProviderResult, TrafficData, WeatherData } from "@/application/preparation/providers";
import { discoverRoads } from "@/application/roads/discovery";
import { createRoadEntity } from "@/domain/roads/road-entity";
import { asRoadEntityId } from "@/domain/ride/ids";
import { aggregateSurface } from "@/domain/roads/surface";
import { createStubMapHostFactory } from "../support/stub-map-host";

const entry: CatalogEntry = {
  id: "route-1",
  source: "catalog",
  name: "Lehigh sample route",
  region: "Lehigh Valley",
  summary: "A route with no computed surface evidence.",
  distanceKm: 27.5,
  bounds: { west: -75.5, south: 40.5, east: -75.2, north: 40.7 },
  geometry: [
    { lon: -75.5, lat: 40.5 },
    { lon: -75.2, lat: 40.7 },
  ],
  provenance: "Sample route — built from real roads, not a recommendation.",
  provenanceDetail: "Geometry was produced from real road data between two anchor points.",
};

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  window.localStorage.clear();
  window.sessionStorage.clear();
  // A stubbed scroll offset belongs to its own test.
  Object.defineProperty(window, "scrollY", { configurable: true, value: 0 });
  window.history.replaceState({}, "", "/explore");
});

describe("Explore UI", () => {
  it("draws all matching routes and keeps the camera steady when a card is highlighted", async () => {
    const entries = Array.from({ length: 100 }, (_, index) => ({ ...entry, id: `route-${index}`, name: `Route ${index}` }));
    const hosts = createStubMapHostFactory();
    const props = { entries, onOpen: vi.fn(), hostFactory: hosts.factory, basemap: "empty" as const };
    const view = render(<ExploreMap {...props} highlightedId={null} />);
    await waitFor(() => expect(hosts.hosts[0]?.lastScene()?.routes).toHaveLength(100));
    const fits = hosts.hosts[0]!.fits.length;
    view.rerender(<ExploreMap {...props} highlightedId="route-99" />);
    await waitFor(() => expect(hosts.hosts[0]?.lastScene()?.routes.find((route) => route.id === "route-99")?.state).toBe("selected"));
    expect(hosts.hosts[0]!.fits).toHaveLength(fits);
    fireEvent.click(screen.getByRole("button", { name: "Fit routes" }));
    await waitFor(() => expect(hosts.hosts[0]!.fits.length).toBeGreaterThan(fits));
  });

  it("keeps a rider's pan when filtering until Fit routes is requested", async () => {
    const hosts = createStubMapHostFactory();
    const props = { onOpen: vi.fn(), hostFactory: hosts.factory, basemap: "empty" as const, highlightedId: null };
    const view = render(<ExploreMap {...props} entries={[entry]} />);
    await waitFor(() => expect(hosts.hosts[0]?.lastScene()?.routes).toHaveLength(1));
    const fits = hosts.hosts[0]!.fits.length;
    act(() => hosts.hosts[0]!.emit({ type: "camera-changed" }));
    view.rerender(<ExploreMap {...props} entries={[entry, { ...entry, id: "second" }]} />);
    await waitFor(() => expect(hosts.hosts[0]?.lastScene()?.routes).toHaveLength(2));
    expect(hosts.hosts[0]!.fits).toHaveLength(fits);
    fireEvent.click(screen.getByRole("button", { name: "Fit routes" }));
    await waitFor(() => expect(hosts.hosts[0]!.fits.length).toBeGreaterThan(fits));
  });

  it("expands the route map from a corner control on the map itself", () => {
    const hosts = createStubMapHostFactory();
    const view = render(<ExploreMap entries={[entry]} highlightedId={null} onOpen={vi.fn()} hostFactory={hosts.factory} basemap="empty" />);
    const expand = screen.getByRole("button", { name: "Expand map" });
    // The control lives in the map's own frame, so it takes no row from the page
    // above the map (small-screen design system v2 §3).
    expect(expand.closest(".og-explore-map-panel__frame")).not.toBeNull();
    expect(view.container.querySelector(".og-explore-map-panel__head")).toBeNull();
    fireEvent.click(expand);
    expect(screen.getByRole("dialog", { name: "Explore route map" })).toBeInTheDocument();
    expect(screen.getAllByTestId("explore-map")).toHaveLength(1);
    fireEvent.click(screen.getByRole("button", { name: "Close map" }));
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("adds discrete region and riding-area selections to browser history", () => {
    render(<ExplorePanel entries={[entry]} initialQuery={{ sort: "recommended" }} />);
    fireEvent.click(screen.getByRole("button", { name: "Filters" }));
    const push = vi.spyOn(window.history, "pushState");
    fireEvent.change(screen.getByRole("combobox", { name: "Filter by region" }), { target: { value: "Lehigh Valley" } });
    expect(push).toHaveBeenLastCalledWith({}, "", expect.stringContaining("region=Lehigh"));
    fireEvent.change(screen.getByRole("combobox", { name: "PA riding area" }), { target: { value: "eastern-pa" } });
    expect(push).toHaveBeenLastCalledWith({}, "", expect.stringContaining("area=eastern-pa"));
    push.mockRestore();
  });

  it("dresses every picker as the app's own control and ties the browse captions to their selects", () => {
    // UX: the browse pickers were raw native selects beside rounded controls.
    // Each select now sits in the shared .og-select wrapper (pill, hairline,
    // custom chevron), and the visible caption is associated by htmlFor/id.
    render(<ExplorePanel entries={[entry]} initialQuery={{ sort: "recommended" }} />);
    fireEvent.click(screen.getByRole("button", { name: "Filters" }));
    const filters = screen.getByRole("region", { name: "Explore filters" });
    for (const id of ["og-explore-region-picker", "og-explore-area-picker"]) {
      const select = document.getElementById(id);
      expect(select?.tagName).toBe("SELECT");
      expect(select?.parentElement).toHaveClass("og-select");
      expect(select?.closest("label")).toHaveAttribute("for", id);
      expect(filters).toContainElement(select);
    }
    const selects = Array.from(document.querySelectorAll("select"));
    expect(selects.length).toBeGreaterThan(0);
    for (const select of selects) expect(select.parentElement).toHaveClass("og-select");
  });

  it("shows more than ten rides and filters Pennsylvania riding areas from the filters sheet", () => {
    const entries = Array.from({ length: 30 }, (_, index) => ({ ...entry, id: `route-${index}`, name: `Route ${index}`, region: "Pennsylvania" }));
    entries.push({ ...entry, id: "west", name: "Western ride", region: "Pennsylvania", geometry: [{ lon: -80, lat: 40.5 }, { lon: -79.9, lat: 40.6 }] });
    render(<ExplorePanel entries={entries} initialQuery={{ sort: "recommended" }} />);
    expect(screen.getAllByRole("link", { name: /Route \d+/ })).toHaveLength(30);
    fireEvent.click(screen.getByRole("button", { name: "Filters" }));
    fireEvent.change(screen.getByRole("combobox", { name: "PA riding area" }), { target: { value: "eastern-pa" } });
    expect(screen.queryByRole("link", { name: /Western ride/ })).toBeNull();
    expect(screen.getAllByRole("link", { name: /Route \d+/ })).toHaveLength(30);
    expect(window.location.search).toContain("area=eastern-pa");
  });

  it("leads with the ride cards and folds the date, region and area pickers into the filters panel", () => {
    const twisty = { ...entry, id: "twisty", surfaceSummary: "Mixed", curvatureSummary: "Twisty" };
    render(<ExplorePanel entries={[twisty]} mapboxToken="public-test" />);
    const list = screen.getByRole("list", { name: "Explore routes" });
    const filters = screen.getByRole("region", { name: "Explore filters" });
    const follows = (first: Element, second: Element): boolean =>
      (first.compareDocumentPosition(second) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0;

    // One row of chips, and each names one decision: how near, how long, what
    // surface, how twisty — then the one chip that opens the rest. Length and
    // surface open the sheet on their own row.
    expect(within(screen.getByRole("group", { name: "Quick filters" })).getAllByRole("button").map((chip) => chip.textContent?.trim()))
      .toEqual(["Near me", "Length", "Paved/gravel", "Twisty", "Filters"]);
    // The date chips and both pickers live in the panel, not above the list.
    expect(filters).toContainElement(screen.getByRole("group", { name: "When" }));
    expect(filters).toContainElement(screen.getByRole("combobox", { name: "Filter by region" }));
    expect(filters).toContainElement(screen.getByRole("combobox", { name: "PA riding area" }));
    expect(follows(filters, list)).toBe(true);
    // Road windows come after the rides, and the map images are credited under them.
    expect(follows(list, screen.getByRole("button", { name: "Find roads near me" }))).toBe(true);
    expect(follows(list, screen.getAllByText("Map images © Mapbox © OpenStreetMap")[0]!)).toBe(true);
    // No explanatory prose and no section heading before the first ride.
    expect(screen.queryByRole("heading", { name: "Ready-made rides" })).toBeNull();
    expect(screen.queryByText(/Areas include nearby border towns/)).toBeNull();
    expect(screen.queryByText(/Find your next ride around Pennsylvania/)).toBeNull();
  });

  it("keeps one row of chips, search above them, and every other filter in that sheet", () => {
    // Explore used to ask for the same decision twice: distance chips above the
    // list and a distance select in the panel, "near me" in three places, and a
    // second filter bar above the roads. One row of chips and one sheet now hold
    // every filter, and each decision has exactly one control.
    const twisty = { ...entry, id: "twisty", surfaceSummary: "Mixed", curvatureSummary: "Twisty" };
    render(<ExplorePanel entries={[twisty]} />);
    const toolbar = screen.getByRole("searchbox", { name: "Search routes" }).closest(".og-explore__toolbar");
    expect(toolbar).not.toBeNull();
    const filters = screen.getByRole("region", { name: "Explore filters" });
    const chips = screen.getByRole("group", { name: "Quick filters" });

    // The chip row and the button that opens the rest share the toolbar, so the
    // stylesheet can put them on one line.
    expect(toolbar).toContainElement(chips);
    expect(toolbar).toContainElement(filters);
    const toggle = within(toolbar as HTMLElement).getByRole("button", { name: /^Filters/ });
    expect(toggle).toHaveAttribute("aria-label", "Filters");

    // Every remaining filter is reachable from the sheet, in one grid, and each
    // one appears once: no second distance, surface or near-me control.
    for (const name of ["Filter by distance", "Filter by surface", "Filter by source", "Sort routes", "Filter by region", "PA riding area"]) {
      expect(within(filters).getAllByRole("combobox", { name })).toHaveLength(1);
    }
    expect(within(filters).getByRole("group", { name: "When" })).toBeInTheDocument();
    expect(within(filters).queryByRole("checkbox", { name: "Curvy routes only" })).toBeNull();
    expect(within(chips).getByRole("button", { name: "Twisty" })).toHaveAttribute("aria-pressed", "false");

    // The panel is shut until the button says otherwise; closing it hands focus
    // back to that button.
    expect(filters).toHaveAttribute("data-open", "false");
    fireEvent.click(toggle);
    expect(filters).toHaveAttribute("data-open", "true");
    fireEvent.click(within(filters).getByRole("button", { name: /^Show \d+ route/ }));
    expect(filters).toHaveAttribute("data-open", "false");
    expect(toggle).toHaveFocus();
  });

  it("gives search the whole width on its own row and puts Filters last in the chip row", () => {
    // At 320px the search field shared a row with the Filters button and was
    // squeezed to "Search re…". Search now takes the width of the page on its
    // own line, and the button that opens the rest is the last chip in the row.
    render(<ExplorePanel entries={[entry]} />);
    const search = screen.getByRole("searchbox", { name: "Search routes" });
    const toolbar = search.closest(".og-explore__toolbar") as HTMLElement;
    const chips = screen.getByRole("group", { name: "Quick filters" });
    const toggle = screen.getByRole("button", { name: "Filters" });

    expect(search.closest(".og-explore__search")?.parentElement).toBe(toolbar);
    expect(chips).not.toContainElement(search.closest(".og-explore__search") as HTMLElement);
    expect(chips.lastElementChild).toBe(toggle);
    expect(toggle).toHaveClass("og-explore__quick-chip");

    // The count speaks only for the filters the chips cannot show.
    expect(toggle.querySelector(".og-explore__filters-count")).toBeNull();
    fireEvent.click(toggle);
    fireEvent.change(screen.getByRole("combobox", { name: "Filter by source" }), { target: { value: "personal" } });
    const counted = screen.getByRole("button", { name: "Filters, 1 on" });
    expect(counted).toHaveAttribute("data-filter", "on");
    expect(counted.querySelector(".og-explore__filters-count")).toHaveTextContent("1");
  });

  it("labels the date choices When, on the group as well as on the screen", () => {
    render(<ExplorePanel entries={[entry]} />);
    fireEvent.click(screen.getByRole("button", { name: "Filters" }));

    // Four unlabelled rows became one named row of chips: the caption is real
    // text, and it is the group's accessible name too.
    const when = screen.getByRole("group", { name: "When" });
    const caption = when.querySelector(".og-explore__row-label");
    expect(caption).toHaveTextContent("When");
    expect(when).toHaveAttribute("aria-labelledby", caption?.id);
    expect(within(when).getAllByRole("button").map((chip) => chip.textContent?.trim()))
      .toEqual(["Now", "This weekend", "Next weekend", "Pick date"]);
    expect(when).toContainElement(screen.getByRole("button", { name: "Pick date" }));
  });

  it("dims the page behind the sheet, and closes it on a scrim tap or Escape", () => {
    render(<ExplorePanel entries={[entry]} />);
    const toggle = screen.getByRole("button", { name: "Filters" });
    expect(screen.queryByRole("button", { name: "Close filters" })).toBeNull();

    fireEvent.click(toggle);
    // The scrim is a real target over the page, not a decorative layer: a tap
    // anywhere on it closes the sheet and hands the rider back to the chip.
    const scrim = screen.getByRole("button", { name: "Close filters" });
    expect(scrim).toHaveClass("og-explore__backdrop");
    fireEvent.click(scrim);
    expect(screen.getByRole("region", { name: "Explore filters" })).toHaveAttribute("data-open", "false");
    expect(toggle).toHaveFocus();

    // Escape closes it the same way, and takes the scrim with it.
    fireEvent.click(toggle);
    fireEvent.keyDown(window, { key: "Escape" });
    expect(screen.getByRole("region", { name: "Explore filters" })).toHaveAttribute("data-open", "false");
    expect(screen.queryByRole("button", { name: "Close filters" })).toBeNull();
  });

  it("names the length and surface choices on the chip, and keeps them in the one sheet", async () => {
    const twisty = { ...entry, id: "twisty", surfaceSummary: "Mixed", curvatureSummary: "Twisty" };
    render(<ExplorePanel entries={[twisty]} />);
    const chips = screen.getByRole("group", { name: "Quick filters" });
    const filters = screen.getByRole("region", { name: "Explore filters" });

    // The length chip opens the sheet on the length control, so the number of
    // distance controls is one, not two.
    fireEvent.click(within(chips).getByRole("button", { name: "Length" }));
    expect(filters).toHaveAttribute("data-open", "true");
    const length = within(filters).getByRole("combobox", { name: "Filter by distance" });
    await waitFor(() => expect(length).toHaveFocus());
    fireEvent.change(length, { target: { value: "short" } });
    expect(within(chips).getByRole("button", { name: "Under 30 mi" })).toHaveAttribute("data-filter", "on");

    // The surface chip opens the same sheet on the surface control.
    fireEvent.click(within(chips).getByRole("button", { name: "Paved/gravel" }));
    const surface = within(filters).getByRole("combobox", { name: "Filter by surface" });
    await waitFor(() => expect(surface).toHaveFocus());
    fireEvent.change(surface, { target: { value: "gravel" } });
    expect(within(chips).getByRole("button", { name: "Gravel" })).toHaveAttribute("data-filter", "on");

    // Twisty is the one control for curvature, and it is the chip.
    fireEvent.click(within(chips).getByRole("button", { name: "Twisty" }));
    expect(within(chips).getByRole("button", { name: "Twisty" })).toHaveAttribute("aria-pressed", "true");
    // Reset clears the chips too, and the sheet counts only what it hides.
    fireEvent.click(within(filters).getByRole("button", { name: "Reset" }));
    expect(within(chips).getByRole("button", { name: "Length" })).toBeInTheDocument();
    expect(within(chips).getByRole("button", { name: "Twisty" })).toHaveAttribute("aria-pressed", "false");
  });

  it("offers only one place to filter the roads worth riding", () => {
    const entity = createRoadEntity({
      name: "Ridge Road",
      class: "tertiary",
      endpoints: [{ lon: -75.5, lat: 40.5 }, { lon: -75.4, lat: 40.6 }],
      firstSeen: "2026-09-01T00:00:00.000Z",
      lastSeen: "2026-09-17T00:00:00.000Z",
    });
    const roads = discoverRoads({
      roads: [{
        entity,
        geometry: [{ lon: -75.5, lat: 40.5 }, { lon: -75.46, lat: 40.56 }, { lon: -75.4, lat: 40.6 }],
        matchedDistanceKm: 8.5,
        matchedRideCount: 2,
        region: "Lehigh Valley",
        evidence: [],
      }],
    });
    render(<ExplorePanel entries={[entry]} roadCandidates={roads} />);

    // The page no longer carries a second filter bar above the road list.
    expect(screen.queryByRole("region", { name: "Road filters" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Filters" }));
    const filters = screen.getByRole("region", { name: "Explore filters" });
    const roadFilters = within(filters).getByRole("group", { name: "Worth riding filters" });
    expect(within(roadFilters).getByRole("combobox", { name: "Filter roads by surface" })).toBeInTheDocument();
    expect(within(roadFilters).getByRole("checkbox", { name: "Roads within 30 mi of me" })).toBeInTheDocument();
    expect(within(filters).queryByRole("combobox", { name: "Filter roads by distance" })).toBeNull();

    // The sheet's one Reset resets the sheet, roads included: a reset that left
    // half of what it shows still narrowed would be a lie about its own name.
    fireEvent.change(within(roadFilters).getByRole("combobox", { name: "Filter roads by surface" }), { target: { value: "gravel" } });
    fireEvent.click(within(filters).getByRole("button", { name: "Reset" }));
    expect(within(roadFilters).getByRole("combobox", { name: "Filter roads by surface" })).toHaveValue("any");
    expect(within(filters).getByRole("button", { name: "Reset" })).toBeDisabled();
  });

  it("leads the page with its title, not a second line above it", () => {
    render(<ExplorePanel entries={[entry]} />);
    expect(screen.getByRole("heading", { name: "Explore", level: 1 })).toBeInTheDocument();
    expect(document.querySelector(".og-explore__heading .og-eyebrow")).toBeNull();
    expect(screen.queryByText(/Find your next ride/i)).toBeNull();
  });

  it("draws a ride card as its map, the name and one line of plain facts", () => {
    // Design system v2 §4: a phone card is the route on its map, the name over
    // two lines at most, then ONE line of facts. The old card's pill badges are
    // what clipped at 320px ("Est. Mostly paved · 4.7 mi gra"), so nothing on
    // the card is a pill and nothing carries an "Est." stamp any more.
    const twisty = { ...entry, id: "twisty", name: "Twisty loop", surfaceSummary: "Mostly paved", curvatureSummary: "Twisty", variantCount: 2 };
    render(<ExplorePanel entries={[twisty]} />);
    const card = screen.getByRole("list", { name: "Explore routes" }).querySelector(".og-explore-card")!;

    // The map image leads the card (16:9 and full width are the stylesheet's job).
    expect(card.firstElementChild?.firstElementChild).toHaveClass("og-explore-card__preview");
    expect(card.querySelector(".og-explore-card__title")).toHaveTextContent("Twisty loop");

    // One meta line, in the order a rider asks the questions.
    const facts = [...card.querySelectorAll(".og-explore-card__fact")].map((fact) => fact.textContent);
    expect(facts).toEqual(["17 mi", "Twisty", "Mostly paved"]);

    expect(card.querySelector(".og-explore-card__chip")).toBeNull();
    expect(card.querySelector("[data-surface]")).toBeNull();
    expect(card).not.toHaveTextContent(/Est\./);

    // The credit is one caption line, and it still names the source in words a
    // rider uses: the ride is on Explore, not "in the catalog".
    expect(card.querySelector(".og-explore-card__credit")).toHaveTextContent("From Explore");
    expect(card.querySelector(".og-explore-card__credit")).toHaveTextContent("2 versions");
  });

  it("says nothing on the facts line where the route has no curvature or surface", () => {
    // Every card used to carry "Curvature unknown · Surface unknown": sixteen
    // repetitions of the same absence down one list. Unknown is still never
    // shown as a value, so the fact is left out rather than dressed up.
    render(<ExplorePanel entries={[entry]} />);
    const card = screen.getByRole("list", { name: "Explore routes" }).querySelector(".og-explore-card")!;
    const facts = [...card.querySelectorAll(".og-explore-card__fact")].map((fact) => fact.textContent);
    expect(facts).toEqual(["17 mi"]);
    expect(card).not.toHaveTextContent(/Curvature unknown|Surface unknown/);
  });

  it("names who shared a ride instead of counting its comments on the card", () => {
    const shared = { ...entry, id: "shared", storyTeaser: { sourceName: "PA Adventure Bike Rides", sharedBy: "Seth", commentCount: 3, photoCount: 2 } };
    render(<ExplorePanel entries={[shared]} />);
    const credit = screen.getByRole("list", { name: "Explore routes" }).querySelector(".og-explore-card__credit")!;
    expect(credit).toHaveTextContent("Shared by Seth");
    expect(credit).not.toHaveTextContent(/comment|photo/);
  });

  it("keeps one fact's own separators from reading as extra facts", () => {
    // The surface evidence is written "Mostly paved · 2.1 mi gravel"; on the card
    // the middot separates facts, so that fact becomes a comma.
    const gravel = { ...entry, id: "gravel", surfaceSummary: "Mostly paved · 2.1 mi gravel", curvatureSummary: "Twisty" };
    render(<ExplorePanel entries={[gravel]} />);
    const card = screen.getByRole("list", { name: "Explore routes" }).querySelector(".og-explore-card")!;
    const facts = [...card.querySelectorAll(".og-explore-card__fact")].map((fact) => fact.textContent);
    expect(facts).toEqual(["17 mi", "Twisty", "Mostly paved, 2.1 mi gravel"]);
  });

  it("filters by length in one tap from the chip, and Escape closes the sheet", () => {
    render(<ExplorePanel entries={[entry]} />);

    // The chip opens the sheet on the length control; choosing there is one tap
    // more than the old chip row and one control fewer on the page.
    const length = screen.getByRole("button", { name: "Length" });
    fireEvent.click(length);
    const select = screen.getByRole("combobox", { name: "Filter by distance" });
    fireEvent.change(select, { target: { value: "short" } });
    expect(screen.getByRole("button", { name: "Under 30 mi" })).toHaveAttribute("data-filter", "on");

    // The sheet's own count only counts what the chips cannot show.
    const toggle = screen.getByRole("button", { name: "Filters" });
    expect(toggle).toHaveAttribute("aria-expanded", "true");
    fireEvent.click(screen.getByRole("button", { name: "Reset" }));
    expect(screen.getByRole("button", { name: "Length" })).toBeInTheDocument();
    fireEvent.keyDown(window, { key: "Escape" });
    expect(screen.getByRole("button", { name: "Filters" })).toHaveAttribute("aria-expanded", "false");
  });

  it("says how far each route starts from a rider who already shared their location, without asking", async () => {
    const getCurrentPosition = vi.fn((ok: PositionCallback) => ok({ coords: { longitude: -75.5, latitude: 40.6 } } as GeolocationPosition));
    vi.stubGlobal("navigator", {
      ...navigator,
      permissions: { query: vi.fn(async () => ({ state: "granted" })) },
      geolocation: { getCurrentPosition },
    });
    render(<ExplorePanel entries={[entry]} />);
    expect(await screen.findByTestId("explore-card-away")).toHaveTextContent(/mi away|Starts near you/);
    vi.unstubAllGlobals();
  });

  it("never asks for location on its own when the rider has not allowed it", async () => {
    const getCurrentPosition = vi.fn();
    vi.stubGlobal("navigator", {
      ...navigator,
      permissions: { query: vi.fn(async () => ({ state: "prompt" })) },
      geolocation: { getCurrentPosition },
    });
    render(<ExplorePanel entries={[entry]} />);
    await waitFor(() => expect(navigator.permissions.query).toHaveBeenCalled());
    expect(getCurrentPosition).not.toHaveBeenCalled();
    expect(screen.queryByTestId("explore-card-away")).toBeNull();
    vi.unstubAllGlobals();
  });

  it("names the source in rider words, and keeps the long provenance off the card", () => {
    // A badge reading `Curated` once sat next to copy saying the route was not
    // curated, and then the badge named the store the rides are kept in. It now
    // says where the rider is standing: the ride is from Explore.
    render(<ExplorePanel entries={[entry]} />);

    expect(screen.getByRole("heading", { name: "Explore" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Lehigh sample route/i })).toBeInTheDocument();
    // Both the badge and the source filter speak the same honest words.
    expect(screen.getByText("From Explore", { selector: ".og-explore-card__source" })).toBeInTheDocument();
    expect(screen.getByRole("option", { name: "From Explore" })).toBeInTheDocument();
    // A route with no surface or curvature evidence says nothing about either,
    // on the card and in the sheet: absence is not printed as a value.
    expect(screen.queryByText("Surface unknown")).toBeNull();
    expect(screen.queryByText("Curvature unknown")).toBeNull();
    expect(screen.getByRole("searchbox", { name: "Search routes" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Filters" }));
    const filters = within(screen.getByRole("region", { name: "Explore filters" }));
    expect(filters.getByRole("option", { name: "From Explore" })).toBeInTheDocument();
    expect(filters.getByRole("combobox", { name: "Filter by region" })).toHaveValue("");
    expect(filters.getByRole("combobox", { name: "Sort routes" })).toHaveValue("recommended");
    // Without evidence both choices say so by being unavailable, not by offering
    // a filter that would match nothing.
    expect(filters.getByRole("combobox", { name: "Filter by surface" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Paved/gravel" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Twisty" })).toBeDisabled();
    expect(screen.queryByText("Curated")).not.toBeInTheDocument();
    expect(screen.queryByText(entry.provenance)).not.toBeInTheDocument();
    expect(screen.queryByText(/GraphHopper|motorcycle_scenic/)).not.toBeInTheDocument();

    fireEvent.change(filters.getByRole("combobox", { name: "Filter by source" }), {
      target: { value: "personal" },
    });
    // Asked for their own rides and has none: that is the honest reason, said
    // once, instead of a filter message about the published rides.
    expect(screen.getByText(/No personal rides yet/)).toBeInTheDocument();
    expect(screen.queryByText("No routes match these filters.")).toBeNull();
  });

  it("shows an inline note when geolocation is denied", async () => {
    Object.defineProperty(navigator, "geolocation", {
      configurable: true,
      value: { getCurrentPosition: (_success: unknown, error: (reason: { code: number }) => void) => error({ code: 1 }) },
    });
    render(<ExplorePanel entries={[entry]} />);

    // One way to sort by distance, not two: the chip above the list. The Filters
    // sheet's duplicate button is gone and its Sort select calls the same code.
    expect(screen.queryByRole("button", { name: "Sort by distance from me" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Near me" }));
    expect(await screen.findByText(/location permission was not granted/i)).toBeInTheDocument();
  });

  it("opens on the ride's name and puts the provenance behind a disclosure", () => {
    render(<RouteDetail entry={entry} onUse={vi.fn()} />);

    // The page opens on the ride itself: no eyebrow naming the store the route
    // is kept in, and no "curated" claim either.
    const heading = screen.getByRole("heading", { name: "Lehigh sample route", level: 1 });
    expect(heading.closest(".og-route-detail__heading")).not.toBeNull();
    expect(document.querySelector(".og-route-detail__header .og-eyebrow")).toBeNull();
    expect(screen.queryByText(/Catalog|Curated/)).toBeNull();

    // One honest line under the name, and the mechanics behind a disclosure
    // that closes the page rather than in the header the rider reads first.
    expect(screen.getByTestId("route-meta")).toHaveTextContent(entry.provenance);
    const disclosure = screen.getByText("Where this route came from");
    expect(disclosure.closest("details")).not.toBeNull();
    expect(disclosure.closest("details")).toHaveTextContent(entry.provenanceDetail ?? "");
    expect(disclosure.closest(".og-route-detail__credits")).not.toBeNull();
  });

  it("shares a route through the share sheet, or copies its link where there is none", async () => {
    const writeText = vi.fn(async () => undefined);
    vi.stubGlobal("navigator", { ...navigator, share: undefined, clipboard: { writeText } });
    render(<RouteDetail entry={entry} onUse={vi.fn()} />);
    fireEvent.click(screen.getByTestId("route-share"));
    expect(await screen.findByText("Link copied")).toBeInTheDocument();
    expect(writeText).toHaveBeenCalledWith(window.location.href);
    cleanup();

    const share = vi.fn(async () => undefined);
    vi.stubGlobal("navigator", { ...navigator, share });
    render(<RouteDetail entry={entry} onUse={vi.fn()} />);
    fireEvent.click(screen.getByTestId("route-share"));
    await waitFor(() => expect(share).toHaveBeenCalledWith(expect.objectContaining({ url: window.location.href })));
    vi.unstubAllGlobals();
  });

  it("keeps a donor file path and attribution inside the provenance disclosure", () => {
    const donorEntry = {
      ...entry,
      provenance: "rideplanner · rideplanner/output/gpx/long-route.gpx",
      provenanceDetail: "Author: 54warrior · License: not specified by the source",
    };
    render(<RouteDetail entry={donorEntry} onUse={vi.fn()} />);

    // The header names the source; the file path stays in the disclosure.
    expect(screen.getByTestId("route-meta")).toHaveTextContent(/^rideplanner$/);
    expect(screen.queryByText(donorEntry.provenance)).not.toBeInTheDocument();
    const disclosure = screen.getByText("Where this route came from").closest("details");
    expect(disclosure).toHaveTextContent(donorEntry.provenance);
    expect(disclosure).toHaveTextContent(donorEntry.provenanceDetail);
  });

  it("lists the other versions of the ride in words a rider uses", () => {
    render(<RouteDetail
      entry={entry}
      onUse={vi.fn()}
      variants={[
        { id: "route-1", label: "Track 1", name: "Lehigh sample route", distanceKm: 27.5, copyCount: 3 },
        { id: "route-2", label: "Track 2", name: "Lehigh sample route · track 2", distanceKm: 29, copyCount: 1 },
        { id: "route-3", label: "Track 3", name: "Lehigh sample route · track 3", distanceKm: null, copyCount: 1 },
      ]}
    />);
    const versions = screen.getByRole("region", { name: "Other versions of this ride" });
    expect(versions).toHaveTextContent("Other versions");
    // "Exports" and "tracks" are how the file was kept, not what the rider gets.
    expect(versions).not.toHaveTextContent(/export|variant/i);
    expect(screen.getByRole("link", { name: /Lehigh sample route.*3 versions/i })).toHaveAttribute("href", "/explore/route-1");
    expect(screen.getByRole("link", { name: /3 versions/i })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Track 2/ })).toHaveAttribute("href", "/explore/route-2");
    // A version whose length was never measured keeps the em dash, and its
    // accessible name says which number is missing.
    expect(screen.getByLabelText("Distance unknown")).toHaveTextContent("—");
  });

  it("keeps the distance and the source on one meta line, with the paperwork at the foot", async () => {
    const getCurrentPosition = vi.fn((ok: PositionCallback) => ok({ coords: { longitude: -75.5, latitude: 40.6 } } as GeolocationPosition));
    vi.stubGlobal("navigator", {
      ...navigator,
      permissions: { query: vi.fn(async () => ({ state: "granted" })) },
      geolocation: { getCurrentPosition },
    });
    render(<RouteDetail entry={{ ...entry, provenance: "PA Adventure Bike Rides · rides/pa-ridge.gpx" }} onUse={vi.fn()} />);

    const meta = await screen.findByTestId("route-meta");
    expect(meta).toHaveTextContent(/^Starts 7 mi from you · PA Adventure Bike Rides$/);
    expect(meta.closest("header")).not.toBeNull();
    // The header carries the two facts and nothing else: the disclosure that
    // explains them closes the page with the credits.
    expect(screen.getByText("Where this route came from").closest("header")).toBeNull();
    expect(screen.getByText("Where this route came from").closest(".og-route-detail__credits")).not.toBeNull();
  });

  it("says how far the start is from a rider who already allowed location, and asks nobody else", async () => {
    const getCurrentPosition = vi.fn((ok: PositionCallback) => ok({ coords: { longitude: -75.5, latitude: 40.6 } } as GeolocationPosition));
    vi.stubGlobal("navigator", {
      ...navigator,
      permissions: { query: vi.fn(async () => ({ state: "granted" })) },
      geolocation: { getCurrentPosition },
    });
    render(<RouteDetail entry={entry} onUse={vi.fn()} />);

    expect(await screen.findByTestId("route-start-distance")).toHaveTextContent(/^Starts 7 mi from you$/);
  });

  it("shows no start distance on the route page without location permission", async () => {
    const getCurrentPosition = vi.fn();
    vi.stubGlobal("navigator", {
      ...navigator,
      permissions: { query: vi.fn(async () => ({ state: "prompt" })) },
      geolocation: { getCurrentPosition },
    });
    render(<RouteDetail entry={entry} onUse={vi.fn()} />);

    await waitFor(() => expect(navigator.permissions.query).toHaveBeenCalled());
    expect(getCurrentPosition).not.toHaveBeenCalled();
    expect(screen.queryByTestId("route-start-distance")).toBeNull();
  });

  it("draws one route with a way back to its line instead of a count", async () => {
    const hosts = createStubMapHostFactory();
    render(<RouteDetail entry={entry} onUse={vi.fn()} map={{ hostFactory: hosts.factory, basemap: "empty" }} />);
    await waitFor(() => expect(hosts.hosts[0]?.lastScene()?.routes).toHaveLength(1));

    expect(screen.queryByText(/1 mapped/)).toBeNull();
    const fits = hosts.hosts[0]!.fits.length;
    fireEvent.click(screen.getByRole("button", { name: "Recenter" }));
    await waitFor(() => expect(hosts.hosts[0]!.fits.length).toBeGreaterThan(fits));
  });

  it("leaves roads, planning mechanics and the briefing off the page when there is nothing to say", () => {
    render(<RouteDetail entry={entry} onUse={vi.fn()} />);

    // No matched roads is no section, not a paragraph explaining an absence.
    expect(screen.queryByRole("heading", { name: "Roads on this ride" })).toBeNull();
    expect(screen.queryByTestId("roads-none-matched")).toBeNull();
    expect(screen.queryByText(/Planning follows this line/)).toBeNull();
    // No weather provider means no weather line, never a badge or a source line.
    expect(screen.queryByRole("heading", { name: "Before you ride" })).toBeNull();
    expect(screen.queryByTestId("route-conditions")).toBeNull();
    expect(screen.queryByText("Offline readiness")).toBeNull();
  });

  it("reduces the briefing to one line of weather at the start", () => {
    const ready: ProviderResult<WeatherData> = {
      state: "ready",
      reason: "Forecast received for the selected route.",
      provenance: "Source: weather service · updated 14:32",
      data: { display: "Sunny · 72°F", freshnessLabel: "Fresh" },
    };
    const weather: PreparationProviderRegistry["weather"] = {
      id: "weather-test",
      kind: "weather",
      capabilities: () => ({ kind: "weather", availability: "available", freshness: "time-bound", reason: null, provenance: "test" }),
      getWeather: () => ready,
    };
    render(<RouteDetail entry={entry} onUse={vi.fn()} preparationProviders={{ weather }} />);

    const line = screen.getByTestId("route-conditions");
    expect(line).toHaveTextContent(/^Sunny · 72°F at the start$/);
    expect(line).not.toHaveTextContent(/Source|Fresh|Ready/);
  });

  it("states the ride's facts on one line, in the order a rider asks them", () => {
    const onUse = vi.fn().mockResolvedValue(undefined);
    const rideEntry: CatalogEntry = { ...entry, surfaceSummary: "Mostly paved · 2.1 mi gravel", curvatureSummary: "14 mi of curves" };
    render(<RouteDetail entry={rideEntry} onUse={onUse} />);

    // Distance, time, surface and curves on one line under the name, each its
    // own span so the stylesheet draws the separators. No tile ledger, and no
    // "Est." stamp: the catalog's own time is the route's time.
    const facts = screen.getByTestId("route-facts");
    expect([...facts.querySelectorAll(".og-route-detail__fact")].map((fact) => fact.textContent))
      .toEqual(["17 mi", "~30 min at 28 mph", "Mostly paved, 2.1 mi gravel", "14 mi of curves"]);
    expect(facts.closest(".og-route-detail__header")).not.toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Ride this" }));
    return waitFor(() => expect(onUse).toHaveBeenCalledWith(rideEntry));
  });

  it("leaves a fact off the line rather than printing an unknown one", () => {
    // This route has no surface, curvature or ride-time evidence. Unknown is
    // never shown as a value, and saying "unknown" three times under the name
    // is not a fact a rider can use.
    render(<RouteDetail entry={{ ...entry, distanceKm: null }} onUse={vi.fn()} />);
    expect(screen.queryByTestId("route-facts")).toBeNull();
    expect(screen.queryByText(/Surface unknown|Curvature unknown/)).toBeNull();
  });

  it("says how much the ride climbs, drops and tops out, in feet", () => {
    const climbEntry: CatalogEntry = {
      ...entry,
      stats: {
        elevationProfile: [
          { distanceKm: 0, elevationMeters: 300 },
          { distanceKm: 4, elevationMeters: 500 },
          { distanceKm: 9, elevationMeters: 350 },
          { distanceKm: 13, elevationMeters: 400 },
        ],
      },
    };
    render(<RouteDetail entry={climbEntry} onUse={vi.fn()} />);

    const elevation = screen.getByRole("region", { name: "Elevation" });
    // 300 → 500 m climbs 200 m, the drop to 350 m descends 150 m, the rise to
    // 400 m climbs 50 m more, and the high point is 500 m.
    expect(elevation).toHaveTextContent("Climb820 ft");
    expect(elevation).toHaveTextContent("Descent492 ft");
    expect(elevation).toHaveTextContent("Highest point1,640 ft");
    // The profile's storage is not the ride: no count of points.
    expect(elevation).not.toHaveTextContent(/points/i);
  });

  it("says nothing about elevation when the profile cannot say", () => {
    render(<RouteDetail entry={{ ...entry, stats: { elevationProfile: [{ distanceKm: 0, elevationMeters: 300 }] } }} onUse={vi.fn()} />);
    expect(screen.queryByRole("region", { name: "Elevation" })).toBeNull();
    expect(screen.queryByText(/measured points/i)).toBeNull();
  });

  it("offers no map link the planner cannot open (DI-01)", () => {
    // The planner reads no `?route=` query; "Ride this" is the one way onto its map.
    const { container } = render(<RouteDetail entry={entry} onUse={vi.fn()} />);
    expect(container.querySelector('a[href^="/?route="]')).toBeNull();
    expect(screen.queryByRole("link", { name: "View on map" })).toBeNull();
  });

  it("bounds catalog geometry before asking the live traffic endpoint", async () => {
    const geometry = Array.from({ length: 200 }, (_, index) => ({ lon: -75 + index / 10_000, lat: 40 + index / 10_000 }));
    const largeEntry = { ...entry, id: "long-catalog-route", geometry };
    const unavailable: ProviderResult<TrafficData> = {
      state: "unavailable",
      reason: "No live traffic fixture.",
      provenance: "test",
    };
    const refresh = vi.fn(async (context: RoutePreparationContext) => {
      void context;
      return unavailable;
    });
    const traffic: PreparationProviderRegistry["traffic"] = {
      id: "traffic-test",
      kind: "traffic",
      capabilities: () => ({ kind: "traffic", availability: "available", freshness: "time-bound", reason: null, provenance: "test" }),
      getTraffic: () => unavailable,
      refresh,
    };

    render(<RouteDetail entry={largeEntry} onUse={vi.fn()} preparationProviders={{ traffic }} />);
    await waitFor(() => expect(refresh).toHaveBeenCalledOnce());

    const context = refresh.mock.calls[0]?.[0];
    expect(context?.trafficCorridor).toHaveLength(TRAFFIC_CORRIDOR_POINTS);
    expect(context?.trafficCorridor?.[0]).toEqual(geometry[0]);
    expect(context?.trafficCorridor?.at(-1)).toEqual(geometry.at(-1));
  });

  it("shows long-trip considerations for a long fixture and none for a short fixture", () => {
    const longEntry: CatalogEntry = {
      ...entry,
      id: "long-fixture",
      name: "Long-trip fixture",
      distanceKm: 300,
      estimatedTimeMinutes: 360,
      longTripFacts: {
        daylight: {
          sunset: "2026-09-20T15:30:00.000Z",
          source: "NOAA solar calculation",
          sourceRef: "daylight:noaa:fixture",
        },
        weather: {
          state: "ready",
          fetchedAt: "2026-09-20T12:30:00.000Z",
          source: "NWS",
          sourceRef: "weather:nws:fixture",
          maxPrecipChance: 70,
          alerts: [],
        },
        service: {
          status: "gap",
          gapKm: 86,
          summary: "No mapped service point in the next catalog segment.",
          source: "road knowledge",
          sourceRef: "road:fixture:service",
        },
      },
    };

    render(<RouteDetail entry={longEntry} onUse={vi.fn()} />);
    expect(screen.getByRole("group", { name: "Long-trip considerations" })).toBeInTheDocument();
    expect(screen.getByTestId("long-trip-consideration-fuel")).toHaveTextContent("conservative default assumption");
    expect(screen.getByTestId("long-trip-consideration-weather")).toHaveTextContent("70% precipitation chance");
    expect(screen.getByTestId("long-trip-consideration-service")).toHaveTextContent("53 mi gap reported");

    cleanup();
    render(<RouteDetail entry={{ ...longEntry, id: "short-fixture", distanceKm: 27.5, estimatedTimeMinutes: 32.1 }} onUse={vi.fn()} />);
    expect(screen.queryByRole("group", { name: "Long-trip considerations" })).not.toBeInTheDocument();
  });

  it("saves a rating from one star tap, then a comment and a road condition through their server paths", async () => {
    let rated = false;
    const fetcher = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url === "/api/contributions") {
        const contribution = JSON.parse(String(init?.body)) as Record<string, unknown>;
        return Response.json({ id: "contrib_route", contribution, receivedAt: new Date().toISOString() }, { status: 201 });
      }
      if (init?.method === "POST") {
        rated = true;
        return Response.json({ ratingAverage: 4, ratingCount: 1 }, { status: 201 });
      }
      return Response.json(rated
        ? { ratingAverage: 4, ratingCount: 1, comments: [] }
        : { ratingAverage: null, ratingCount: 0, comments: [] });
    });
    vi.stubGlobal("fetch", fetcher);
    window.localStorage.clear();
    render(<RouteCommunity routeId="route-1" />);
    // A ride nobody has rated says so once, not twice ("No ratings yet · 0 ratings").
    const meta = await screen.findByText((_, element) => element?.textContent === "No ratings yet");
    expect(meta).toBeInTheDocument();

    // Five stars, each its own 48px target, saving on the tap itself.
    const stars = screen.getAllByRole("radio");
    expect(stars.map((star) => star.getAttribute("aria-label"))).toEqual(["1 star", "2 stars", "3 stars", "4 stars", "5 stars"]);
    expect(stars.every((star) => !(star as HTMLInputElement).checked)).toBe(true);
    fireEvent.click(screen.getByRole("radio", { name: "4 stars" }));
    expect(await screen.findByText("Thanks. Your rating is saved.")).toBeInTheDocument();
    expect((screen.getByRole("radio", { name: "4 stars" }) as HTMLInputElement).checked).toBe(true);
    expect(await screen.findByText("4.0 out of 5 · 1 rating")).toBeInTheDocument();

    fireEvent.change(screen.getByRole("textbox", { name: "Leave a comment" }), { target: { value: "Fresh gravel at the bridge." } });
    fireEvent.click(screen.getByRole("button", { name: "Post comment" }));
    await screen.findByText("Comment sent for review. It will appear after approval.");
    fireEvent.change(screen.getByRole("combobox", { name: "Report a road condition" }), { target: { value: "closed" } });
    fireEvent.change(screen.getByRole("textbox", { name: "Optional note" }), { target: { value: "Gate at the north entrance." } });
    fireEvent.click(screen.getByRole("button", { name: "Send report" }));
    await screen.findByText("Road condition report sent for review.");

    const posts = fetcher.mock.calls.filter((call) => call[1]?.method === "POST");
    expect(posts.map((call) => String(call[0]))).toEqual([
      "/api/catalog/route-1/community",
      "/api/contributions",
      "/api/contributions",
    ]);
    expect(JSON.parse(String(posts[0]?.[1]?.body))).toMatchObject({ kind: "rating", rating: 4 });
    expect(JSON.parse(String(posts[1]?.[1]?.body))).toMatchObject({ kind: "condition", value: { tag: "comment", severity: "minor", note: "Fresh gravel at the bridge." } });
    expect(JSON.parse(String(posts[2]?.[1]?.body))).toMatchObject({ kind: "condition", value: { tag: "closed", severity: "severe", note: "Gate at the north entrance." } });
    // The privacy behaviour is unchanged (a coarse, route-scoped precision and
    // no coordinates); only the explanatory sentences left the screen.
    for (const post of posts.slice(1)) {
      expect(JSON.parse(String(post[1]?.body))).toMatchObject({ gps_precision_m: 1000 });
      expect(String(post[1]?.body)).not.toContain("lat");
    }
    expect(screen.queryByText(/Posted from this device/)).toBeNull();
    expect(screen.queryByText(/do not request your GPS location/)).toBeNull();
    vi.unstubAllGlobals();
  });

  it("leaves the stars unrated when the server refuses the rating", async () => {
    const fetcher = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      if (init?.method === "POST") return Response.json({ error: { code: "paused" } }, { status: 503 });
      return Response.json({ ratingAverage: null, ratingCount: 0, comments: [] });
    });
    vi.stubGlobal("fetch", fetcher);
    window.localStorage.clear();
    render(<RouteCommunity routeId="route-1" />);
    await screen.findByText("No ratings yet");

    fireEvent.click(screen.getByRole("radio", { name: "2 stars" }));

    expect(await screen.findByText("Your rating could not be saved.")).toBeInTheDocument();
    // A refused rating must not leave the row claiming a star the server never kept.
    expect((screen.getByRole("radio", { name: "2 stars" }) as HTMLInputElement).checked).toBe(false);
    expect(screen.getByText("No ratings yet")).toBeInTheDocument();
    vi.unstubAllGlobals();
  });

  it("shows the server's own refusal for a full review queue instead of blaming the note", async () => {
    const fetcher = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url === "/api/contributions" && init?.method === "POST") {
        return Response.json({
          error: {
            code: "abuse",
            message: "New community notes are paused: the review queue is full.",
            details: { reason: "queue-full" },
          },
        }, { status: 429 });
      }
      if (init?.method === "POST") return Response.json({ ratingAverage: 5, ratingCount: 1 }, { status: 201 });
      return Response.json({ ratingAverage: null, ratingCount: 0, comments: [] });
    });
    vi.stubGlobal("fetch", fetcher);
    window.localStorage.clear();
    render(<RouteCommunity routeId="route-1" />);
    await screen.findByText((_, element) => element?.textContent === "No ratings yet");

    fireEvent.change(screen.getByRole("textbox", { name: "Leave a comment" }), { target: { value: "Bridge is out." } });
    fireEvent.click(screen.getByRole("button", { name: "Post comment" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("New community notes are paused: the review queue is full.");
    vi.unstubAllGlobals();
  });

  it("renders the roads-on-this-ride list and an honest road detail sheet", async () => {
    const roadEntry = {
      ...entry,
      roadSummary: {
        roads: [{
          entityId: asRoadEntityId("road_main"),
          distanceKm: 12.4,
          percentage: 45,
          confidenceBand: "High",
        }],
        totalKm: 27.5,
        matchedKm: 12.4,
        unmatchedKm: 15.1,
        coveragePercent: 45,
        unverifiedRoadCount: 0,
      },
      roadDetails: [{
        entity: {
          id: asRoadEntityId("road_main"),
          name: "Main Street",
          normalizedName: "main st",
          class: "secondary",
          lineage: [],
          firstSeen: "2026-09-17T12:00:00.000Z",
          lastSeen: "2026-09-17T12:00:00.000Z",
          spans: ["span-main"],
          evidenceRefs: ["evidence-main"],
        },
        aliases: ["Main St"],
        summary: {
          entityId: asRoadEntityId("road_main"),
          distanceKm: 12.4,
          percentage: 45,
          confidenceBand: "High",
        },
        evidence: [{
          id: "evidence-main",
          entityId: asRoadEntityId("road_main"),
          source: "recorded-ride",
          observedAt: "2026-09-17T12:00:00.000Z",
          value: "paved-smooth",
          confidence: 0.9,
        }],
        evidenceSummary: {
          entityId: asRoadEntityId("road_main"),
          surfaceValue: "paved-smooth",
          confidence: 0.9,
          confidenceBand: "High",
          conflict: false,
          evidenceCount: 1,
          sourceDiversity: 1,
          latestObservedAt: "2026-09-17T12:00:00.000Z",
          records: [],
        },
        ridesThroughCount: 2,
      }],
    } as CatalogEntry;

    render(<RouteDetail entry={roadEntry} onUse={vi.fn()} />);

    expect(screen.getByRole("heading", { name: "Roads on this ride" })).toBeInTheDocument();
    // How much of the ride is on roads the app knows, in rider words; a road
    // with no surface report is counted only when there is one.
    expect(screen.getByText("7.7 mi on 1 known road")).toBeInTheDocument();
    expect(screen.getByRole("list", { name: "Roads on this ride" })).toBeInTheDocument();
    expect(screen.getByLabelText("Surface likely: paved")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Open Main Street road details" }));
    expect(screen.getByRole("dialog", { name: "Main Street" })).toBeInTheDocument();
    expect(screen.getByText(/Also known as: Main St/)).toBeInTheDocument();
    expect(screen.getByRole("cell", { name: "paved" })).toBeInTheDocument();
    // The rider facts: how much of this ride the road is, and how many rides use
    // it. The road's OSM class and its first/last seen timestamps are not facts
    // a rider can use.
    expect(screen.getByText("On this ride")).toBeInTheDocument();
    expect(screen.getByText("7.7 mi · 45%")).toBeInTheDocument();
    expect(screen.getByText("2 rides")).toBeInTheDocument();
    const sheet = screen.getByRole("dialog", { name: "Main Street" });
    expect(sheet.textContent ?? "").not.toMatch(/first seen|last seen|lineage|Class|2026-09-17T/);
    expect(screen.queryByRole("button", { name: /avoid this road/i })).not.toBeInTheDocument();
  });

  it("keeps a road's earlier identity to one plain line, without ids", () => {
    const lineageEntry = {
      ...entry,
      roadSummary: {
        roads: [{
          entityId: asRoadEntityId("road_old"),
          distanceKm: 12.4,
          percentage: 45,
          confidenceBand: "High",
        }],
        totalKm: 27.5,
        matchedKm: 12.4,
        unmatchedKm: 15.1,
        coveragePercent: 45,
        unverifiedRoadCount: 0,
      },
      roadDetails: [{
        entity: {
          id: asRoadEntityId("road_old"),
          name: "Ridge Road",
          normalizedName: "ridge rd",
          class: "tertiary",
          lineage: [{ parentId: asRoadEntityId("road_entity_01H8Z9W7QK4M2X6V0B3N5C8L"), reason: "renamed" }],
          firstSeen: "2026-09-01T00:00:00.000Z",
          lastSeen: "2026-09-17T00:00:00.000Z",
          spans: ["span-old"],
          evidenceRefs: [],
        },
        aliases: [],
        summary: { entityId: asRoadEntityId("road_old"), distanceKm: 12.4, percentage: 45, confidenceBand: "High" },
        evidence: [],
        evidenceSummary: {
          entityId: asRoadEntityId("road_old"),
          surfaceValue: null,
          confidence: null,
          confidenceBand: "Unverified",
          conflict: false,
          evidenceCount: 0,
          sourceDiversity: 0,
          latestObservedAt: null,
          records: [],
        },
        ridesThroughCount: 1,
      }],
    } as CatalogEntry;

    render(<RouteDetail entry={lineageEntry} onUse={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "Open Ridge Road road details" }));

    // The reconciliation log — the parent road's id and the reconciliation's own
    // reason code — is not rider copy. One plain line, behind a disclosure.
    const sheet = screen.getByRole("dialog", { name: "Ridge Road" });
    expect(sheet.textContent ?? "").not.toMatch(/road_entity_01H8Z9W7QK4M2X6V0B3N5C8L|renamed|Lineage/);
    const history = screen.getByText("Where this road came from").closest("details");
    expect(history).not.toBeNull();
    expect(history).toHaveTextContent("This road has changed since it was first recorded.");
    expect(history?.textContent ?? "").not.toMatch(/road_entity_01H8Z9W7QK4M2X6V0B3N5C8L/);
  });

  it("names a surface report's source and age in rider words, not record keys", () => {
    const roadEntry = {
      ...entry,
      roadSummary: {
        roads: [{
          entityId: asRoadEntityId("road_keyed"),
          distanceKm: 6,
          percentage: 100,
          confidenceBand: "High",
        }],
        totalKm: 6,
        matchedKm: 6,
        unmatchedKm: 0,
        coveragePercent: 100,
        unverifiedRoadCount: 0,
      },
      roadDetails: [{
        entity: {
          id: asRoadEntityId("road_keyed"),
          name: "Keyed Road",
          normalizedName: "keyed rd",
          class: "tertiary",
          lineage: [],
          firstSeen: "2026-09-01T00:00:00.000Z",
          lastSeen: "2026-09-17T00:00:00.000Z",
          spans: ["span-keyed"],
          evidenceRefs: ["evidence-keyed"],
        },
        aliases: [],
        summary: { entityId: asRoadEntityId("road_keyed"), distanceKm: 6, percentage: 100, confidenceBand: "High" },
        evidence: [{
          id: "evidence-keyed",
          entityId: asRoadEntityId("road_keyed"),
          source: "recorded-ride",
          observedAt: new Date(Date.now() - 2 * 86_400_000).toISOString(),
          value: "gravel",
          confidence: 0.9,
        }],
        evidenceSummary: {
          entityId: asRoadEntityId("road_keyed"),
          surfaceValue: "gravel",
          confidence: 0.9,
          confidenceBand: "High",
          conflict: false,
          evidenceCount: 1,
          sourceDiversity: 1,
          latestObservedAt: new Date(Date.now() - 2 * 86_400_000).toISOString(),
          records: [],
        },
        ridesThroughCount: 0,
      }],
    } as CatalogEntry;

    render(<RouteDetail entry={roadEntry} onUse={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "Open Keyed Road road details" }));
    const sheet = screen.getByRole("dialog", { name: "Keyed Road" });
    expect(sheet).toHaveTextContent("Surface reports");
    expect(sheet).toHaveTextContent("Recorded ride");
    expect(sheet).toHaveTextContent("2 days ago");
    expect(sheet.textContent ?? "").not.toMatch(/recorded-ride|Evidence|T00:00:00/);
  });

  it("renders unknown as unknown on a road strip and in the road detail", () => {
    const unknownEntry = {
      ...entry,
      roadSummary: {
        roads: [{
          entityId: asRoadEntityId("road_unknown"),
          distanceKm: 2,
          percentage: 100,
          confidenceBand: "Unverified",
          surfaceValue: "unknown",
          surfaceBand: "unknown",
          surfaceAssessment: aggregateSurface([]),
        }],
        totalKm: 2,
        matchedKm: 2,
        unmatchedKm: 0,
        coveragePercent: 100,
        unverifiedRoadCount: 1,
        surfaceAssessment: aggregateSurface([]),
        surfaceBand: "unknown",
      },
      roadDetails: [{
        entity: {
          id: asRoadEntityId("road_unknown"),
          name: "Unknown Road",
          normalizedName: "unknown rd",
          class: "track",
          lineage: [],
          firstSeen: "2026-09-17T12:00:00.000Z",
          lastSeen: "2026-09-17T12:00:00.000Z",
          spans: ["span-unknown"],
          evidenceRefs: [],
        },
        aliases: [],
        summary: {
          entityId: asRoadEntityId("road_unknown"),
          distanceKm: 2,
          percentage: 100,
          confidenceBand: "Unverified",
          surfaceValue: "unknown",
          surfaceBand: "unknown",
          surfaceAssessment: aggregateSurface([]),
        },
        evidence: [],
        evidenceSummary: {
          entityId: asRoadEntityId("road_unknown"),
          surfaceValue: null,
          confidence: null,
          confidenceBand: "Unverified",
          conflict: false,
          evidenceCount: 0,
          sourceDiversity: 0,
          latestObservedAt: null,
          records: [],
          surfaceAssessment: aggregateSurface([]),
          surfaceBand: "unknown",
        },
        ridesThroughCount: 0,
      }],
    } as CatalogEntry;

    render(<RouteDetail entry={unknownEntry} onUse={vi.fn()} />);
    expect(screen.getAllByText("Surface unknown").length).toBeGreaterThan(0);
    fireEvent.click(screen.getByRole("button", { name: "Open Unknown Road road details" }));
    expect(screen.getByRole("dialog", { name: "Unknown Road" })).toHaveTextContent("Surface unknown");
  });

  it("renders conflicts and provenance rows in the road detail", () => {
    const conflictAssessment = aggregateSurface([
      {
        id: "evidence-paved",
        value: "paved",
        source: "osm",
        sourceLabel: "OpenStreetMap",
        observedAt: "2026-09-17T12:00:00.000Z",
        weight: 0.9,
        confidence: 0.9,
      },
      {
        id: "evidence-dirt",
        value: "dirt",
        source: "rider",
        sourceLabel: "Rider report",
        observedAt: "2026-09-16T12:00:00.000Z",
        weight: 0.8,
        confidence: 0.9,
      },
    ]);
    const conflictEntry = {
      ...entry,
      roadSummary: {
        roads: [{
          entityId: asRoadEntityId("road_conflict"),
          distanceKm: 2,
          percentage: 100,
          confidenceBand: "Low",
          surfaceValue: "unknown",
          surfaceBand: "possible",
          surfaceAssessment: conflictAssessment,
        }],
        totalKm: 2,
        matchedKm: 2,
        unmatchedKm: 0,
        coveragePercent: 100,
        unverifiedRoadCount: 0,
        surfaceAssessment: conflictAssessment,
        surfaceBand: "possible",
      },
      roadDetails: [{
        entity: {
          id: asRoadEntityId("road_conflict"),
          name: "Conflict Road",
          normalizedName: "conflict rd",
          class: "track",
          lineage: [],
          firstSeen: "2026-09-01T12:00:00.000Z",
          lastSeen: "2026-09-17T12:00:00.000Z",
          spans: ["span-conflict"],
          evidenceRefs: ["evidence-paved", "evidence-dirt"],
        },
        aliases: [],
        summary: {
          entityId: asRoadEntityId("road_conflict"),
          distanceKm: 2,
          percentage: 100,
          confidenceBand: "Low",
          surfaceValue: "unknown",
          surfaceBand: "possible",
          surfaceAssessment: conflictAssessment,
        },
        evidence: [],
        evidenceSummary: {
          entityId: asRoadEntityId("road_conflict"),
          surfaceValue: null,
          confidence: 0.2,
          confidenceBand: "Low",
          conflict: true,
          evidenceCount: 2,
          sourceDiversity: 2,
          latestObservedAt: "2026-09-17T12:00:00.000Z",
          records: [],
          surfaceAssessment: conflictAssessment,
          surfaceBand: "possible",
        },
        ridesThroughCount: 1,
      }],
    } as CatalogEntry;

    render(<RouteDetail entry={conflictEntry} onUse={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "Open Conflict Road road details" }));
    const detail = screen.getByRole("dialog", { name: "Conflict Road" });
    expect(detail).toHaveTextContent("Surface possible");
    expect(detail).toHaveTextContent("Surface reports conflict");
    expect(detail).toHaveTextContent("OpenStreetMap");
    expect(detail).toHaveTextContent("Rider report");
    expect(detail).toHaveTextContent("paved");
    expect(detail).toHaveTextContent("dirt");
  });

  it("switches to Roads, renders an honest why-line, and opens the road detail sheet", () => {
    const entity = createRoadEntity({
      name: "Ridge Road",
      class: "tertiary",
      endpoints: [{ lon: -75.5, lat: 40.5 }, { lon: -75.4, lat: 40.6 }],
      firstSeen: "2026-09-01T00:00:00.000Z",
      lastSeen: "2026-09-17T00:00:00.000Z",
    });
    const roads = discoverRoads({
      roads: [{
        entity,
        geometry: [
          { lon: -75.5, lat: 40.5 },
          { lon: -75.46, lat: 40.56 },
          { lon: -75.4, lat: 40.6 },
        ],
        matchedDistanceKm: 8.5,
        matchedRideCount: 2,
        region: "Lehigh Valley",
        evidence: [],
      }],
    });

    render(<ExplorePanel entries={[]} roadCandidates={roads} />);
    fireEvent.click(screen.getByRole("tab", { name: "Ride" }));

    expect(screen.getByRole("heading", { name: "Worth riding" })).toBeInTheDocument();
    expect(screen.getAllByText("Ridge Road").length).toBeGreaterThan(0);
    // The card names where the road is, not the map data's road class.
    expect(screen.getAllByText("Lehigh Valley").length).toBeGreaterThan(0);
    expect(screen.queryByText(/tertiary/)).toBeNull();
    expect(screen.getAllByText(/matched on 2 rides/).length).toBeGreaterThan(0);
    expect(screen.getAllByText("Surface unknown").length).toBeGreaterThan(0);

    fireEvent.click(screen.getAllByRole("button", { name: "Open Ridge Road road details" })[0]!);
    expect(screen.getByRole("dialog", { name: "Ridge Road" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /use in planner/i })).not.toBeInTheDocument();
  });

  it("names a road surface report's source and age without exposing record keys", () => {
    const entity = createRoadEntity({
      name: "Ridge Road",
      class: "tertiary",
      endpoints: [{ lon: -75.5, lat: 40.5 }, { lon: -75.4, lat: 40.6 }],
      firstSeen: "2026-09-01T00:00:00.000Z",
      lastSeen: "2026-09-17T00:00:00.000Z",
    });
    const observedAt = new Date(Date.now() - 5 * 86_400_000).toISOString();
    const roads = discoverRoads({
      roads: [{
        entity,
        geometry: [{ lon: -75.5, lat: 40.5 }, { lon: -75.46, lat: 40.56 }, { lon: -75.4, lat: 40.6 }],
        matchedDistanceKm: 8.5,
        matchedRideCount: 2,
        region: "Lehigh Valley",
        evidence: [{
          id: "evidence-osm",
          entityId: entity.id,
          source: "osm",
          observedAt,
          value: "gravel",
          confidence: 0.8,
        }],
      }],
    });

    render(<ExplorePanel entries={[]} roadCandidates={roads} />);
    fireEvent.click(screen.getByRole("tab", { name: "Ride" }));
    fireEvent.click(screen.getAllByRole("button", { name: "Open Ridge Road road details" })[0]!);

    const sheet = screen.getByRole("dialog", { name: "Ridge Road" });
    // The report's own source name and a date a rider reads, not the record's
    // key (`osm`) and its ISO timestamp.
    expect(sheet).toHaveTextContent("Surface reports");
    expect(sheet).toHaveTextContent("OpenStreetMap");
    expect(sheet).toHaveTextContent("5 days ago");
    expect(sheet.textContent ?? "").not.toMatch(/\bosm\b|evidence-osm|Evidenc|T\d{2}:\d{2}/);
    // The road's map-data class is not one of its rider facts.
    expect(sheet.textContent ?? "").not.toMatch(/Class|tertiary/);
  });

  it("omits the empty road section while keeping the ride list and search available", () => {
    render(<ExplorePanel entries={[]} roadCandidates={[]} />);
    fireEvent.click(screen.getByRole("tab", { name: "Ride" }));

    expect(screen.queryByRole("heading", { name: "Worth riding" })).not.toBeInTheDocument();
    expect(screen.getByRole("searchbox", { name: "Search routes" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /road details/i })).not.toBeInTheDocument();
  });

  it("offers a built-in catalog route only a local hide, never a removal for everyone", () => {
    render(<RouteDetail entry={entry} onUse={vi.fn()} />);

    expect(screen.queryByRole("button", { name: "Remove this route" })).toBeNull();
    expect(screen.queryByText(/until Oct 19/i)).toBeNull();
    expect(screen.getByText(/stays on Explore for everyone/i)).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Hide from my Explore" }));
    expect(screen.getByRole("status")).toHaveTextContent("Hidden on this device.");
    expect(JSON.parse(window.localStorage.getItem("opengravel.explore.hidden-routes") ?? "[]")).toEqual(["route-1"]);
    fireEvent.click(screen.getByRole("button", { name: "Show on my Explore" }));
    expect(screen.queryByRole("status")).toBeNull();
    expect(JSON.parse(window.localStorage.getItem("opengravel.explore.hidden-routes") ?? "[]")).toEqual([]);
  });

  it("lets only the sharing device remove its own shared route, and says so", async () => {
    const ownerToken = "owner-token-for-this-device-0123456789abcdef";
    window.localStorage.setItem("opengravel.community.owner.route-1", ownerToken);
    const fetcher = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      if (init?.method === "POST") return Response.json({ removed: true });
      void input;
      return Response.json({ ratingAverage: null, ratingCount: 0, comments: [] });
    });
    vi.stubGlobal("fetch", fetcher);

    render(<RouteDetail entry={entry} onUse={vi.fn()} />);
    expect(screen.queryByRole("button", { name: "Hide from my Explore" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Remove this route" }));
    expect(screen.getByText(/hides it for everyone on Explore/i)).toBeInTheDocument();
    expect(screen.getByText(/will come off Explore for everyone straight away/i)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Remove for everyone" }));

    expect(await screen.findByText(/Removed from Explore for everyone/)).toBeInTheDocument();
    const posts = fetcher.mock.calls.filter((call) => call[1]?.method === "POST");
    expect(posts).toHaveLength(1);
    expect(JSON.parse(String(posts[0]?.[1]?.body))).toMatchObject({ ownerToken });
  });

  it("leads a card with the ride's own line when this device has no map images", () => {
    // Without a map token the card used to open with the words "Map preview
    // unavailable" in the space where the ride should be. The line the route
    // already carries is the picture: same 16:9 frame, same leading position.
    render(<ExplorePanel entries={[entry]} />);
    const card = screen.getByRole("list", { name: "Explore routes" }).querySelector(".og-explore-card")!;
    const preview = card.firstElementChild?.firstElementChild;
    expect(preview).toHaveClass("og-explore-card__preview");
    expect(preview).toHaveAttribute("data-testid", "route-line-preview");
    expect(preview).toHaveAccessibleName(`${entry.name} route shape`);
    expect(card).not.toHaveTextContent(/Map preview unavailable/);
  });

  it("notes where the rider was standing before opening a ride", () => {
    Object.defineProperty(window, "scrollY", { configurable: true, value: 840 });
    render(<ExplorePanel entries={[entry]} />);
    const link = screen.getByRole("link", { name: new RegExp(entry.name) });
    // The document itself must not follow the link in a jsdom page.
    link.addEventListener("click", (event) => event.preventDefault());
    fireEvent.click(link);
    expect(window.sessionStorage.getItem("opengravel.explore.list-position")).toContain("840");
  });

  it("returns the list to the card the rider came back from, once", async () => {
    rememberListPosition(612);
    const scrollTo = vi.fn();
    vi.stubGlobal("scrollTo", scrollTo);
    render(<ExplorePanel entries={[entry]} />);
    await waitFor(() => expect(scrollTo).toHaveBeenCalledWith(0, 612));

    // The note is spent: the next visit is left where the router put it.
    cleanup();
    scrollTo.mockClear();
    render(<ExplorePanel entries={[entry]} />);
    await new Promise((resolve) => setTimeout(resolve, 60));
    expect(scrollTo).not.toHaveBeenCalled();
  });

  it("reads in the order a rider decides: name, facts, map, Ride this, then the description", () => {
    const rideEntry: CatalogEntry = { ...entry, surfaceSummary: "Mostly paved" };
    render(<RouteDetail entry={rideEntry} onUse={vi.fn()} />);

    const order = (selector: string): Element | null => document.querySelector(selector);
    const name = screen.getByRole("heading", { name: rideEntry.name, level: 1 });
    const facts = screen.getByTestId("route-facts");
    const map = order(".og-route-detail__map");
    const action = screen.getByTestId("ride-this");
    const description = order(".og-route-detail__summary");

    expect(map).not.toBeNull();
    expect(description).not.toBeNull();
    const follows = (first: Element, second: Element | null): boolean =>
      second !== null && (first.compareDocumentPosition(second) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0;
    expect(follows(name, facts)).toBe(true);
    expect(follows(facts, map)).toBe(true);
    expect(follows(map!, action)).toBe(true);
    expect(follows(action, description)).toBe(true);
  });

  it("gives the route page one primary action, with Save and Share as the quiet ones", () => {
    render(<RouteDetail entry={entry} onUse={vi.fn()} onSave={vi.fn()} />);
    const actions = screen.getByRole("region", { name: "Route actions" });
    const buttons = within(actions).getAllByRole("button");

    expect(buttons.map((button) => button.textContent?.trim())).toEqual(["Ride this", "Save", "Share"]);
    expect(actions.querySelectorAll(".og-primary")).toHaveLength(1);
    expect(within(actions).getByRole("button", { name: "Ride this" })).toHaveClass("og-primary");
    // The file for another device is a quieter job, below the ride itself.
    expect(within(actions).queryByRole("button", { name: "Export GPX" })).toBeNull();
    expect(screen.getByRole("button", { name: "Export GPX" })).toBeInTheDocument();
  });

  it("says it is getting the ride ready while the ride is being prepared", async () => {
    let finish: (() => void) | null = null;
    const onUse = vi.fn(() => new Promise<void>((resolve) => { finish = resolve; }));
    render(<RouteDetail entry={entry} onUse={onUse} />);

    fireEvent.click(screen.getByRole("button", { name: "Ride this" }));
    const busy = await screen.findByRole("button", { name: "Getting this ride ready…" });
    expect(busy).toHaveAttribute("aria-busy", "true");
    expect(busy).toBeDisabled();
    // One action, one name at a time: the old label is not still on screen.
    expect(screen.queryByRole("button", { name: "Ride this" })).toBeNull();

    act(() => finish?.());
    await waitFor(() => expect(screen.getByRole("button", { name: "Ride this" })).not.toBeDisabled());
    expect(onUse).toHaveBeenCalledWith(entry);
  });

  it("saves a catalog ride without leaving the page, and offers no save for a ride already in the library", async () => {
    const onSave = vi.fn().mockResolvedValue(undefined);
    render(<RouteDetail entry={entry} onUse={vi.fn()} onSave={onSave} />);
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => expect(onSave).toHaveBeenCalledWith(entry));
    expect(await screen.findByText("Saved to My rides.")).toBeInTheDocument();
    const saved = screen.getByRole("button", { name: "Saved" });
    expect(saved).toHaveAttribute("aria-pressed", "true");
    // A second press is a no-op, never a second copy in the library.
    fireEvent.click(saved);
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(onSave).toHaveBeenCalledTimes(1);

    cleanup();
    render(<RouteDetail entry={{ ...entry, source: "personal" }} onUse={vi.fn()} onSave={vi.fn()} />);
    expect(screen.queryByRole("button", { name: "Save" })).toBeNull();
  });

  it("explains a failed save instead of claiming one", async () => {
    const onSave = vi.fn().mockRejectedValue(new Error("unavailable"));
    render(<RouteDetail entry={entry} onUse={vi.fn()} onSave={onSave} />);
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    expect(await screen.findByText("That action could not be completed.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Save" })).not.toBeDisabled();
    expect(screen.queryByRole("button", { name: "Saved" })).toBeNull();
  });

  it("offers the way forward instead of a bare sentence when Explore has no rides", () => {
    render(<ExplorePanel entries={[]} />);
    expect(screen.getByRole("heading", { name: "No rides here yet" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Plan a ride" })).toHaveAttribute("href", "/");
    expect(screen.queryByText("No catalog routes loaded.")).toBeNull();
  });

  it("says when the filters match nothing and offers the way out", () => {
    const longRide = { ...entry, distanceKm: 100 };
    render(<ExplorePanel entries={[longRide]} />);
    fireEvent.click(screen.getByRole("button", { name: "Length" }));
    fireEvent.change(screen.getByRole("combobox", { name: "Filter by distance" }), { target: { value: "short" } });

    const notice = screen.getByTestId("explore-no-match");
    expect(notice).toHaveTextContent("No routes match these filters.");
    fireEvent.click(screen.getByTestId("explore-clear-filters"));
    expect(screen.queryByTestId("explore-no-match")).toBeNull();
    expect(screen.getByRole("link", { name: new RegExp(entry.name) })).toBeInTheDocument();
  });
});
