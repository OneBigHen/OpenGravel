import { describe, expect, it } from "vitest";

import { qrMatrix, qrPath } from "@/application/sharing/qr";

/**
 * The QR helper is the "Send to phone" dialog's picture of the link.
 *
 * Three facts matter: a known string lands on a known version and size (so a
 * later encoder change cannot silently make every code bigger), the symbol has
 * its three finder patterns (so it is a QR code and not a random grid), and the
 * matrix is square and boolean (so the browser can draw it directly).
 */

function hasFinderPattern(
  modules: readonly (readonly boolean[])[],
  top: number,
  left: number,
): boolean {
  /* The 7x7 finder: a dark border, a light ring, then a 3x3 dark centre. */
  const expected = [
    "1111111",
    "1000001",
    "1011101",
    "1011101",
    "1011101",
    "1000001",
    "1111111",
  ];
  return expected.every((row, y) =>
    [...row].every((dark, x) => modules[top + y]?.[left + x] === (dark === "1")),
  );
}

describe("qrMatrix", () => {
  it("encodes a known string at the expected version and size", () => {
    const matrix = qrMatrix("HELLO WORLD");

    expect(matrix.version).toBe(1);
    expect(matrix.size).toBe(21);
    expect(matrix.modules).toHaveLength(21);
    expect(matrix.modules.every((row) => row.length === 21)).toBe(true);
  });

  it("keeps a normal share link within a scannable version", () => {
    const matrix = qrMatrix(
      `https://opengravel.test/share/${"a".repeat(64)}`,
    );

    expect(matrix.version).toBe(6);
    expect(matrix.size).toBe(41);
  });

  it("draws the three finder patterns", () => {
    const matrix = qrMatrix("https://opengravel.test/share/example");
    const { size } = matrix;

    expect(hasFinderPattern(matrix.modules, 0, 0)).toBe(true);
    expect(hasFinderPattern(matrix.modules, 0, size - 7)).toBe(true);
    expect(hasFinderPattern(matrix.modules, size - 7, 0)).toBe(true);
  });

  it("returns a square boolean matrix and a matching SVG path", () => {
    const matrix = qrMatrix("HELLO WORLD");
    const darkModules = matrix.modules.flat().filter(Boolean).length;
    const path = qrPath(matrix);

    expect(matrix.modules.every((row) => row.every((value) => typeof value === "boolean"))).toBe(true);
    expect(path.match(/M/g)).toHaveLength(darkModules);
  });

  it("refuses empty text rather than drawing an empty symbol", () => {
    expect(() => qrMatrix("")).toThrow(/needs text/);
  });
});
