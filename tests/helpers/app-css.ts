import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";

/**
 * The app's stylesheets as one text, in cascade order: the files the root layout
 * imports (tokens.css first), then every other stylesheet under src/ui. Design v3
 * split the old globals.css / theme-glass.css into tokens.css, app.css and one
 * file per screen, so tests read the set rather than a file name.
 */
export function appCssFiles(root: string = process.cwd()): string[] {
  const layout = readFileSync(path.join(root, "src/app/layout.tsx"), "utf8");
  const imported = [...layout.matchAll(/^import\s+"([^"]+\.css)";/gm)].map((match) => {
    const spec = match[1] as string;
    return spec.startsWith("@/") ? path.join(root, "src", spec.slice(2)) : path.join(root, "src/app", spec);
  });
  const rest: string[] = [];
  const walk = (dir: string): void => {
    for (const name of readdirSync(dir)) {
      const full = path.join(dir, name);
      if (statSync(full).isDirectory()) walk(full);
      else if (name.endsWith(".css") && !name.endsWith(".module.css") && !imported.includes(full)) rest.push(full);
    }
  };
  walk(path.join(root, "src/ui"));
  return [...imported, ...rest.sort()];
}

export function appCss(root: string = process.cwd()): string {
  return appCssFiles(root)
    .map((file) => readFileSync(file, "utf8"))
    .join("\n");
}

/** The token file alone: the only place colours, radii and shadows are written. */
export function tokensCss(root: string = process.cwd()): string {
  return readFileSync(path.join(root, "src/app/tokens.css"), "utf8");
}

/** Day values of every token, resolved through var() chains. */
export function tokenValues(root: string = process.cwd()): Map<string, string> {
  const css = tokensCss(root);
  const values = new Map<string, string>();
  // The first :root block is Day (and the default); the later plain :root
  // block holds type, space, radius and touch. The Night block is skipped.
  for (const block of css.matchAll(/(:root[^{]*)\{([^}]*)\}/g)) {
    if ((block[1] as string).includes("night")) continue;
    for (const decl of (block[2] as string).matchAll(/(--og-[a-z0-9-]+):\s*([^;]+);/g)) {
      if (!values.has(decl[1] as string)) values.set(decl[1] as string, (decl[2] as string).trim());
    }
  }
  const resolve = (value: string, depth = 0): string =>
    depth > 8 ? value : value.replace(/var\((--og-[a-z0-9-]+)\)/g, (whole, name: string) => {
      const next = values.get(name);
      return next === undefined ? whole : resolve(next, depth + 1);
    });
  for (const [name, value] of values) values.set(name, resolve(value));
  return values;
}

/** The stylesheets with every token reference replaced by its Day value. */
export function appCssResolved(root: string = process.cwd()): string {
  const values = tokenValues(root);
  return appCss(root).replace(/var\((--og-[a-z0-9-]+)\)/g, (whole, name: string) => values.get(name) ?? whole);
}

/**
 * Every declaration written for exactly this selector (alone or in a selector
 * list) outside media queries, in cascade order: once as written, then again
 * with tokens resolved to their Day values, so a test can pin either.
 */
export function cssRule(selector: string, root: string = process.cwd()): string {
  const raw = rulesFor(selector, appCss(root));
  const values = tokenValues(root);
  return `${raw}\n${raw.replace(/var\((--og-[a-z0-9-]+)\)/g, (whole, name: string) => values.get(name) ?? whole)}`;
}

/**
 * The same declarations as written, tokens unresolved. With `inMedia`, rules
 * inside media queries count too (a phone-only rule, say).
 */
export function cssRuleRaw(selector: string, options: { readonly inMedia?: boolean } = {}): string {
  return rulesFor(selector, appCss(), options.inMedia === true);
}

function rulesFor(selector: string, source: string, inMedia = false): string {
  const css = source.replace(/\/\*[\s\S]*?\*\//g, "");
  const out: string[] = [];
  let depth = 0;
  let start = 0;
  for (let i = 0; i < css.length; i += 1) {
    const ch = css[i];
    if (ch === "{") {
      const head = css.slice(start, i).trim();
      const close = css.indexOf("}", i);
      const inner = css.slice(i + 1, close);
      if ((inMedia || depth === 0) && !head.startsWith("@") && !inner.includes("{")) {
        const selectors = head.split(",").map((part) => part.trim().replace(/\s+/g, " "));
        if (selectors.includes(selector)) out.push(inner);
      }
      if (head.startsWith("@")) depth += 1;
      else {
        i = close;
      }
      start = i + 1;
    } else if (ch === "}") {
      depth = Math.max(0, depth - 1);
      start = i + 1;
    }
  }
  return out.join("\n");
}
