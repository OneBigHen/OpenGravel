import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";

/** One boundary-rule violation, shaped for CI output and exact-count assertions. */
export type Violation = {
  readonly ruleId: string;
  readonly file: string;
  readonly specifier: string;
  readonly reason: string;
};

/** A machine-enforceable import boundary for one layer or adapter directory. */
export type BoundaryRule = {
  readonly id: string;
  readonly description: string;
  readonly appliesTo: (file: string) => boolean;
  readonly forbidden: (
    specifier: string,
    resolvedTarget: string | null,
    declaration: string,
  ) => string | null;
  /**
   * Optional whole-file contract over the file's string literals (e.g. a
   * provider URL embedded in UI copy, which no import specifier would reveal).
   */
  readonly forbiddenLiteral?: (literal: string) => string | null;
};

/** A specifier found in a source file, with the original line that carries it. */
export type SpecifierOccurrence = {
  readonly specifier: string;
  readonly line: number;
  readonly rawLine: string;
  /**
   * The whole import/require declaration, continuation lines and the `from`
   * clause included, so a rule can inspect the bound names and not only the
   * specifier that happened to be on this line.
   */
  readonly declaration: string;
};

/** A string literal found in code (comments and template bodies excluded). */
export type LiteralOccurrence = {
  readonly literal: string;
  readonly line: number;
  readonly rawLine: string;
};

/**
 * Specifier the scanner emits for a non-literal dynamic `import(...)`. Guarded
 * layers reject it (fail-closed) because the target cannot be resolved.
 */
export const DYNAMIC_SPECIFIER = "<dynamic>";

const ALWAYS_SKIPPED_DIRS: ReadonlySet<string> = new Set([
  "node_modules",
  ".next",
]);

const SOURCE_EXTENSIONS: ReadonlySet<string> = new Set([
  ".ts",
  ".tsx",
  ".mts",
  ".cts",
]);

/**
 * Every `.ts`/`.tsx`/`.mts`/`.cts` file under `root`, sorted, skipping
 * `node_modules` and `.next` always and any directory listed in `excludedDirs`.
 */
export function walkSourceFiles(
  root: string,
  excludedDirs: readonly string[] = [],
): string[] {
  const excluded = new Set(excludedDirs.map((dir) => path.resolve(dir)));
  const files: string[] = [];
  const visit = (dir: string): void => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const entryPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        const skip =
          ALWAYS_SKIPPED_DIRS.has(entry.name) ||
          excluded.has(path.resolve(entryPath));
        if (!skip) visit(entryPath);
      } else if (SOURCE_EXTENSIONS.has(path.extname(entry.name))) {
        files.push(entryPath);
      }
    }
  };
  visit(path.resolve(root));
  return files.sort();
}

type MaskMode =
  | "code"
  | "line-comment"
  | "block-comment"
  | "single-quote"
  | "double-quote"
  | "template";

type MaskStep = {
  readonly nextMode: MaskMode;
  readonly text: string;
  readonly advance: number;
};

function maskQuoted(quote: string, mode: MaskMode) {
  return (char: string, next: string): MaskStep =>
    char === "\\"
      ? { nextMode: mode, text: `${char}${next}`, advance: 2 }
      : char === quote || char === "\n"
        ? { nextMode: "code", text: char, advance: 1 }
        : { nextMode: mode, text: char, advance: 1 };
}

const MASK_HANDLERS: Readonly<
  Record<MaskMode, (char: string, next: string) => MaskStep>
> = {
  code: (char, next) => {
    if (char === "/" && next === "/") {
      return { nextMode: "line-comment", text: "  ", advance: 2 };
    }
    if (char === "/" && next === "*") {
      return { nextMode: "block-comment", text: "  ", advance: 2 };
    }
    if (char === "'") {
      return { nextMode: "single-quote", text: char, advance: 1 };
    }
    if (char === '"') {
      return { nextMode: "double-quote", text: char, advance: 1 };
    }
    if (char === "`") {
      return { nextMode: "template", text: char, advance: 1 };
    }
    return { nextMode: "code", text: char, advance: 1 };
  },
  "line-comment": (char) =>
    char === "\n"
      ? { nextMode: "code", text: "\n", advance: 1 }
      : { nextMode: "line-comment", text: " ", advance: 1 },
  "block-comment": (char, next) =>
    char === "*" && next === "/"
      ? { nextMode: "code", text: "  ", advance: 2 }
      : {
          nextMode: "block-comment",
          text: char === "\n" ? "\n" : " ",
          advance: 1,
        },
  "single-quote": maskQuoted("'", "single-quote"),
  "double-quote": maskQuoted('"', "double-quote"),
  template: (char) => {
    if (char === "\\") {
      return { nextMode: "template", text: "  ", advance: 2 };
    }
    if (char === "`") {
      return { nextMode: "code", text: char, advance: 1 };
    }
    return { nextMode: "template", text: char === "\n" ? "\n" : " ", advance: 1 };
  },
};

/**
 * Blanks out comment text and template-literal bodies while keeping the output
 * the same length as the input and preserving every newline, so a match index
 * still maps onto the original line. Single- and double-quoted strings are kept
 * verbatim because they carry the module specifiers.
 *
 * Known limitation: regex literals are not tracked, so a `//` inside a regex
 * literal blanks the rest of that line. Import statements never follow a regex
 * literal, and imports inside `${}` template interpolation are not analyzed.
 */
function maskCommentsAndTemplates(source: string): string {
  const output: string[] = [];
  let mode: MaskMode = "code";
  let index = 0;
  while (index < source.length) {
    const char = source[index] ?? "";
    const step: MaskStep = MASK_HANDLERS[mode](
      char,
      source[index + 1] ?? "",
    );
    output.push(step.text);
    index += step.advance;
    mode = step.nextMode;
  }
  return output.join("");
}

const FROM_IMPORT_PATTERN =
  /(?:^|[\n;{}])\s*(?:import|export)\b[^;'"]*?\bfrom\s*(['"])([^'"]+)\1/g;
const SIDE_EFFECT_IMPORT_PATTERN =
  /(?:^|[\n;{}])\s*import\s*(['"])([^'"]+)\1/g;
const DYNAMIC_IMPORT_PATTERN = /\bimport\s*\(\s*(['"])([^'"]+)\1\s*\)/g;
/**
 * `require("x")`, `require('x')` and member calls such as
 * `require("x").default`. The scanner has no binding analysis, so a shadowed
 * local helper named `require` would be a false positive; that is an accepted
 * heuristic limit, and every other vector here is fail-closed.
 */
const REQUIRE_PATTERN = /\brequire\s*\(\s*(['"])([^'"]+)\1\s*\)/g;
/**
 * A dynamic `import(...)` whose argument is not a string literal
 * (`import(someVar)`, `import(\`re${"act"}\`)`). No specifier can be read out
 * of it, so the scanner emits {@link DYNAMIC_SPECIFIER} and guarded layers fail
 * closed. The lookahead runs before any whitespace backtracking, so
 * `import( "literal")` stays a literal match.
 */
const NON_LITERAL_DYNAMIC_IMPORT_PATTERN = /\bimport\s*\((?!\s*['"])[^)]*\)/g;

const IMPORT_PATTERNS: readonly RegExp[] = [
  FROM_IMPORT_PATTERN,
  SIDE_EFFECT_IMPORT_PATTERN,
  DYNAMIC_IMPORT_PATTERN,
  REQUIRE_PATTERN,
  NON_LITERAL_DYNAMIC_IMPORT_PATTERN,
];

const STATEMENT_KEYWORD_PATTERN = /\b(?:import|export|require)\b/g;

/**
 * The declaration text around one specifier: from the nearest preceding
 * `import`/`export`/`require` keyword through the end of the statement (the
 * first `;`, or the end of the specifier's line when the statement is
 * newline-terminated).
 *
 * Heuristic limit: a statement with no semicolon and no newline after its
 * specifier is truncated or extended to the surrounding line; the guard
 * contract is the port boundary, and this text only feeds the setter-name
 * heuristic in Rules C/D.
 */
function declarationAt(text: string, statementEndHint: number): string {
  const keywordWindow = Math.min(text.length, statementEndHint + 8);
  let start = 0;
  for (const match of text
    .slice(0, keywordWindow)
    .matchAll(STATEMENT_KEYWORD_PATTERN)) {
    if (match.index !== undefined) start = match.index;
  }
  const semi = text.indexOf(";", statementEndHint);
  const newline = text.indexOf("\n", statementEndHint);
  const end =
    semi !== -1 && (newline === -1 || semi < newline)
      ? semi + 1
      : newline === -1
        ? text.length
        : newline;
  return text.slice(start, end).trim();
}

function lineNumberAt(text: string, index: number): number {
  let line = 1;
  for (let cursor = 0; cursor < index; cursor += 1) {
    if (text[cursor] === "\n") line += 1;
  }
  return line;
}

/**
 * Distinct module specifiers with their original line and full declaration, in
 * source order: default/named/namespace imports, `export ... from`, side-effect
 * imports, `require(...)` and dynamic `import(...)`. A non-literal dynamic
 * import reports {@link DYNAMIC_SPECIFIER}. Commented-out imports are ignored.
 */
export function findSpecifierOccurrences(source: string): SpecifierOccurrence[] {
  const masked = maskCommentsAndTemplates(source);
  const rawLines = source.split("\n");
  const matches: { index: number; end: number; specifier: string }[] = [];
  for (const pattern of IMPORT_PATTERNS) {
    for (const match of masked.matchAll(pattern)) {
      if (match.index === undefined) continue;
      matches.push({
        index: match.index,
        end: match.index + match[0].length,
        specifier: match[2] ?? DYNAMIC_SPECIFIER,
      });
    }
  }
  matches.sort((left, right) => left.index - right.index);

  const seen = new Set<string>();
  const occurrences: SpecifierOccurrence[] = [];
  for (const match of matches) {
    if (seen.has(match.specifier)) continue;
    seen.add(match.specifier);
    const line = lineNumberAt(masked, match.index);
    occurrences.push({
      specifier: match.specifier,
      line,
      rawLine: rawLines[line - 1] ?? "",
      declaration: declarationAt(masked, match.end),
    });
  }
  return occurrences;
}

const STRING_LITERAL_PATTERN = /(['"])((?:\\.|[^\\\n])*?)\1/g;

/**
 * Distinct string literals in code, with their line. Comments and template
 * literal bodies are masked out first, so only real `'...'`/`"..."` literals
 * are reported.
 */
export function findStringLiterals(source: string): LiteralOccurrence[] {
  const masked = maskCommentsAndTemplates(source);
  const rawLines = source.split("\n");
  const seen = new Set<string>();
  const occurrences: LiteralOccurrence[] = [];
  for (const match of masked.matchAll(STRING_LITERAL_PATTERN)) {
    const literal = match[2];
    if (match.index === undefined || literal === undefined) continue;
    if (seen.has(literal)) continue;
    seen.add(literal);
    const line = lineNumberAt(masked, match.index);
    occurrences.push({ literal, line, rawLine: rawLines[line - 1] ?? "" });
  }
  return occurrences;
}

/**
 * Every module specifier in `source`, in source order: default/named/namespace
 * imports, `export ... from`, side-effect imports, `require(...)` and dynamic
 * `import(...)`; a non-literal dynamic import yields `"<dynamic>"`.
 * Commented-out imports are ignored.
 */
export function extractModuleSpecifiers(source: string): string[] {
  return findSpecifierOccurrences(source).map(
    (occurrence) => occurrence.specifier,
  );
}

/** Nearest ancestor directory holding a `package.json`. */
export function findRepoRoot(fromFile: string): string {
  let dir = path.dirname(path.resolve(fromFile));
  for (;;) {
    if (existsSync(path.join(dir, "package.json"))) return dir;
    const parent = path.dirname(dir);
    if (parent === dir) return dir;
    dir = parent;
  }
}

/**
 * Maps `@/x` to `<repoRoot>/src/x` and `./x`/`../x` against the importing
 * file's directory; bare package specifiers and anything else return `null`.
 * Paths are not probed on disk, so the caller compares resolved prefixes.
 */
export function resolveSpecifier(
  fromFile: string,
  specifier: string,
): string | null {
  if (specifier.startsWith("@/")) {
    return path.join(findRepoRoot(fromFile), "src", ...specifier.slice(2).split("/"));
  }
  if (specifier.startsWith("./") || specifier.startsWith("../")) {
    return path.resolve(path.dirname(fromFile), ...specifier.split("/"));
  }
  return null;
}

/** Evaluates every rule whose `appliesTo` matches, returning each violation. */
export function checkBoundaryRules(
  files: readonly string[],
  rules: readonly BoundaryRule[],
): Violation[] {
  const violations: Violation[] = [];
  for (const file of files) {
    const applicable = rules.filter((rule) => rule.appliesTo(file));
    if (applicable.length === 0) continue;
    const source = readFileSync(file, "utf8");
    for (const occurrence of findSpecifierOccurrences(source)) {
      const resolvedTarget = resolveSpecifier(file, occurrence.specifier);
      for (const rule of applicable) {
        const reason = rule.forbidden(
          occurrence.specifier,
          resolvedTarget,
          occurrence.declaration,
        );
        if (reason !== null) {
          violations.push({
            ruleId: rule.id,
            file,
            specifier: occurrence.specifier,
            reason,
          });
        }
      }
    }
    for (const rule of applicable) {
      if (rule.forbiddenLiteral === undefined) continue;
      for (const occurrence of findStringLiterals(source)) {
        const reason = rule.forbiddenLiteral(occurrence.literal);
        if (reason !== null) {
          violations.push({
            ruleId: rule.id,
            file,
            specifier: occurrence.literal,
            reason,
          });
        }
      }
    }
  }
  return violations;
}
