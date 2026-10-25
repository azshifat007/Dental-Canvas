import { describe, expect, it } from "vitest";
import { classNames } from "../scripts/check-stylesheet-classes.mjs";

/**
 * The class guard is only as good as its extraction: if it starts reporting
 * numbers from declarations ("0.5rem") or silently drops escaped utilities, the
 * comparison against the release snapshot becomes noise nobody trusts.
 */
describe("stylesheet class extraction", () => {
  it("returns utilities from selectors", () => {
    const css = `.flex{display:flex}.bg-red-500{background-color:red}.z-50{z-index:50}`;
    expect([...classNames(css)].sort()).toEqual(["bg-red-500", "flex", "z-50"]);
  });

  it("unescapes arbitrary values and variants", () => {
    const css = [
      ".top-1\\/2{top:50%}",
      ".hover\\:bg-red-500:hover{background-color:red}",
      ".tracking-\\[0\\.31em\\]{letter-spacing:0.31em}",
      ".md\\:flex{display:flex}",
      ".\\[\\&_svg\\]\\:size-4 svg{width:1rem}",
    ].join("\n");
    expect([...classNames(css)].sort()).toEqual([
      "[&_svg]:size-4",
      "hover:bg-red-500",
      "md:flex",
      "top-1/2",
      "tracking-[0.31em]",
    ]);
  });

  it("ignores declaration values, comments and at-rule preludes", () => {
    const css = [
      "/* MIT License | .not-a-class */",
      ":root{--spacing:0.25rem;--radius:1.5rem}",
      "@keyframes dash-move{to{stroke-dashoffset:8}}",
      "@property --tw-animation-delay{syntax:\"*\";inherits:false}",
      "@media(min-width:40rem){.sm\\:grid{display:grid}}",
      ".shadow{box-shadow:0 0 0 1px rgba(0,0,0,.5)}",
    ].join("\n");
    expect([...classNames(css)].sort()).toEqual(["shadow", "sm:grid"]);
  });

  it("ignores dots inside attribute selectors", () => {
    const css = `a[href$=".pdf"]{color:red}.underline{text-decoration:underline}`;
    expect([...classNames(css)]).toEqual(["underline"]);
  });

  it("deduplicates a class emitted by several rules", () => {
    const css = `.flex{display:flex}@media(min-width:40rem){.flex{display:flex}}.flex-1{flex:1}`;
    expect([...classNames(css)].sort()).toEqual(["flex", "flex-1"]);
  });
});
