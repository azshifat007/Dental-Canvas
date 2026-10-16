// Tree-shaking escape hatch for the prescription print templates.
//
// The template-specific sheet components are selected only at runtime
// (PrescriptionSheet branches on `data.template`), so Rollup's static
// reachability analysis cannot prove they are needed and prunes them from the
// production bundle. Importing them here as side-effect imports makes them
// module-level reachable, so the build keeps the two-column, chamber and
// watermark template bodies in the emitted JS (they remain runtime-selected,
// not eagerly rendered).
//
// This file is a `.mjs` so it is treated as a plain module by the bundler and
// does not pull in any React rendering side-effects — it only keeps the symbol
// graph alive.

import { TwoColumnSheet, ChamberSheet, Watermark } from "./prescription-sheet";

// Keep the re-exports alive at module scope so the side-effect is not stripped
// by dead-code elimination.
export const _ = { TwoColumnSheet, ChamberSheet, Watermark };
