import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { MemoryShareRepository } from "@/application/sharing/memory-share-repository";
import { createShareService } from "@/application/sharing/share-commands";
import type { Coordinate, SurfaceIntent } from "@/domain/ride/types";
import { asShareToken, type ShareToken } from "@/domain/sharing/ids";
import { routeDistanceMeters } from "@/domain/sharing/privacy";
import type { ShareSource } from "@/domain/sharing/types";
import { ShareSheet } from "@/ui/sharing/ShareSheet";

/**
 * UI contract for the share sheet (11.1): the privacy preview is byte-exact
 * to what the link exposes, the trim controls ride the one shared privacy
 * implementation, and revoke/re-issue behave honestly.
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

function source(): ShareSource {
  return {
    sourceRevision: 7,
    title: "Pine Loop",
    route: { segments: [ROUTE] },
    summary: { distanceMeters: 2_100, durationSeconds: 6_000 },
    surface: SURFACE,
    provenance: PROVENANCE,
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

async function previewText(): Promise<string> {
  await waitFor(() => {
    const pre = screen.queryByTestId<HTMLPreElement>("share-preview-payload");
    expect(pre?.textContent?.length ?? 0).toBeGreaterThan(0);
  });
  return screen.getByTestId<HTMLPreElement>("share-preview-payload").textContent ?? "";
}

function linkValue(): string {
  return screen.getByTestId<HTMLInputElement>("share-link").value;
}

function tokenOf(link: string): ShareToken {
  const match = /\/share\/([0-9a-f]{64})$/.exec(link);
  expect(match).not.toBeNull();
  return asShareToken((match as RegExpExecArray)[1] as string) as ShareToken;
}

afterEach(cleanup);

describe("ShareSheet — privacy preview", () => {
  it("renders the preview payload as the exact bytes the link exposes", async () => {
    const svc = service();
    render(<ShareSheet service={svc} source={source()} onClose={() => {}} />);
    const bytes = await previewText();

    fireEvent.click(screen.getByTestId("share-publish"));
    await waitFor(() => {
      expect(screen.getByTestId("share-link")).toBeDefined();
    });

    const resolved = await svc.resolve(tokenOf(linkValue()));
    expect(resolved.state).toBe("active");
    if (resolved.state !== "active") throw new Error("unreachable");
    expect(bytes).toBe(resolved.output);
    // Canonical bytes, not a rendering: version first, compact JSON.
    expect(bytes.startsWith('{"version":1,')).toBe(true);
  });

  it("updates the preview when a trim control changes", async () => {
    render(<ShareSheet service={service()} source={source()} onClose={() => {}} />);
    const before = await previewText();

    fireEvent.click(screen.getByRole("checkbox", { name: "Hide the start" }));
    await waitFor(() => {
      expect(screen.getByTestId<HTMLPreElement>("share-preview-payload").textContent).not.toBe(before);
    });

    const after = screen.getByTestId<HTMLPreElement>("share-preview-payload").textContent ?? "";
    const beforeDistance = (JSON.parse(before) as { distanceMeters: number }).distanceMeters;
    const afterDistance = (JSON.parse(after) as { distanceMeters: number }).distanceMeters;
    // Showing the start adds the hidden zone back to the shared geometry.
    expect(afterDistance).toBeGreaterThan(beforeDistance);
  });

  it("starts privacy-first and keeps the name out unless it is added", async () => {
    render(<ShareSheet service={service()} source={source()} onClose={() => {}} />);
    const bytes = await previewText();
    const parsed = JSON.parse(bytes) as { author: unknown; distanceMeters: number };
    expect(parsed.author).toBeNull();
    // The 500 m start and finish zones are hidden by default (§11 defaults).
    const full = routeDistanceMeters({ segments: [ROUTE] });
    expect(parsed.distanceMeters).toBeLessThan(full);

    fireEvent.click(screen.getByRole("checkbox", { name: "Add a name to the shared ride" }));
    fireEvent.change(screen.getByTestId("share-author-name"), {
      target: { value: "Dana" },
    });
    await waitFor(() => {
      const next = screen.getByTestId<HTMLPreElement>("share-preview-payload").textContent ?? "";
      expect(next).toContain("Dana");
    });
  });
});

describe("ShareSheet — link lifecycle", () => {
  it("shows the opaque link and copies it", async () => {
    const clipboard = { writeText: vi.fn().mockResolvedValue(undefined) };
    Object.defineProperty(navigator, "clipboard", { value: clipboard, configurable: true });

    render(<ShareSheet service={service()} source={source()} onClose={() => {}} />);
    await previewText();
    fireEvent.click(screen.getByTestId("share-publish"));
    await waitFor(() => {
      expect(screen.getByTestId("share-link")).toBeDefined();
    });

    const link = linkValue();
    expect(link).toMatch(/^https:\/\/opengravel\.test\/share\/[0-9a-f]{64}$/);

    fireEvent.click(screen.getByTestId("share-copy"));
    await waitFor(() => {
      expect(clipboard.writeText).toHaveBeenCalledWith(link);
    });
    expect(screen.getByTestId("share-copy-status").textContent).toBe("Link copied.");
  });

  it("revokes the link honestly and re-issues only as a new link", async () => {
    const svc = service();
    render(<ShareSheet service={svc} source={source()} onClose={() => {}} />);
    await previewText();
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

    // The revoked link is unusable — and the revoked panel carries no link at all.
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
    render(<ShareSheet service={service()} source={source()} onClose={() => {}} />);
    await previewText();
    fireEvent.click(screen.getByTestId("share-publish"));
    await waitFor(() => {
      expect(screen.getByTestId("share-link")).toBeDefined();
    });
    return linkValue();
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

  it("keeps Copy link as the only action without a share sheet", async () => {
    await publish();
    expect(screen.queryByTestId("share-native")).toBeNull();
    expect(screen.getByTestId("share-copy").className).toBe("og-primary");
  });
});
