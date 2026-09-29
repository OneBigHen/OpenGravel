import { deflateSync } from "node:zlib";
import { describe, expect, it } from "vitest";

import { decodePng } from "@/infrastructure/elevation/png-decode";
import { createTerrariumElevationSource } from "@/infrastructure/elevation/terrarium-source";

function crcTable(): number[] {
  return Array.from({ length: 256 }, (_, n) => {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    return c >>> 0;
  });
}
const TABLE = crcTable();
function crc(bytes: Uint8Array): number {
  let c = 0xffffffff;
  for (const byte of bytes) c = TABLE[(c ^ byte) & 0xff]! ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function chunk(type: string, body: Uint8Array): Buffer {
  const head = Buffer.alloc(8);
  head.writeUInt32BE(body.length, 0);
  head.write(type, 4, "ascii");
  const tail = Buffer.alloc(4);
  tail.writeUInt32BE(crc(Buffer.concat([Buffer.from(type, "ascii"), body])), 0);
  return Buffer.concat([head, body, tail]);
}

/** A solid 256×256 RGB Terrarium tile at one height, rows using filter `filter`. */
function terrariumTile(meters: number, filter = 0): Uint8Array {
  const value = meters + 32768;
  const r = Math.floor(value / 256);
  const g = Math.floor(value) % 256;
  const b = Math.round((value - Math.floor(value)) * 256);
  const rows: number[] = [];
  for (let y = 0; y < 256; y += 1) {
    rows.push(filter);
    for (let x = 0; x < 256; x += 1) {
      if (filter === 2 && y > 0) rows.push(0, 0, 0);
      else if (filter === 1 && x > 0) rows.push(0, 0, 0);
      else rows.push(r, g, b);
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(256, 0);
  ihdr.writeUInt32BE(256, 4);
  ihdr[8] = 8;
  ihdr[9] = 2;
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(Buffer.from(rows))),
    chunk("IEND", new Uint8Array()),
  ]);
}

describe("decodePng", () => {
  it("decodes RGB rows, undoing the Sub and Up filters", () => {
    for (const filter of [0, 1, 2]) {
      const decoded = decodePng(terrariumTile(300, filter));
      expect(decoded.width).toBe(256);
      expect(decoded.channels).toBe(3);
      expect(Array.from(decoded.data.subarray(-3))).toEqual(Array.from(decoded.data.subarray(0, 3)));
    }
  });

  it("refuses what is not a PNG", () => {
    expect(() => decodePng(new Uint8Array([1, 2, 3]))).toThrow();
  });
});

describe("createTerrariumElevationSource", () => {
  it("reads heights from tiles and fetches each tile once", async () => {
    let fetches = 0;
    const source = createTerrariumElevationSource({
      fetchImpl: (async () => {
        fetches += 1;
        return new Response(new Uint8Array(terrariumTile(412.5)).buffer);
      }) as typeof fetch,
    });
    const result = await source.elevations([
      { lon: -75.75, lat: 40.87 },
      { lon: -75.7501, lat: 40.8701 },
    ]);
    expect(result).toEqual({ availability: "available", elevationsMeters: [412.5, 412.5] });
    expect(fetches).toBeLessThanOrEqual(4);
  });

  it("answers unavailable when a tile cannot be read", async () => {
    const source = createTerrariumElevationSource({
      fetchImpl: (async () => new Response("nope", { status: 503 })) as typeof fetch,
    });
    const result = await source.elevations([{ lon: -75.7, lat: 40.8 }, { lon: -75.6, lat: 40.8 }]);
    expect(result.availability).toBe("unavailable");
  });
});
