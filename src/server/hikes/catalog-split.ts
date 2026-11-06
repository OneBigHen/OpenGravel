/**
 * A rich hikes catalog is too big to hold whole in the web server (27k trails,
 * ~140 MB of JSON, ~1 GB once parsed). It is served as two files made next to
 * `hikes.json` by `infra/trails/split-catalog.ts`:
 * - `hikes.summary.json`: every trail with only the fields lists, filters and
 *   search read, plus where its full record sits in the detail file;
 * - `hikes.details.jsonl`: one full record per line, read one trail at a time.
 */

/** Fields only the trail page reads; the summary leaves them out. */
export const DETAIL_ONLY_FIELDS = ["parks", "features", "officialEvidence", "fieldSources", "descriptions", "photos", "trailheads", "conflicts"] as const;

export interface DetailPointer {
  readonly offset: number;
  readonly length: number;
}

export function summaryPathFor(catalogPath: string): string {
  return catalogPath.replace(/\.json$/, ".summary.json");
}

export function detailsPathFor(catalogPath: string): string {
  return catalogPath.replace(/\.json$/, ".details.jsonl");
}

/** The summary of one full record, and the line to write for it in the detail file. */
export function splitRecord<T extends object>(record: T, offset: number): { summary: T & { detail: DetailPointer }; line: string } {
  const line = `${JSON.stringify(record)}\n`;
  const summary = { ...record } as Record<string, unknown>;
  for (const field of DETAIL_ONLY_FIELDS) delete summary[field];
  // Cards keep one credited source per provider; every source record stays in the detail.
  const sources = (record as { sources?: readonly { sourceId: string }[] }).sources;
  if (sources) summary.sources = [...new Map(sources.map((source) => [source.sourceId, source])).values()];
  return { summary: { ...(summary as T), detail: { offset, length: Buffer.byteLength(line) - 1 } }, line };
}

/** Trail lines, split the same way: `trails.index.json` maps id → line in `trails.features.jsonl`. */
export function featureIndexPathFor(geojsonPath: string): string {
  return geojsonPath.replace(/\.geojson$/, ".index.json");
}

export function featureLinesPathFor(geojsonPath: string): string {
  return geojsonPath.replace(/\.geojson$/, ".features.jsonl");
}

/** Reads `length` bytes at `offset` of a JSON-lines file and parses that record. */
export async function readJsonLine(path: string, pointer: DetailPointer): Promise<unknown> {
  const { open } = await import("node:fs/promises");
  const file = await open(path, "r");
  try {
    const buffer = Buffer.alloc(pointer.length);
    await file.read(buffer, 0, pointer.length, pointer.offset);
    return JSON.parse(buffer.toString("utf8"));
  } finally {
    await file.close();
  }
}
