import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { ShareWithEveryone } from "@/ui/explore/RouteCommunityActions";
import { applyPrivacyTrim, defaultPrivacyTrim } from "@/domain/sharing/privacy";

const geometry = Array.from({ length: 20 }, (_, index) => ({ lon: -75 + index * 0.002, lat: 40 + index * 0.002 }));
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

it("publishes only the exact privacy preview after explicit confirmation", async () => {
  const fetcher = vi.fn().mockResolvedValue(Response.json({ id: "community_test" }, { status: 201 }));
  vi.stubGlobal("fetch", fetcher);
  render(<ShareWithEveryone name="My ride" geometry={geometry} />);
  expect(fetcher).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "Share with everyone" }));
  expect(screen.getByRole("checkbox", { name: "Hide the start (500 m)" })).toBeChecked();
  expect(screen.getByRole("checkbox", { name: "Hide the finish (500 m)" })).toBeChecked();
  expect(screen.getByRole("img", { name: "Public route preview" })).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Share it" }));
  await screen.findByText(/Shared with everyone/);
  const body = JSON.parse(fetcher.mock.calls[0]![1].body);
  expect(body).toEqual({ name: "My ride", geometry: applyPrivacyTrim({ segments: [geometry] }, defaultPrivacyTrim()).segments[0]!.map(({ lon, lat }) => [lon, lat]) });
});

it("keeps a rejected share editable and leaves the private ride available", async () => {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json({ error: "Please use a plain name." }, { status: 400 })));
  render(<ShareWithEveryone name="<bad>" geometry={geometry} />);
  fireEvent.click(screen.getByRole("button", { name: "Share with everyone" }));
  fireEvent.change(screen.getByRole("textbox", { name: "Public ride name" }), { target: { value: "A safe ride" } });
  fireEvent.click(screen.getByRole("button", { name: "Share it" }));
  expect(await screen.findByRole("alert")).toHaveTextContent("Please use a plain name.");
  await waitFor(() => expect(screen.getByRole("button", { name: "Share it" })).toBeEnabled());
});

it("blocks publication if privacy settings remove the entire route", () => {
  render(<ShareWithEveryone name="Short ride" geometry={[{ lon: 0, lat: 0 }, { lon: 0.001, lat: 0.001 }]} />);
  fireEvent.click(screen.getByRole("button", { name: "Share with everyone" }));
  expect(screen.getByRole("button", { name: "Share it" })).toBeDisabled();
  expect(screen.getByRole("alert")).toHaveTextContent(/trim|short/i);
});

it("lets the rider trim more from home and add public notes before publishing", async () => {
  const fetcher = vi.fn().mockResolvedValue(Response.json({ id: "community_test" }, { status: 201 }));
  vi.stubGlobal("fetch", fetcher);
  render(<ShareWithEveryone name="Ride" geometry={geometry} />);
  fireEvent.click(screen.getByRole("button", { name: "Share with everyone" }));
  fireEvent.change(screen.getByRole("spinbutton", { name: "Extra distance to remove from each end (meters)" }), { target: { value: "750" } });
  fireEvent.change(screen.getByRole("textbox", { name: "Ride notes (optional)" }), { target: { value: "Fuel at the village." } });
  fireEvent.click(screen.getByRole("button", { name: "Share it" }));
  await screen.findByText(/Shared with everyone/);
  const body = JSON.parse(fetcher.mock.calls[0]![1].body);
  expect(body.description).toBe("Fuel at the village.");
  expect(body.geometry).toEqual(applyPrivacyTrim({ segments: [geometry] }, { ...defaultPrivacyTrim(), trimMetersFromEnds: 750 }).segments[0]!.map(({ lon, lat }) => [lon, lat]));
});
