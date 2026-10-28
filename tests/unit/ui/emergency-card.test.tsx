/**
 * The emergency card (HIKE-MODE-PLAN H4 §19): the three coordinate notations,
 * a copy button per notation, the dialler link, the share path that falls back
 * to the clipboard, and the honest "unknown" states that make it trustworthy.
 */

import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { EmergencyCard, type EmergencyCardProps } from "@/ui/safety/EmergencyCard";
import type { RoadLine } from "@/domain/geometry/nearest-road";
import type { Coordinate } from "@/domain/ride/types";

const MONUMENT: Coordinate = { lat: 38.8895, lon: -77.0353 };

const METRES_PER_DEGREE_LAT = 111_320;
const METRES_PER_DEGREE_LON =
  METRES_PER_DEGREE_LAT * Math.cos((MONUMENT.lat * Math.PI) / 180);
const at = (east: number, north: number): Coordinate => ({
  lon: MONUMENT.lon + east / METRES_PER_DEGREE_LON,
  lat: MONUMENT.lat + north / METRES_PER_DEGREE_LAT,
});

const RIDGE_ROAD: RoadLine = { id: "curvy:ridge", name: "Ridge Road", line: [at(-400, 100), at(400, 100)] };

function renderCard(overrides: Partial<EmergencyCardProps> = {}) {
  const onClose = vi.fn();
  const view = render(
    <EmergencyCard coordinate={MONUMENT} roads={[RIDGE_ROAD]} roadsLoaded onClose={onClose} {...overrides} />,
  );
  return { ...view, onClose };
}

/** A clipboard the test can inspect, since jsdom ships none. */
function stubClipboard(): { readonly writeText: ReturnType<typeof vi.fn> } {
  const writeText = vi.fn(async () => undefined);
  Object.defineProperty(navigator, "clipboard", {
    configurable: true,
    value: { writeText },
  });
  return { writeText };
}

afterEach(() => {
  cleanup();
  Reflect.deleteProperty(navigator, "clipboard");
  Reflect.deleteProperty(navigator, "share");
});

describe("EmergencyCard — position", () => {
  it("prints the position in decimal, DMS and USNG", () => {
    renderCard();
    expect(screen.getByRole("dialog")).toHaveAttribute("aria-modal", "true");
    expect(screen.getByTestId("emergency-decimal")).toHaveTextContent("38.88950, -77.03530");
    expect(screen.getByTestId("emergency-dms")).toHaveTextContent("38°53′22.2″ N, 77°02′07.1″ W");
    expect(screen.getByTestId("emergency-usng")).toHaveTextContent("18S UJ 23478 06483");
  });

  it("shows altitude and accuracy when the device reported them", () => {
    renderCard({ altitudeMeters: 30.5, accuracyMeters: 8 });
    expect(screen.getByTestId("emergency-altitude")).toHaveTextContent("100 ft");
    expect(screen.getByTestId("emergency-accuracy")).toHaveTextContent("±8 m");
  });

  it("says unknown instead of inventing an altitude or an accuracy", () => {
    renderCard({ altitudeMeters: null, accuracyMeters: null });
    expect(screen.getByTestId("emergency-altitude")).toHaveTextContent("Unknown");
    expect(screen.getByTestId("emergency-altitude")).toHaveAttribute("data-known", "false");
    expect(screen.getByTestId("emergency-accuracy")).toHaveTextContent("Unknown");
  });

  it("gives the nearest road with distance and direction from loaded features", () => {
    renderCard();
    const road = screen.getByTestId("emergency-road");
    expect(road).toHaveTextContent("Ridge Road");
    expect(road).toHaveTextContent("330 ft north");
    expect(road).toHaveAttribute("data-known", "true");
  });

  it("says why a nearest road is unavailable, keeping unknown and none apart", () => {
    renderCard({ roads: undefined, roadRequest: undefined });
    expect(screen.getByTestId("emergency-road")).toHaveTextContent("Unknown");
    expect(screen.getByTestId("emergency-road")).toHaveTextContent("No road data available here");
    cleanup();
    renderCard({ roads: [] });
    expect(screen.getByTestId("emergency-road")).toHaveTextContent("No mapped road in range");
  });

  it("asks its surface for roads when it holds none, and shows the answer", async () => {
    const roadRequest = vi.fn(async () => ({ roads: [RIDGE_ROAD], loaded: true }));
    renderCard({ roads: undefined, roadRequest });
    await waitFor(() => expect(screen.getByTestId("emergency-road")).toHaveTextContent("Ridge Road"));
    expect(roadRequest).toHaveBeenCalledTimes(1);
  });

  it("treats a failed road read as unknown, not as an empty map", async () => {
    const roadRequest = vi.fn(async () => {
      throw new Error("offline");
    });
    renderCard({ roads: undefined, roadRequest });
    await waitFor(() =>
      expect(screen.getByTestId("emergency-road")).toHaveTextContent("No road data available here"),
    );
  });

  it("fills in the position when the fix arrives after the card opened", () => {
    const onClose = vi.fn();
    const view = render(<EmergencyCard coordinate={null} onClose={onClose} />);
    expect(screen.getByTestId("emergency-no-fix")).toBeInTheDocument();
    view.rerender(<EmergencyCard coordinate={MONUMENT} onClose={onClose} />);
    expect(screen.queryByTestId("emergency-no-fix")).toBeNull();
    expect(screen.getByTestId("emergency-decimal")).toHaveTextContent("38.88950, -77.03530");
  });

  it("asks for roads once, not once per GPS fix", async () => {
    const roadRequest = vi.fn(async () => ({ roads: [RIDGE_ROAD], loaded: true }));
    const onClose = vi.fn();
    const view = render(
      <EmergencyCard coordinate={MONUMENT} roads={undefined} roadRequest={roadRequest} onClose={onClose} />,
    );
    await waitFor(() => expect(roadRequest).toHaveBeenCalledTimes(1));
    view.rerender(
      <EmergencyCard
        coordinate={{ lat: MONUMENT.lat + 0.002, lon: MONUMENT.lon }}
        roads={undefined}
        roadRequest={roadRequest}
        onClose={onClose}
      />,
    );
    expect(screen.getByTestId("emergency-decimal")).toHaveTextContent("38.89150, -77.03530");
    await waitFor(() => expect(roadRequest).toHaveBeenCalledTimes(1));
  });

  it("shows a no-fix state, keeps 911, and disables sharing without a position", () => {
    renderCard({ coordinate: null, roads: undefined });
    expect(screen.getByTestId("emergency-no-fix")).toHaveTextContent("No GPS fix yet");
    expect(screen.queryByTestId("emergency-decimal")).toBeNull();
    expect(screen.getByTestId("emergency-call")).toHaveAttribute("href", "tel:911");
    expect(screen.getByTestId("emergency-share")).toBeDisabled();
  });
});

describe("EmergencyCard — copy and share", () => {
  it("copies each notation separately, with a name that says which", async () => {
    const { writeText } = stubClipboard();
    renderCard();
    fireEvent.click(screen.getByRole("button", { name: "Copy USNG / MGRS" }));
    await waitFor(() => expect(writeText).toHaveBeenCalledWith("18S UJ 23478 06483"));
    expect(screen.getByTestId("emergency-status")).toHaveTextContent("USNG / MGRS copied.");
    fireEvent.click(screen.getByRole("button", { name: "Copy Decimal degrees" }));
    await waitFor(() => expect(writeText).toHaveBeenLastCalledWith("38.88950, -77.03530"));
  });

  it("says plainly when the clipboard is unavailable", async () => {
    renderCard();
    fireEvent.click(screen.getByRole("button", { name: "Copy Decimal degrees" }));
    await waitFor(() =>
      expect(screen.getByTestId("emergency-status")).toHaveTextContent("Couldn't copy"),
    );
  });

  it("shares the whole block through the system share sheet", async () => {
    const share = vi.fn(async () => undefined);
    Object.defineProperty(navigator, "share", { configurable: true, value: share });
    renderCard({ altitudeMeters: 30.5 });
    fireEvent.click(screen.getByTestId("emergency-share"));
    await waitFor(() => expect(share).toHaveBeenCalledTimes(1));
    const payload = (share.mock.calls as unknown as [[{ title: string; text: string }]])[0][0];
    expect(payload.title).toBe("My location");
    expect(payload.text).toContain("38.88950, -77.03530");
    expect(payload.text).toContain("18S UJ 23478 06483");
    expect(payload.text).toContain("Nearest road: Ridge Road — 330 ft north");
    expect(screen.getByTestId("emergency-status")).toHaveTextContent("Location shared.");
  });

  it("falls back to the clipboard when the device has no share sheet", async () => {
    const { writeText } = stubClipboard();
    renderCard();
    fireEvent.click(screen.getByTestId("emergency-share"));
    await waitFor(() => expect(writeText).toHaveBeenCalledTimes(1));
    expect(String(writeText.mock.calls[0]?.[0])).toContain("OpenGravel emergency location");
    expect(screen.getByTestId("emergency-status")).toHaveTextContent("Location copied.");
  });

  it("treats a cancelled share as no event, not as a failure", async () => {
    Object.defineProperty(navigator, "share", {
      configurable: true,
      value: vi.fn(async () => {
        throw new DOMException("The user aborted a request.", "AbortError");
      }),
    });
    renderCard();
    fireEvent.click(screen.getByTestId("emergency-share"));
    await waitFor(() => expect(screen.getByTestId("emergency-status")).toHaveTextContent(""));
  });
});

describe("EmergencyCard — access", () => {
  it("puts focus on the close control and closes on Escape", () => {
    const { onClose } = renderCard();
    const close = screen.getByTestId("emergency-close");
    expect(document.activeElement).toBe(close);
    expect(close).toHaveAccessibleName("Close");
    fireEvent.keyDown(document, { key: "Escape" });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("closes from its own close control", () => {
    const { onClose } = renderCard();
    fireEvent.click(screen.getByTestId("emergency-close"));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("uses the pressed-point title and note when the map opens it", () => {
    renderCard({ title: "Where is this point?", note: "The point you pressed on the map." });
    expect(screen.getByRole("heading", { name: "Where is this point?" })).toBeInTheDocument();
    expect(screen.getByText("The point you pressed on the map.")).toBeInTheDocument();
  });
});
