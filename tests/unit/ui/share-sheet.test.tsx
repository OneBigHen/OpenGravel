import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { MemoryShareRepository } from "../../helpers/memory-share-repository";
import { createShareService } from "@/application/sharing/share-commands";
import type { Coordinate, SurfaceIntent } from "@/domain/ride/types";
import { asShareToken, type ShareToken } from "@/domain/sharing/ids";
import { defaultPrivacyTrim, routeDistanceMeters } from "@/domain/sharing/privacy";
import {
  buildShareSnapshot,
  serializeShareSnapshot,
} from "@/domain/sharing/snapshot";
import type { ShareSnapshot, ShareSource } from "@/domain/sharing/types";
import { ShareSheet } from "@/ui/sharing/ShareSheet";

/**
 * UI contract for the share sheet (R3-3).
 *
 * The sheet is one small solid surface: the ride's own name, one green Create
 * link, and the privacy options behind one closed line. There is no JSON and no
 * error before the rider asks for one. Every privacy behaviour is still the one
 * shared domain implementation, so it is checked at the link it produces: the
 * bytes a holder resolves are exactly the snapshot the trim produced.
 */

const ROUTE: readonly Coordinate[] = Array.from({ length: 31 }, (_, index) => ({
  lon: -75.43,
  lat: 40.13 + index * 0.001,
}));

const SURFACE: SurfaceIntent = {
  preference: "mostly-pavement",
  unknownSurfacePolicy: "avoid-when-possible",
};

const PROVENANCE = "import" as const;

function source(overrides: Partial<ShareSource> = {}): ShareSource {
  return {
    sourceRevision: 7,
    title: "Pine Loop",
    route: { segments: [ROUTE] },
    summary: { distanceMeters: 2_100, durationSeconds: 6_000 },
    surface: SURFACE,
    provenance: PROVENANCE,
    authorPseudonym: null,
    ...overrides,
  };
}

function service() {
  return createShareService({
    repository: new MemoryShareRepository(),
    linkBase: "https://opengravel.test",
    now: () => "2026-01-01T10:00:00.000Z",
  });
}

/** The preview runs before the button enables; the button is the readiness signal. */
async function readyToCreate(): Promise<void> {
  await waitFor(() => expect(screen.getByTestId("share-publish")).toBeEnabled());
}

function linkValue(): string {
  return screen.getByTestId<HTMLInputElement>("share-link").value;
}

function tokenOf(link: string): ShareToken {
  const match = /\/share\/([0-9a-f]{64})$/.exec(link);
  expect(match).not.toBeNull();
  return asShareToken((match as RegExpExecArray)[1] as string) as ShareToken;
}

/** Create the link, then read the exact bytes a holder of it resolves. */
async function publishedLink(
  svc = service(),
  overrides: Partial<ShareSource> = {},
): Promise<{ link: string; snapshot: ShareSnapshot }> {
  render(<ShareSheet service={svc} source={source(overrides)} onClose={() => {}} />);
  await readyToCreate();
  fireEvent.click(screen.getByTestId("share-publish"));
  await waitFor(() => expect(screen.getByTestId("share-link")).toBeDefined());
  const link = linkValue();
  const resolved = await svc.resolve(tokenOf(link));
  if (resolved.state !== "active") throw new Error("the new link is not active");
  return { link, snapshot: JSON.parse(resolved.output) as ShareSnapshot };
}

afterEach(cleanup);

describe("ShareSheet — the small sheet", () => {
  it("opens on the ride's name and one Create link, with no error yet", async () => {
    render(<ShareSheet service={service()} source={source()} onClose={() => {}} />);

    expect(screen.getByTestId<HTMLInputElement>("share-title").value).toBe("Pine Loop");
    expect(screen.queryByRole("alert")).toBeNull();
    expect(screen.queryByText(/needs a title/i)).toBeNull();
    expect(screen.queryByText(/version/i)).toBeNull();
    expect(screen.queryByText(/meters/i)).toBeNull();

    await readyToCreate();
    expect(screen.getByTestId("share-publish").textContent).toBe("Create link");
  });

  it("says what is hidden in one closed line, in plain words", () => {
    render(<ShareSheet service={service()} source={source()} onClose={() => {}} />);

    const line = screen.getByText(/^Privacy:/);
    expect(line.textContent).toBe("Privacy: start and finish hidden");
    expect(line.closest("details")?.open).toBe(false);
    // The real controls are behind that line.
    expect(screen.getByRole("checkbox", { name: "Hide the start" })).toBeChecked();
    expect(screen.getByRole("checkbox", { name: "Hide the finish" })).toBeChecked();
    // The trim is the rider's unit, and never metres.
    expect(screen.getByText("Trim from both ends (miles)")).toBeInTheDocument();
    expect(screen.getByTestId("share-trim-miles")).toBeInTheDocument();
    expect(screen.queryByText(/trim.*meters/i)).toBeNull();
  });

  it("fills an honest name from the ride when the draft has none", async () => {
    render(<ShareSheet service={service()} source={source({ title: "" })} onClose={() => {}} />);
    expect(screen.getByTestId<HTMLInputElement>("share-title").value).toBe("My ride, 1.3 mi");
    await readyToCreate();
  });

  it("offers Download GPX beside the link", () => {
    render(<ShareSheet service={service()} source={source()} onClose={() => {}} />);
    expect(screen.getByTestId("share-download-gpx")).toBeInTheDocument();
  });

  it("waits for the rider to ask before showing a missing-name error", async () => {
    render(<ShareSheet service={service()} source={source({ title: "" })} onClose={() => {}} />);
    fireEvent.change(screen.getByTestId("share-title"), { target: { value: "" } });
    expect(screen.queryByRole("alert")).toBeNull();

    fireEvent.click(screen.getByTestId("share-publish"));
    await waitFor(() => expect(screen.getByRole("alert").textContent).toContain("name"));
    expect(screen.queryByTestId("share-link")).toBeNull();
  });
});

describe("ShareSheet — the privacy the link carries", () => {
  it("publishes exactly the snapshot the one shared privacy implementation made", async () => {
    const { snapshot } = await publishedLink();
    const expected = buildShareSnapshot(source(), defaultPrivacyTrim());

    expect(snapshot).toEqual(JSON.parse(serializeShareSnapshot(expected)));
    // The start and finish zones are hidden by default (§11 defaults).
    expect(snapshot.distanceMeters).toBeLessThan(routeDistanceMeters({ segments: [ROUTE] }));
    expect(snapshot.author).toBeNull();
  });

  it("changes what the link holds when a control changes", async () => {
    const first = await publishedLink();
    cleanup();

    const svc = service();
    render(<ShareSheet service={svc} source={source()} onClose={() => {}} />);
    fireEvent.click(screen.getByRole("checkbox", { name: "Hide the start" }));
    await readyToCreate();
    fireEvent.click(screen.getByTestId("share-publish"));
    await waitFor(() => expect(screen.getByTestId("share-link")).toBeDefined());
    const resolved = await svc.resolve(tokenOf(linkValue()));
    if (resolved.state !== "active") throw new Error("the new link is not active");
    const second = JSON.parse(resolved.output) as ShareSnapshot;

    // Showing the start adds the hidden zone back to the shared geometry.
    expect(second.distanceMeters).toBeGreaterThan(first.snapshot.distanceMeters);
  });

  it("never publishes bytes prepared before a privacy change", async () => {
    const svc = service();
    const dispatch = svc.dispatch.bind(svc);
    let release: (() => void) | null = null;
    let holdNext = false;
    svc.dispatch = async (command) => {
      if (command.type === "share.apply-trim" && holdNext) {
        await new Promise<void>((resolve) => { release = resolve; });
      }
      return dispatch(command);
    };

    render(<ShareSheet service={svc} source={source()} onClose={() => {}} />);
    await readyToCreate();
    // The rider changes the privacy while the new bytes are still being made.
    holdNext = true;
    fireEvent.click(screen.getByRole("checkbox", { name: "Hide the start" }));
    await waitFor(() => expect((screen.getByTestId("share-publish") as HTMLButtonElement).disabled).toBe(true));

    await waitFor(() => expect(release).not.toBeNull());
    release!();
    await waitFor(() => expect((screen.getByTestId("share-publish") as HTMLButtonElement).disabled).toBe(false));

    fireEvent.click(screen.getByTestId("share-publish"));
    await waitFor(() => expect(screen.getByTestId("share-link")).toBeDefined());
    const resolved = await svc.resolve(tokenOf(linkValue()));
    if (resolved.state !== "active") throw new Error("the new link is not active");
    const published = JSON.parse(resolved.output) as ShareSnapshot;
    // The link carries the control the rider just changed, not the earlier one:
    // only the finish is hidden now, so the line is about 500 m longer.
    const full = routeDistanceMeters({ segments: [ROUTE] });
    expect(published.distanceMeters).toBeGreaterThan(full - 750);
    expect(published.distanceMeters).toBeLessThanOrEqual(full);
  });

  it("reads the trim in miles, not metres", async () => {
    // A long enough line that a mile off each end still leaves a ride.
    const longRoute = Array.from({ length: 121 }, (_, index) => ({
      lon: -75.43,
      lat: 40.13 + index * 0.001,
    }));
    const plain = await publishedLink(service(), { route: { segments: [longRoute] } });
    cleanup();

    const svc = service();
    render(
      <ShareSheet
        service={svc}
        source={source({ route: { segments: [longRoute] } })}
        onClose={() => {}}
      />,
    );
    fireEvent.change(screen.getByTestId("share-trim-miles"), { target: { value: "1" } });
    await readyToCreate();
    fireEvent.click(screen.getByTestId("share-publish"));
    await waitFor(() => expect(screen.getByTestId("share-link")).toBeDefined());
    const resolved = await svc.resolve(tokenOf(linkValue()));
    if (resolved.state !== "active") throw new Error("the new link is not active");
    const trimmed = JSON.parse(resolved.output) as ShareSnapshot;

    // One mile from each end is 1.609 km each, not 1 m each.
    expect(plain.snapshot.distanceMeters - trimmed.distanceMeters).toBeGreaterThan(3_000);
    expect(plain.snapshot.distanceMeters - trimmed.distanceMeters).toBeLessThan(3_400);
  });

  it("keeps the name out unless the rider adds it", async () => {
    const svc = service();
    render(<ShareSheet service={svc} source={source()} onClose={() => {}} />);
    fireEvent.click(screen.getByRole("checkbox", { name: "Put my name on the link" }));
    fireEvent.change(screen.getByTestId("share-author-name"), { target: { value: "Dana" } });
    await readyToCreate();
    fireEvent.click(screen.getByTestId("share-publish"));
    await waitFor(() => expect(screen.getByTestId("share-link")).toBeDefined());

    const resolved = await svc.resolve(tokenOf(linkValue()));
    if (resolved.state !== "active") throw new Error("the new link is not active");
    const snapshot = JSON.parse(resolved.output) as ShareSnapshot;
    expect(snapshot.author?.pseudonym).toBe("Dana");
  });
});

describe("ShareSheet — link lifecycle", () => {
  it("reports a failed publication without claiming that a link exists", async () => {
    const svc = service();
    const dispatch = svc.dispatch.bind(svc);
    svc.dispatch = command => command.type === "share.publish"
      ? Promise.reject(new Error("Sharing is unavailable. Try again when online."))
      : dispatch(command);
    render(<ShareSheet service={svc} source={source()} onClose={() => {}} />);
    await readyToCreate();
    fireEvent.click(screen.getByTestId("share-publish"));
    await waitFor(() => expect(screen.getByRole("alert").textContent).toContain("Try again when online"));
    expect(screen.queryByTestId("share-link")).toBeNull();
    expect((screen.getByTestId("share-publish") as HTMLButtonElement).disabled).toBe(false);
  });

  it("shows the opaque link and copies it", async () => {
    const clipboard = { writeText: vi.fn().mockResolvedValue(undefined) };
    Object.defineProperty(navigator, "clipboard", { value: clipboard, configurable: true });

    await publishedLink();
    const link = linkValue();
    expect(link).toMatch(/^https:\/\/opengravel\.test\/share\/[0-9a-f]{64}$/);

    fireEvent.click(screen.getByTestId("share-copy"));
    await waitFor(() => {
      expect(clipboard.writeText).toHaveBeenCalledWith(link);
    });
    expect(screen.getByTestId("share-copy-status").textContent).toBe("Link copied.");
  });

  it("removes the link honestly and re-issues only as a new link", async () => {
    const svc = service();
    render(<ShareSheet service={svc} source={source()} onClose={() => {}} />);
    await readyToCreate();
    fireEvent.click(screen.getByTestId("share-publish"));
    await waitFor(() => {
      expect(screen.getByTestId("share-link")).toBeDefined();
    });
    const firstLink = linkValue();
    const firstToken = tokenOf(firstLink);

    fireEvent.click(screen.getByTestId("share-revoke"));
    await waitFor(() => {
      expect(screen.getByTestId("share-revoked")).toBeDefined();
    });

    // The removed link is unusable — and the removed panel carries no link at all.
    expect(screen.queryByTestId("share-link")).toBeNull();
    const resolution = await svc.resolve(firstToken);
    expect(resolution.state).toBe("revoked");

    fireEvent.click(screen.getByTestId("share-reissue"));
    await waitFor(() => {
      expect(screen.getByTestId("share-link")).toBeDefined();
    });
    const secondLink = linkValue();
    expect(secondLink).not.toBe(firstLink);
    // Old stays dead, new works: re-issue is the only way back.
    expect((await svc.resolve(firstToken)).state).toBe("revoked");
    expect((await svc.resolve(tokenOf(secondLink))).state).toBe("active");
  });
});

describe("ShareSheet — the phone's share sheet (IO-01)", () => {
  afterEach(() => {
    Reflect.deleteProperty(navigator, "share");
  });

  async function publish(): Promise<string> {
    const { link } = await publishedLink();
    return link;
  }

  it("offers Share… first where the browser has a share sheet", async () => {
    const share = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "share", { value: share, configurable: true });

    const link = await publish();
    fireEvent.click(screen.getByTestId("share-native"));
    await waitFor(() => {
      expect(share).toHaveBeenCalledWith({ title: "Pine Loop", text: "Pine Loop", url: link });
    });
    expect(screen.getByTestId("share-copy-status").textContent).toBe("Link shared.");
    expect(screen.getByTestId("share-copy").className).toBe("og-secondary");
  });

  it("says nothing when the rider dismisses the share sheet", async () => {
    const share = vi.fn().mockRejectedValue(new DOMException("dismissed", "AbortError"));
    Object.defineProperty(navigator, "share", { value: share, configurable: true });

    await publish();
    fireEvent.click(screen.getByTestId("share-native"));
    await waitFor(() => {
      expect(share).toHaveBeenCalled();
    });
    expect(screen.getByTestId("share-copy-status").textContent).toBe("");
  });

  it("keeps Copy as the only action without a share sheet", async () => {
    await publish();
    expect(screen.queryByTestId("share-native")).toBeNull();
    expect(screen.getByTestId("share-copy").className).toBe("og-primary");
  });
});

describe("ShareSheet — the size a link can carry", () => {
  /** A long imported track: the shape that used to fail only after review. */
  function longSource(): ShareSource {
    return {
      ...source(),
      title: "Long imported track",
      route: {
        segments: [Array.from({ length: 10_000 }, (_, index) => ({
          lon: -75.43 + index * 0.00001,
          lat: 40.13 + index * 0.00002,
        }))],
      },
    };
  }

  it("refuses a route the publish endpoint would reject, with a specific reason", async () => {
    render(<ShareSheet service={service()} source={longSource()} onClose={() => {}} />);

    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toMatch(/too many points/i);
    expect(alert.textContent).toMatch(/shorter/i);
    expect((screen.getByTestId("share-publish") as HTMLButtonElement).disabled).toBe(true);
    // No payload is mounted in the dialog either.
    expect(screen.queryByText('{"version"')).toBeNull();
  });

  it("still publishes a route inside the budget", async () => {
    const { link } = await publishedLink();
    expect(link).toMatch(/\/share\/[0-9a-f]{64}$/);
  });
});
