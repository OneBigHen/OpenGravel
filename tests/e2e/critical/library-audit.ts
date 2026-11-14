import type { Page } from "@playwright/test";

/**
 * What a rider can see, checked on the rendered page: everything stays inside
 * the screen sideways, nothing is cut off, text is readable, and every control
 * is big enough for a thumb. One function returns the list of problems so a
 * failing test names the exact element.
 */
export interface AuditOptions {
  /** CSS selector of the parts of the page to audit (every match). */
  readonly scope: string;
  /** Also require every audited box to sit inside the screen top to bottom (for a fixed screen such as the map view). */
  readonly insideScreen?: boolean;
  /** Controls inside these selectors are inline links in a sentence and exempt from the 44 px rule. */
  readonly inlineLinks?: readonly string[];
}

export async function audit(page: Page, options: AuditOptions): Promise<readonly string[]> {
  return page.evaluate(({ scope, insideScreen, inlineLinks }) => {
    const problems: string[] = [];
    const roots = Array.from(document.querySelectorAll(scope));
    if (roots.length === 0) return [`scope ${scope} not found`];
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    if (document.documentElement.scrollWidth > vw + 1) problems.push(`page scrolls sideways: ${document.documentElement.scrollWidth} > ${vw}`);

    const name = (el: Element): string => {
      const text = (el.textContent ?? "").replace(/\s+/g, " ").trim().slice(0, 40);
      return `${el.tagName.toLowerCase()}${el.className && typeof el.className === "string" ? "." + el.className.split(" ")[0] : ""}[${text}]`;
    };
    const visible = (el: Element): boolean => {
      const style = getComputedStyle(el);
      const rect = el.getBoundingClientRect();
      return style.visibility !== "hidden" && style.display !== "none" && Number(style.opacity) > 0 && rect.width > 1 && rect.height > 1;
    };
    const inScroller = (el: Element): boolean => {
      for (let node = el.parentElement; node !== null && node !== document.body; node = node.parentElement) {
        const x = getComputedStyle(node).overflowX;
        if ((x === "auto" || x === "scroll") && node.scrollWidth > node.clientWidth + 1) return true;
      }
      return false;
    };

    // Colour maths for contrast.
    type Rgba = [number, number, number, number];
    const parse = (value: string): Rgba => {
      const match = value.match(/rgba?\(([^)]+)\)/) ?? value.match(/color\(srgb ([^)]+)\)/);
      if (match === null) return [0, 0, 0, 0];
      const parts = match[1]!.split(/[ ,/]+/).filter(Boolean).map(Number);
      const scale = value.startsWith("color(") ? 255 : 1;
      return [parts[0]! * scale, parts[1]! * scale, parts[2]! * scale, parts[3] ?? 1];
    };
    const over = (top: Rgba, below: Rgba): Rgba => {
      const a = top[3] + below[3] * (1 - top[3]);
      if (a === 0) return [0, 0, 0, 0];
      return [0, 1, 2].map((i) => (top[i]! * top[3] + below[i]! * below[3] * (1 - top[3])) / a).concat(a) as Rgba;
    };
    const luminance = (c: Rgba): number => {
      const [r, g, b] = [c[0], c[1], c[2]].map((v) => { const s = v / 255; return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4; }) as [number, number, number];
      return 0.2126 * r + 0.7152 * g + 0.0722 * b;
    };
    const backdrop = (el: Element): Rgba => {
      let colour: Rgba = [0, 0, 0, 0];
      for (let node: Element | null = el; node !== null; node = node.parentElement) {
        colour = over(colour, parse(getComputedStyle(node).backgroundColor));
        if (colour[3] >= 0.999) break;
      }
      return colour[3] >= 0.999 ? colour : over(colour, [255, 255, 255, 1]);
    };

    const everything = roots.flatMap((root) => [root, ...root.querySelectorAll("*")]);
    for (const el of everything) {
      if (!visible(el)) continue;
      if (el.closest(".sr-only, .og-visually-hidden, [aria-hidden='true']") !== null && !(el.matches("[aria-hidden='true']") && el.textContent?.trim())) continue;
      const rect = el.getBoundingClientRect();
      const style = getComputedStyle(el);
      const hasOwnText = Array.from(el.childNodes).some((n) => n.nodeType === Node.TEXT_NODE && (n.textContent ?? "").trim() !== "");
      const label = name(el);

      // Inside the screen sideways (a sideways scroller's own items may run past the edge, but the first must start inside).
      if (!inScroller(el) && (rect.left < -0.5 || rect.right > vw + 0.5)) problems.push(`outside the screen sideways: ${label} ${Math.round(rect.left)}..${Math.round(rect.right)} of ${vw}`);
      if (insideScreen === true && !inScroller(el) && (rect.top < -0.5 || rect.bottom > vh + 0.5)) problems.push(`outside the screen: ${label} ${Math.round(rect.top)}..${Math.round(rect.bottom)} of ${vh}`);

      // Nothing cut off.
      const clipsX = style.overflowX !== "visible" && style.overflowX !== "auto" && style.overflowX !== "scroll";
      const clipsY = style.overflowY !== "visible" && style.overflowY !== "auto" && style.overflowY !== "scroll";
      if ((clipsX || style.textOverflow === "ellipsis") && el.scrollWidth > el.clientWidth + 1 && hasOwnText) problems.push(`text cut off sideways: ${label}`);
      if (clipsY && el.scrollHeight > el.clientHeight + 1 && (hasOwnText || el.children.length > 0) && !el.matches(".og-map-host, .og-routes__map, .og-routes__bubbles, .og-routes__stage, canvas")) {
        problems.push(`content cut off: ${label} ${el.scrollHeight} > ${el.clientHeight}`);
      }

      // Readable.
      if (hasOwnText && !(el as HTMLButtonElement).disabled) {
        const fg = over(parse(style.color), backdrop(el));
        const bg = backdrop(el);
        const l1 = luminance(fg);
        const l2 = luminance(bg);
        const ratio = (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);
        if (ratio < 4.5) problems.push(`low contrast ${ratio.toFixed(2)}:1: ${label}`);
      }

      // Big enough for a thumb: the box plus the invisible hit area around it.
      const control = el.matches("button, a[href], input, select, summary, [role='button']");
      const inline = inlineLinks !== undefined && inlineLinks.some((selector) => el.closest(selector) !== null) && el.matches("a");
      if (control && !inline && !(el as HTMLButtonElement).disabled && rect.top < vh && rect.bottom > 0) {
        const cx = Math.min(Math.max(rect.left + rect.width / 2, 1), vw - 1);
        const cy = Math.min(Math.max(rect.top + rect.height / 2, 1), vh - 1);
        const hits = (x: number, y: number): boolean => { const hit = document.elementFromPoint(x, y); return hit !== null && (hit === el || el.contains(hit)); };
        let up = 0; while (up < 12 && hits(cx, rect.top - up - 1)) up += 1;
        let down = 0; while (down < 12 && hits(cx, rect.bottom + down + 0.01)) down += 1;
        let left = 0; while (left < 12 && hits(rect.left - left - 1, cy)) left += 1;
        let right = 0; while (right < 12 && hits(rect.right + right + 0.01, cy)) right += 1;
        const width = rect.width + left + right;
        const height = rect.height + up + down;
        if (width < 44 - 0.5 || height < 44 - 0.5) problems.push(`tap target ${Math.round(width)}x${Math.round(height)}: ${label}`);
      }
    }
    return problems;
  }, { scope: options.scope, insideScreen: options.insideScreen ?? false, inlineLinks: options.inlineLinks ?? [] });
}

/** Pairs of the named regions that overlap by more than a hair. */
export async function overlaps(page: Page, selectors: Readonly<Record<string, string>>): Promise<readonly string[]> {
  return page.evaluate((named) => {
    const boxes = Object.entries(named).flatMap(([key, selector]) => {
      const el = document.querySelector(selector);
      if (el === null) return [];
      const rect = el.getBoundingClientRect();
      return rect.width > 1 && rect.height > 1 ? [{ key, rect }] : [];
    });
    const out: string[] = [];
    for (let i = 0; i < boxes.length; i += 1) {
      for (let j = i + 1; j < boxes.length; j += 1) {
        const a = boxes[i]!.rect;
        const b = boxes[j]!.rect;
        const w = Math.min(a.right, b.right) - Math.max(a.left, b.left);
        const h = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top);
        if (w > 1 && h > 1) out.push(`${boxes[i]!.key} overlaps ${boxes[j]!.key} by ${Math.round(w)}x${Math.round(h)}`);
      }
    }
    return out;
  }, selectors);
}
