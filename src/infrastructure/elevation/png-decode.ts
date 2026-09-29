/**
 * A minimal PNG decoder for elevation tiles (server only).
 *
 * Terrarium DEM tiles are 8-bit, non-interlaced RGB or RGBA. That is all this
 * decodes; anything else is refused rather than half-read, and the caller then
 * answers "elevation unavailable" instead of a wrong height.
 */

import { inflateSync } from "node:zlib";

export interface DecodedPng {
  readonly width: number;
  readonly height: number;
  /** Bytes per pixel: 3 (RGB) or 4 (RGBA). */
  readonly channels: 3 | 4;
  readonly data: Uint8Array;
}

const SIGNATURE = [137, 80, 78, 71, 13, 10, 26, 10];

function paeth(a: number, b: number, c: number): number {
  const p = a + b - c;
  const pa = Math.abs(p - a);
  const pb = Math.abs(p - b);
  const pc = Math.abs(p - c);
  if (pa <= pb && pa <= pc) return a;
  return pb <= pc ? b : c;
}

export function decodePng(bytes: Uint8Array): DecodedPng {
  if (bytes.length < 8 || SIGNATURE.some((value, index) => bytes[index] !== value)) {
    throw new Error("not a PNG");
  }
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let offset = 8;
  let width = 0;
  let height = 0;
  let channels: 3 | 4 = 3;
  const idat: Uint8Array[] = [];
  while (offset + 8 <= bytes.length) {
    const length = view.getUint32(offset);
    const type = String.fromCharCode(...bytes.subarray(offset + 4, offset + 8));
    const body = bytes.subarray(offset + 8, offset + 8 + length);
    if (type === "IHDR") {
      width = view.getUint32(offset + 8);
      height = view.getUint32(offset + 12);
      const depth = body[8];
      const colour = body[9];
      const interlace = body[12];
      if (depth !== 8 || interlace !== 0 || (colour !== 2 && colour !== 6)) {
        throw new Error("unsupported PNG format");
      }
      channels = colour === 6 ? 4 : 3;
    } else if (type === "IDAT") {
      idat.push(body);
    } else if (type === "IEND") {
      break;
    }
    offset += 12 + length;
  }
  if (width === 0 || height === 0 || idat.length === 0) throw new Error("incomplete PNG");

  const joined = new Uint8Array(idat.reduce((sum, part) => sum + part.length, 0));
  let cursor = 0;
  for (const part of idat) {
    joined.set(part, cursor);
    cursor += part.length;
  }
  const raw = inflateSync(joined);
  const stride = width * channels;
  if (raw.length < (stride + 1) * height) throw new Error("truncated PNG");

  const data = new Uint8Array(stride * height);
  for (let row = 0; row < height; row += 1) {
    const filter = raw[row * (stride + 1)];
    const source = row * (stride + 1) + 1;
    const target = row * stride;
    for (let x = 0; x < stride; x += 1) {
      const value = raw[source + x]!;
      const left = x >= channels ? data[target + x - channels]! : 0;
      const up = row > 0 ? data[target - stride + x]! : 0;
      const upLeft = row > 0 && x >= channels ? data[target - stride + x - channels]! : 0;
      let out: number;
      switch (filter) {
        case 0: out = value; break;
        case 1: out = value + left; break;
        case 2: out = value + up; break;
        case 3: out = value + ((left + up) >> 1); break;
        case 4: out = value + paeth(left, up, upLeft); break;
        default: throw new Error("bad PNG filter");
      }
      data[target + x] = out & 0xff;
    }
  }
  return { width, height, channels, data };
}
