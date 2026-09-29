import { deflateRawSync } from "node:zlib";

import { describe, expect, it } from "vitest";

import { MAX_KMZ_COMPRESSION_RATIO, MAX_KMZ_ENTRIES } from "@/application/import/limits";
import { parseImportBytes } from "@/infrastructure/import/import-bytes";

interface ZipEntry {
  readonly name: string;
  readonly data: Uint8Array;
  readonly method?: 0 | 8;
}

function u16(value: number): Uint8Array {
  return Uint8Array.from([value & 0xff, (value >>> 8) & 0xff]);
}

function u32(value: number): Uint8Array {
  return Uint8Array.from([
    value & 0xff,
    (value >>> 8) & 0xff,
    (value >>> 16) & 0xff,
    (value >>> 24) & 0xff,
  ]);
}

function concat(...parts: readonly Uint8Array[]): Uint8Array {
  const result = new Uint8Array(parts.reduce((total, part) => total + part.length, 0));
  let offset = 0;
  for (const part of parts) {
    result.set(part, offset);
    offset += part.length;
  }
  return result;
}

function zip(entries: readonly ZipEntry[]): Uint8Array {
  const local: Uint8Array[] = [];
  const central: Uint8Array[] = [];
  let offset = 0;
  for (const entry of entries) {
    const name = new TextEncoder().encode(entry.name);
    const raw = entry.data;
    const method = entry.method ?? 0;
    const stored = method === 8 ? new Uint8Array(deflateRawSync(raw)) : raw;
    local.push(concat(
      u32(0x04034b50), u16(20), u16(0), u16(method), u16(0), u16(0),
      u32(0), u32(stored.length), u32(raw.length), u16(name.length), u16(0), name, stored,
    ));
    central.push(concat(
      u32(0x02014b50), u16(20), u16(20), u16(0), u16(method), u16(0), u16(0),
      u32(0), u32(stored.length), u32(raw.length), u16(name.length), u16(0), u16(0),
      u16(0), u16(0), u32(0), u32(offset), name,
    ));
    offset += local.at(-1)?.length ?? 0;
  }
  const localBytes = concat(...local);
  const centralBytes = concat(...central);
  return concat(
    localBytes,
    centralBytes,
    u32(0x06054b50), u16(0), u16(0), u16(entries.length), u16(entries.length),
    u32(centralBytes.length), u32(localBytes.length), u16(0),
  );
}

const KML = `<kml><Document><name>KMZ ride</name><Placemark><LineString><coordinates>-75,40 -75.001,40.001</coordinates></LineString></Placemark></Document></kml>`;

describe("KMZ parser", () => {
  it("parses a valid multi-entry archive and preserves entry order as tracks", async () => {
    const parsed = await parseImportBytes(
      zip([
        { name: "images/icon.png", data: Uint8Array.from([1, 2, 3]) },
        { name: "doc.kml", data: new TextEncoder().encode(KML), method: 8 },
      ]),
      "ride.KMZ",
    );

    expect(parsed.tracks).toHaveLength(1);
    expect(parsed.tracks[0]?.name).toBe("KMZ ride");
  });

  it("rejects traversal and absolute entry names", async () => {
    for (const name of ["../doc.kml", "/doc.kml", "C:\\doc.kml"]) {
      await expect(parseImportBytes(zip([{ name, data: new TextEncoder().encode(KML) }]), "ride.kmz"))
        .rejects.toThrow(/path|entry/i);
    }
  });

  it("rejects compression-ratio and entry-count violations", async () => {
    const repeated = new TextEncoder().encode("A".repeat(20_000));
    await expect(parseImportBytes(
      zip([{ name: "doc.kml", data: repeated, method: 8 }]),
      "ratio.kmz",
    )).rejects.toThrow(new RegExp(String(MAX_KMZ_COMPRESSION_RATIO)));

    const entries = Array.from({ length: MAX_KMZ_ENTRIES + 1 }, (_, index) => ({
      name: `asset-${index}.bin`,
      data: Uint8Array.from([index & 0xff]),
    }));
    await expect(parseImportBytes(zip(entries), "many.kmz")).rejects.toThrow(/entries/i);
  });
});
