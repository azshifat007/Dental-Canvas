import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { Pill } from "lucide-react";
import { MedicinesTab } from "./medicines-tab";
/**
 * The practice's medicine formulary (Medicines). Entries here feed the drug
 * autocomplete when writing prescriptions and survive redeploys (database).
 */
export function MedicinesPage() {
    return (_jsxs("div", { className: "flex flex-1 flex-col overflow-hidden", children: [_jsxs("div", { className: "flex flex-wrap items-center gap-3 border-b bg-card px-4 py-3", children: [_jsxs("h1", { className: "flex items-center gap-2 text-lg font-semibold tracking-tight", children: [_jsx(Pill, { className: "h-5 w-5" }), " Medicines"] }), _jsx("p", { className: "hidden text-sm text-muted-foreground sm:block", children: "The drugs your practice prescribes \u2014 they power the prescription editor's suggestions." })] }), _jsx("div", { className: "relative min-h-0 flex-1 overflow-y-auto", children: _jsx(MedicinesTab, {}) })] }));
}
