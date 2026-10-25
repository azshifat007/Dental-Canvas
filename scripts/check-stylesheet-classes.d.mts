/** Types for the functions tests/stylesheet-classes.test.ts exercises. */

/** Class names appearing in a stylesheet, unescaped and deduplicated. */
export function classNames(css: string): Set<string>;

/** Selector (or at-rule prelude) text of every rule block, in source order. */
export function ruleSelectors(css: string): string[];
