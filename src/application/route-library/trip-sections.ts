/**
 * A big trip read as days and sections (L7).
 *
 * The library's trips carry the source's own track names, e.g.
 * "Section 1: Mexico border to Benson (128 mi)". Nothing here invents a stage,
 * a distance or a day count: a section is one of those names, its mileage is the
 * figure the source put in that name, and a day count is only shown when the
 * source wrote one ("4-6 days") or when the source published more than one
 * section and the page is offering the ordinary one-section-a-day reading.
 */

export interface TripSection {
  /** The source's own section number, or the position when the name has none. */
  readonly day: number;
  /** The place names between the section number and its distance. */
  readonly label: string;
  /** The source's distance for this section in miles, or null when it gave none. */
  readonly miles: number | null;
}

const SECTION_HEAD = /^\s*(?:section|stage|day)\s+(\d+)\s*(?::|\.|-|–|—)\s*(.+?)\s*$/i;
const TRAILING_MILES = /[\s(]+([\d.,]+)\s*mi\)?\s*$/i;
const TRAILING_KM = /[\s(]+([\d.,]+)\s*km\)?\s*$/i;
const DAY_RANGE = /\b(\d+)\s*(?:-|–|—|to)\s*(\d+)\s*days?\b/i;
const DAY_SINGLE = /\b(\d+)\s*days?\b/i;

const MILES_PER_KM = 0.621371;

function numberFrom(text: string): number | null {
  const value = Number(text.replace(/,/g, ""));
  return Number.isFinite(value) && value > 0 ? value : null;
}

function roundedMiles(value: number): number {
  return value >= 10 ? Math.round(value) : Math.round(value * 10) / 10;
}

/**
 * One row per section, in the source's order. Fewer than two names is not a
 * section list: a single track name is the file's name, and a trip page with
 * one "section" would say nothing a rider can use.
 */
export function tripSections(names: readonly string[] | null | undefined): readonly TripSection[] {
  if (names === null || names === undefined || names.length === 0) return [];
  const clean = names.map((name) => name.trim().replace(/\s+/g, " ")).filter((name) => name !== "");
  if (clean.length === 0) return [];
  // A lone name is a section only when the source named it as one; anything
  // else is the file's name. The same name repeated is one track split into
  // segments (a trail bundle), not a list of stages.
  if (clean.length === 1 && !SECTION_HEAD.test(clean[0]!)) return [];
  if (clean.length > 1 && new Set(clean).size === 1) return [];
  const sections: TripSection[] = [];
  for (const [index, name] of clean.entries()) {
    const head = SECTION_HEAD.exec(name);
    const day = head === null ? index + 1 : Number(head[1]);
    let label = head === null ? name : head[2]!;
    let miles: number | null = null;
    const mi = TRAILING_MILES.exec(label);
    if (mi !== null) {
      miles = numberFrom(mi[1]!);
      label = label.slice(0, mi.index).trim();
    } else {
      const km = TRAILING_KM.exec(label);
      if (km !== null) {
        const kilometres = numberFrom(km[1]!);
        miles = kilometres === null ? null : roundedMiles(kilometres * MILES_PER_KM);
        label = label.slice(0, km.index).trim();
      }
    }
    sections.push({
      day: Number.isSafeInteger(day) && day > 0 ? day : index + 1,
      label: label === "" ? `Section ${day}` : label,
      miles,
    });
  }
  return sections;
}

/** The day count the source itself wrote, e.g. "4 to 6 days"; null when it wrote none. */
export function statedDays(text: string | null | undefined): string | null {
  if (typeof text !== "string" || text.trim() === "") return null;
  const range = DAY_RANGE.exec(text);
  if (range !== null) return `${range[1]} to ${range[2]} days`;
  const single = DAY_SINGLE.exec(text);
  return single === null ? null : `${single[1]} days`;
}

/** The one line above the section table: days when known, sections always when there are any. */
export function tripLead(sections: readonly TripSection[], stated: string | null): string | null {
  const parts: string[] = [];
  if (stated !== null) parts.push(`The source says ${stated}.`);
  if (sections.length > 1) parts.push(`${sections.length} sections, one a day.`);
  else if (sections.length === 1) parts.push("One section.");
  return parts.length === 0 ? null : parts.join(" ");
}

/** The sections' stated mileage added up, or null when the source gave none. */
export function sectionsMiles(sections: readonly TripSection[]): number | null {
  const miles = sections.flatMap((section) => (section.miles === null ? [] : [section.miles]));
  if (miles.length === 0) return null;
  return miles.reduce((total, value) => total + value, 0);
}
