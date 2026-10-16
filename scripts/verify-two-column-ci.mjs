#!/usr/bin/env node
// Read-only assertions over an EXISTING `dist/` (the CI workflow builds first,
// so this never re-runs tsc/vite — those are separate, cheaper steps).
//
// Why this exists: the prescription print module is runtime-selected
// (`route.name === "patient-prescription"` in app.tsx, and
// `data.template === "two-column"` inside the sheet renderer), so Rollup can
// in principle prune it even though it is reachable. app.tsx imports
// PrescriptionPrintView statically and prescription-sheet.tsx side-effect-imports
// template-shake.mjs to keep the template bodies in the graph — these checks
// assert that actually held in the produced bundle instead of trusting it.

import fs from "node:fs";
import path from "node:path";

let failures = 0;
function check(name, run) {
  try {
    const ok = run();
    console.log(`[${ok ? "PASS" : "FAIL"}] ${name}`);
    if (!ok) failures++;
  } catch (e) {
    console.log(`[FAIL] ${name} — ${e && e.message ? e.message : e}`);
    failures++;
  }
}

function distChunks() {
  const dir = "dist/assets";
  if (!fs.existsSync(dir)) throw new Error("dist/assets missing — run the build first");
  return fs.readdirSync(dir).filter((f) => f.endsWith(".js"));
}

check("dist has an index-*.js entry chunk", () => {
  const html = fs.readFileSync("dist/index.html", "utf8");
  const entry = html.match(/assets\/(index-[A-Za-z0-9_-]+\.js)/);
  console.log(`   -> entry chunk: ${entry ? entry[1] : "NONE"}`);
  return Boolean(entry);
});

check("patient-prescription print route is present in the bundle", () => {
  const chunks = distChunks();
  const hits = chunks.filter((f) =>
    fs.readFileSync(path.join("dist/assets", f), "utf8").includes("patient-prescription"),
  );
  console.log(`   -> chunks containing the route: ${hits.length ? hits.join(", ") : "NONE"}`);
  return hits.length > 0;
});

check("two-column template string is present in the bundle", () => {
  // String literals survive minification (identifier names do not), so the
  // template id is the reliable marker that the template registry and the
  // runtime-selected template bodies shipped.
  const chunks = distChunks();
  const hits = chunks.filter((f) =>
    fs.readFileSync(path.join("dist/assets", f), "utf8").includes("two-column"),
  );
  console.log(`   -> chunks containing "two-column": ${hits.length ? hits.join(", ") : "NONE"}`);
  return hits.length > 0;
});

check("template-shake side-effect import keeps template symbols alive in source", () => {
  const sheet = fs.readFileSync("src/client/components/prescriptions/prescription-sheet.tsx", "utf8");
  const shake = fs.readFileSync("src/client/components/prescriptions/template-shake.mjs", "utf8");
  const sheetHas = sheet.includes('import "./template-shake.mjs"');
  const shakeHas =
    shake.includes("TwoColumnSheet") &&
    shake.includes("ChamberSheet") &&
    shake.includes("Watermark");
  return sheetHas && shakeHas;
});

check("committed source is internally consistent (template registry + route)", () => {
  const sheet = fs.readFileSync("src/client/components/prescriptions/prescription-sheet.tsx", "utf8");
  const types = fs.readFileSync("src/client/types.ts", "utf8");
  const printView = fs.readFileSync("src/client/components/prescriptions/prescription-print-view.tsx", "utf8");
  const app = fs.readFileSync("src/client/app.tsx", "utf8");
  const ids = [
    "chamber", "classic", "modern", "compact",
    "elegant", "minimal", "bold", "watermark", "two-column",
  ];
  return (
    ids.every((id) => sheet.includes(`"${id}"`)) &&
    sheet.includes("TwoColumnSheet") &&
    types.includes('"two-column"') &&
    printView.includes('"two-column"') &&
    app.includes('"patient-prescription"')
  );
});

console.log("\n" + (failures === 0 ? "All checks passed." : `${failures} check(s) FAILED.`));
process.exit(failures === 0 ? 0 : 1);
