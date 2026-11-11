import qrcode from "qrcode-generator";

/**
 * QR codes for "Send to phone": text in, a boolean module matrix out.
 *
 * The matrix is the whole contract. The browser draws it as inline SVG, so the
 * dialog never asks an outside service for an image (and never sends the share
 * link to one). The encoder is `qrcode-generator`, the MIT, dependency-free
 * library the brief names; this module keeps its API out of the UI and makes a
 * QR code a plain value that can be tested without a browser.
 */

export type QrErrorCorrectionLevel = "L" | "M" | "Q" | "H";

export interface QrMatrix {
  /** QR version 1–40: the symbol's size class, `(size - 17) / 4`. */
  readonly version: number;
  /** Modules per side, including the finder patterns. */
  readonly size: number;
  /** Row-major modules; `true` is a dark module. */
  readonly modules: readonly (readonly boolean[])[];
}

export interface QrMatrixOptions {
  /** `M` survives a phone camera on a glossy screen without inflating the code. */
  readonly errorCorrectionLevel?: QrErrorCorrectionLevel;
}

const DEFAULT_ERROR_CORRECTION: QrErrorCorrectionLevel = "M";

/**
 * Encode `text` as a QR matrix. Version 0 lets the library choose the smallest
 * version that fits, which is what keeps a normal share link at a scannable
 * size. Empty text has no useful symbol, so it is refused rather than drawn.
 */
export function qrMatrix(text: string, options: QrMatrixOptions = {}): QrMatrix {
  if (text.length === 0) throw new Error("A QR code needs text to encode.");
  const qr = qrcode(0, options.errorCorrectionLevel ?? DEFAULT_ERROR_CORRECTION);
  qr.addData(text);
  qr.make();
  const size = qr.getModuleCount();
  const modules = Array.from({ length: size }, (_, row) =>
    Object.freeze(Array.from({ length: size }, (_, column) => qr.isDark(row, column))),
  );
  return Object.freeze({
    version: (size - 17) / 4,
    size,
    modules: Object.freeze(modules),
  });
}

/** A single SVG path for every dark module, in module coordinates. */
export function qrPath(matrix: QrMatrix): string {
  const parts: string[] = [];
  matrix.modules.forEach((row, y) => {
    row.forEach((dark, x) => {
      if (dark) parts.push(`M${x} ${y}h1v1h-1z`);
    });
  });
  return parts.join("");
}
