#!/usr/bin/env node
/**
 * Scroll-layout guard — catches "unbounded growth inside overflow-hidden
 * wrappers" at build time, the bug class that silently clipped the medicines
 * list (reported three times) and the setup wizard footer.
 *
 * Uses the TypeScript compiler API to walk every JSX element in the
 * .tsx files under src/client (recursive) and reads its className tokens
 * (including tokens coming from cn(...) calls and template literals). Two rules:
 *
 * 1. unbounded-scroll-in-clipper — an element with `overflow-hidden` that is
 *    NOT a flex/grid container and NOT `relative` must not contain a
 *    vertically scrollable area that has no height bound of its own
 *    (`max-h-*`, `h-full`, `h-[...]`, `absolute`, `inset-0`). That is the
 *    medicines v1.4.12 bug: `flex-1` is meaningless inside a plain block, the
 *    scroll area grows to its content and the clipper hides it with no
 *    scrollbar. Scroll areas are found BOTH inline and inside child
 *    components: every component whose JSX root renders an unbounded scroll
 *    element (or relies on flex-1 for height) is pre-classified as
 *    "height-hungry" in a cross-file pass, and using one inside a clipper
 *    flags the clipper. Exempt when a proper ancestor of the clipper already
 *    scrolls (page-level scroller bounds everything inside it).
 *
 * 2. clipped-overlay-card — a child of a `fixed` overlay that carries
 *    `overflow-hidden` without any height bound (`max-h-*`, `h-full`,
 *    `h-[...]`) or its own flex/grid layout grows with its content and
 *    clips past the viewport — the setup-wizard bug: footer buttons became
 *    unreachable on short windows.
 *
 * When this rule fires, fix the layout (flex column + min-h-0, absolute
 * inset-0, or max-h-*) AND add a short comment on the wrapper explaining the
 * height contract, so the next reader doesn't "simplify" it away.
 *
 * Run: node scripts/check-scroll-layout.mjs  (wired into `npm run build`,
 * CI, and the pre-commit hook in .githooks/).
 */

import ts from "typescript";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

const ROOT = "src/client";
const errors = [];

/** name → true for components whose JSX root relies on the PARENT for its
 *  height: an unbounded scroll root or a flex-1 root with no self-bounds. */
const heightHungry = new Map();

// ── className token extraction ────────────────────────────────────────────

/** Collect every string literal embedded in an expression (cn(...) args,
 *  template literals, ternaries, &&-chains). */
function collectStrings(node, out) {
  if (!node) return;
  if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) {
    out.push(node.text);
    return;
  }
  if (ts.isTemplateExpression(node)) {
    out.push(node.head.text);
    node.templateSpans.forEach((s) => {
      out.push(s.literal.text);
      collectStrings(s.expression, out);
    });
    return;
  }
  ts.forEachChild(node, (child) => collectStrings(child, out));
}

/** className tokens of a JSX element (all branches of conditionals included). */
function classNameTokens(el) {
  const strings = [];
  for (const attr of el.attributes?.properties ?? []) {
    if (!ts.isJsxAttribute(attr) || attr.name.text !== "className") continue;
    const init = attr.initializer;
    if (!init) continue;
    if (ts.isStringLiteral(init)) strings.push(init.text);
    else collectStrings(init, strings);
  }
  const tokens = new Set();
  for (const s of strings) for (const t of s.split(/\s+/)) if (t) tokens.add(t);
  return tokens;
}

/** Strip responsive/conditional prefixes: "md:overflow-auto" → "overflow-auto". */
const base = (t) => t.split(":").pop();

const isScrollToken = (t) =>
  ["overflow-auto", "overflow-y-auto", "overflow-y-scroll", "overflow-scroll", "force-scrollbar"].includes(base(t));
const isClipToken = (t) => ["overflow-hidden", "overflow-clip"].includes(base(t));
const isFlexDisplay = (t) => /^(?:[\w-]+:)?(?:flex|inline-flex|grid|inline-grid)$/.test(t);
/** Height-bound tokens that make an element's height independent of content. */
const isHeightBound = (t) => {
  const b = base(t);
  return (
    b.startsWith("max-h-") ||
    b === "h-full" ||
    b === "h-screen" ||
    b === "absolute" ||
    b === "fixed" ||
    b === "sticky" ||
    b === "inset-0" ||
    /^h-\[/.test(b) ||
    /^max-h-\[/.test(b)
  );
};

// ── AST walk with parent links ────────────────────────────────────────────

function visit(node, parent, file, ancestors) {
  node.parent = parent;

  if (ts.isJsxElement(node) || ts.isJsxSelfClosingElement(node)) {
    const opening = ts.isJsxElement(node) ? node.openingElement : node;
    const tag = opening.tagName.getText();
    if (tag[0] === tag[0].toLowerCase() || tag.includes(".")) {
      // lowercase = DOM element; capitalized-with-dot (e.g. Radix primitives)
      // are treated as components too — className analysis is safe either way.
      const tokens = classNameTokens(opening);
      checkElement(node, opening, tokens, [...ancestors, node], file);
      ancestors = [...ancestors, node];
    }
  }

  ts.forEachChild(node, (child) => visit(child, node, file, ancestors));
}

function elementChildren(el) {
  const out = [];
  const walk = (n) => {
    ts.forEachChild(n, (child) => {
      if (ts.isJsxElement(child) || ts.isJsxSelfClosingElement(child)) out.push(child);
      walk(child);
    });
  };
  walk(el);
  return out;
}

function descendantElements(el) {
  const out = [];
  const walk = (n) => {
    ts.forEachChild(n, (child) => {
      if ((ts.isJsxElement(child) || ts.isJsxSelfClosingElement(child)) && child !== el) out.push(child);
      walk(child);
    });
  };
  walk(el);
  return out;
}

function hasScrollToken(tokens) {
  for (const t of tokens) if (isScrollToken(t)) return true;
  return false;
}

// ── Cross-file pass: classify component roots as height-hungry ──────────

/** Root JSX element tokens of a component's return statement, or null. */
function returnedRootTokens(fnBody, sourceFile) {
  let root = null;
  const walk = (n) => {
    if (root) return;
    if (ts.isReturnStatement(n) && n.expression) {
      let e = n.expression;
      while (ts.isParenthesizedExpression(e)) e = e.expression;
      if (ts.isJsxElement(e)) root = e.openingElement;
      else if (ts.isJsxSelfClosingElement(e)) root = e;
    }
    ts.forEachChild(n, walk);
  };
  walk(fnBody);
  return root ? classNameTokens(root) : null;
}

function classifyComponents(sourceFile, path) {
  const visit1 = (node) => {
    let name = null;
    let body = null;
    if (ts.isFunctionDeclaration(node) && node.name && node.body) {
      name = node.name.text;
      body = node.body;
    } else if (
      ts.isVariableStatement(node) &&
      (node.modifiers ?? []).some((m) => m.kind === ts.SyntaxKind.ExportKeyword)
    ) {
      for (const d of node.declarationList.declarations) {
        if (ts.isIdentifier(d.name) && d.initializer &&
            (ts.isArrowFunction(d.initializer) || ts.isFunctionExpression(d.initializer))) {
          name = d.name.text;
          body = d.initializer.body;
        }
      }
    }
    if (name && body && /^[A-Z]/.test(name)) {
      const tokens = returnedRootTokens(body, sourceFile);
      if (tokens) {
        const selfBounded = [...tokens].some(isHeightBound);
        const hungry =
          (!selfBounded && hasScrollToken(tokens)) ||
          (!selfBounded && [...tokens].some((t) => base(t) === "flex-1" || base(t) === "flex-auto"));
        if (hungry) heightHungry.set(name, true);
      }
    }
    ts.forEachChild(node, visit1);
  };
  visit1(sourceFile);
}

// ── Rules ─────────────────────────────────────────────────────────────────

function checkElement(el, opening, tokens, chain, file) {
  const line = file.sourceFile.getLineAndCharacterOfPosition(opening.getStart()).line + 1;

  // Rule 1: clipper with an unbounded scroll descendant.
  if ([...tokens].some(isClipToken)) {
    const isFlexOrGrid = [...tokens].some(isFlexDisplay);
    const isRelative = tokens.has("relative");
    const ancestorScrolls = chain.slice(0, -1).some((a) => {
      const op = ts.isJsxElement(a) ? a.openingElement : a;
      return hasScrollToken(classNameTokens(op));
    });
    if (!isFlexOrGrid && !isRelative && !ancestorScrolls) {
      const offenders = [];
      for (const d of descendantElements(el)) {
        const op = ts.isJsxElement(d) ? d.openingElement : d;
        const dt = classNameTokens(op);
        const selfBounded = [...dt].some(isHeightBound);
        if (hasScrollToken(dt) && !selfBounded) {
          const dl = file.sourceFile.getLineAndCharacterOfPosition(op.getStart()).line + 1;
          offenders.push(`line ${dl} (inline)`);
        }
        // Child component whose root renders an unbounded scroll area.
        if (op.tagName.kind === ts.SyntaxKind.Identifier) {
          const cname = op.tagName.text;
          if (heightHungry.get(cname)) {
            const dl = file.sourceFile.getLineAndCharacterOfPosition(op.getStart()).line + 1;
            offenders.push(`line ${dl} (<${cname} /> renders an unbounded scroll root)`);
          }
        }
      }
      if (offenders.length) {
        errors.push(
          `${file.path}:${line} — overflow-hidden wrapper is NOT a flex container or relative, and contains ` +
            `unbounded scroll area(s) at line(s) ${offenders.join(", ")}. The scroll element's flex-1 is ignored ` +
            `inside a plain block, so it grows with its content and clips with NO scrollbar (medicines-list bug). ` +
            `Fix: make the wrapper "flex min-h-0 flex-1 flex-col overflow-hidden", or size the scroll area with ` +
            `"relative" + "absolute inset-0", or bound it with max-h-*. Then add a comment on the wrapper ` +
            `documenting the height contract.`,
        );
      }
    }
  }

  // Rule 2: fixed overlay whose child card clips without a height bound.
  if (tokens.has("fixed")) {
    const parentIsFlex = [...tokens].some(isFlexDisplay);
    for (const child of elementChildren(el)) {
      const cop = ts.isJsxElement(child) ? child.openingElement : child;
      const ct = classNameTokens(cop);
      const clips = [...ct].some(isClipToken);
      const bounded =
        [...ct].some(isHeightBound) ||
        [...ct].some(isFlexDisplay) ||
        [...ct].some(isScrollToken) || // a scroll area inside is self-managing
        // flex-1 child of a flex overlay is bounded by the flex chain
        (parentIsFlex && [...ct].some((t) => base(t) === "flex-1"));
      if (clips && !bounded) {
        const cl = file.sourceFile.getLineAndCharacterOfPosition(cop.getStart()).line + 1;
        errors.push(
          `${file.path}:${cl} — child of a fixed overlay has overflow-hidden with no height bound ` +
            `(no max-h-*/h-full/flex layout). It grows with its content and clips past the viewport ` +
            `(setup-wizard bug: footer buttons unreachable). Fix: "flex max-h-[calc(100vh-2rem)] flex-col ` +
            `overflow-hidden" with a scrollable body, or add max-h-*/h-full. Then add a comment documenting ` +
            `the height contract.`,
        );
      }
    }
  }
}

// ── File discovery ────────────────────────────────────────────────────────

function collectTsx(dir, out = []) {
  for (const entry of readdirSync(dir)) {
    const p = join(dir, entry);
    if (statSync(p).isDirectory()) collectTsx(p, out);
    else if (p.endsWith(".tsx")) out.push(p);
  }
  return out;
}

let files = [];
const sources = [];
try {
  files = collectTsx(ROOT);
} catch {
  console.error(`scroll-layout: cannot read ${ROOT} (run from the repo root)`);
  process.exit(2);
}

for (const path of files) {
  const sourceFile = ts.createSourceFile(path, readFileSync(path, "utf8"), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  classifyComponents(sourceFile, path);
  sources.push({ path, sourceFile });
}

for (const { path, sourceFile } of sources) {
  visit(sourceFile, undefined, { path, sourceFile }, []);
}

if (errors.length) {
  console.error(`\nscroll-layout guard: ${errors.length} problem(s) found\n`);
  for (const e of errors) console.error("  ✗ " + e + "\n");
  console.error(
    "These layouts clip their content with no scrollbar when it grows taller than the window.",
  );
  process.exit(1);
}

console.log(`scroll-layout guard: OK (${files.length} files checked)`);
