import { describe, expect, it } from "vitest";
import { countCss } from "../../../scripts/qa/css-budget.mjs";

const count = (text: string, file = "src/ui/example.css") => countCss([{ path: file, text }]);

describe("css budget counting", () => {
  it("counts lines per file and in total", () => {
    const result = countCss([
      { path: "src/ui/b.css", text: ".b {\n  color: red;\n}\n" },
      { path: "src/ui/a.css", text: ".a {\n  color: blue;\n}" },
    ]);
    expect(result.totalLines).toBe(6);
    expect(result.maxFileLines).toBe(3);
    expect(result.files).toEqual({ "src/ui/a.css": 3, "src/ui/b.css": 3 });
  });

  it("counts distinct media conditions after normalising whitespace", () => {
    const result = count(
      "@media (max-width: 600px) { .a { color: red } }\n@media    (max-width: 600px) { .b { color: blue } }\n@media (min-width: 900px) { .c { color: green } }",
    );
    expect(result.mediaQueries).toBe(2);
  });

  it("ignores border-radius that uses var() but counts literal px, rem and % radii", () => {
    const result = count(
      ".a { border-radius: var(--og-radius); }\n.b { border-radius: 8px; }\n.c { border-radius: 1.5rem; }\n.d { border-radius: 50%; }\n .e { border-radius: inherit; }",
    );
    expect(result.literalRadius).toBe(3);
  });

  it("counts -webkit-backdrop-filter as well as backdrop-filter", () => {
    const result = count(".a {\n  -webkit-backdrop-filter: blur(2px);\n  backdrop-filter: blur(2px);\n}");
    expect(result.backdropFilter).toBe(2);
  });

  it("counts literal box shadows but not var() or none", () => {
    const result = count(
      ".a { box-shadow: 0 1px 2px #000; }\n.b { box-shadow: var(--og-shadow); }\n.c { box-shadow: none; }",
    );
    expect(result.literalShadow).toBe(1);
  });

  it("counts hex literals everywhere except tokens.css", () => {
    const css = ".a { color: #fff; background: #112233; border-color: #112233ff; }";
    expect(count(css).hexLiterals).toBe(3);
    expect(count(css, "src/app/tokens.css").hexLiterals).toBe(0);
  });
});
