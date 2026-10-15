import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { useMemo, useState } from "react";
import { Pencil, Plus, Pill, Search, Trash2 } from "lucide-react";
import { api } from "@/api";
import { useApp } from "@/context";
import { toast } from "@/components/ui/toast";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
const GROUPS = ["Antibiotic", "Analgesic", "Antifungal", "Antiviral", "Antiseptic rinse", "Other"];
const GROUP_STYLE = {
    Antibiotic: "bg-rose-100 text-rose-800 border-rose-200 dark:bg-rose-950 dark:text-rose-200 dark:border-rose-800",
    Analgesic: "bg-amber-100 text-amber-800 border-amber-200 dark:bg-amber-950 dark:text-amber-200 dark:border-amber-800",
    Antifungal: "bg-violet-100 text-violet-800 border-violet-200 dark:bg-violet-950 dark:text-violet-200 dark:border-violet-800",
    Antiviral: "bg-sky-100 text-sky-800 border-sky-200 dark:bg-sky-950 dark:text-sky-200 dark:border-sky-800",
    "Antiseptic rinse": "bg-teal-100 text-teal-800 border-teal-200 dark:bg-teal-950 dark:text-teal-200 dark:border-teal-800",
    Other: "bg-slate-100 text-slate-700 border-slate-200 dark:bg-slate-800 dark:text-slate-200 dark:border-slate-700",
};
const EMPTY_DRAFT = { name: "", drug_group: "Other", dosage: "", frequency: "", duration: "", instructions: "" };
/**
 * The practice's editable medicine list (Medicines). Additions and edits feed
 * the prescription editor's drug autocomplete, and the list survives redeploys
 * (it lives in the database, seeded only when empty).
 */
export function MedicinesTab() {
    const app = useApp();
    const [query, setQuery] = useState("");
    const [dialogOpen, setDialogOpen] = useState(false);
    const [editingId, setEditingId] = useState(null);
    const [draft, setDraft] = useState(EMPTY_DRAFT);
    const [busy, setBusy] = useState(false);
    const filtered = useMemo(() => {
        const q = query.trim().toLowerCase();
        if (!q)
            return app.medicines;
        return app.medicines.filter((m) => [m.name, m.drug_group, m.dosage, m.frequency, m.instructions].some((f) => (f ?? "").toLowerCase().includes(q)));
    }, [app.medicines, query]);
    function openAdd() {
        setEditingId(null);
        setDraft(EMPTY_DRAFT);
        setDialogOpen(true);
    }
    function openEdit(m) {
        setEditingId(m.id);
        setDraft({
            name: m.name,
            drug_group: m.drug_group || "Other",
            dosage: m.dosage ?? "",
            frequency: m.frequency ?? "",
            duration: m.duration ?? "",
            instructions: m.instructions ?? "",
        });
        setDialogOpen(true);
    }
    async function save(e) {
        e.preventDefault();
        if (!draft.name.trim())
            return;
        setBusy(true);
        try {
            const body = {
                name: draft.name.trim(),
                drug_group: draft.drug_group,
                dosage: draft.dosage.trim() || undefined,
                frequency: draft.frequency.trim() || undefined,
                duration: draft.duration.trim() || undefined,
                instructions: draft.instructions.trim() || undefined,
            };
            if (editingId) {
                await api("PUT", `/api/medicines/${editingId}`, body);
                toast.success(`${body.name} updated`);
            }
            else {
                await api("POST", "/api/medicines", body);
                toast.success(`${body.name} added to your medicine list`);
            }
            await app.refreshMedicines();
            setDialogOpen(false);
        }
        catch (err) {
            toast.error(err.message);
            app.setError(err.message);
        }
        finally {
            setBusy(false);
        }
    }
    async function remove(m) {
        if (!confirm(`Remove “${m.name}” from the medicine list? Prescriptions already issued keep their text.`))
            return;
        try {
            await api("DELETE", `/api/medicines/${m.id}`);
            await app.refreshMedicines();
            toast.success(`${m.name} removed`);
        }
        catch (err) {
            toast.error(err.message);
            app.setError(err.message);
        }
    }
    return (
    // Height comes from absolute inset-0 inside the relative wrapper in
    // medicines-page — a definite height that no ancestor flex quirk can
    // break (two flex-only fixes still didn't scroll on Windows).
    // force-scrollbar keeps the scrollbar visible at all times (Windows 11
    // overlay scrollbars otherwise hide until hover).
    _jsxs("div", { className: "force-scrollbar absolute inset-0 flex flex-col gap-3 overflow-y-auto p-4", children: [_jsxs("div", { className: "flex flex-wrap items-center gap-2", children: [_jsxs("div", { className: "relative w-64", children: [_jsx(Search, { className: "pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" }), _jsx(Input, { value: query, onChange: (e) => setQuery(e.target.value), placeholder: "Search medicines\u2026", className: "pl-8" })] }), _jsxs("span", { className: "text-sm text-muted-foreground", children: [app.medicines.length, " medicine", app.medicines.length === 1 ? "" : "s"] }), _jsxs(Button, { size: "sm", className: "ml-auto", onClick: openAdd, children: [_jsx(Plus, { className: "h-4 w-4" }), " Add medicine"] })] }), _jsx("p", { className: "text-sm text-muted-foreground", children: "This list feeds the medicine suggestions when writing a prescription. Presets include a standard adult regimen that fills the prescription row when picked \u2014 everything stays editable there." }), _jsx(Card, { className: "flex flex-col overflow-hidden", children: _jsx(CardContent, { className: "p-0", children: filtered.length === 0 ? (_jsxs("div", { className: "flex flex-col items-center gap-2 p-10 text-center text-muted-foreground", children: [_jsx(Pill, { className: "h-6 w-6" }), app.medicines.length === 0
                                ? "No medicines yet — add the drugs your practice prescribes most."
                                : "No medicines match that search."] })) : (_jsx("ul", { className: "divide-y", children: filtered.map((m) => {
                            const group = m.drug_group || "Other";
                            return (_jsxs("li", { className: "flex items-start gap-3 px-4 py-2.5 hover:bg-muted/40", children: [_jsxs("div", { className: "min-w-0 flex-1", children: [_jsxs("div", { className: "flex flex-wrap items-center gap-2", children: [_jsx("span", { className: "font-medium", children: m.name }), _jsx("span", { className: `rounded-full border px-2 py-0.5 text-[11px] font-semibold ${GROUP_STYLE[group] ?? GROUP_STYLE.Other}`, children: group })] }), (m.dosage || m.frequency || m.duration) && (_jsx("div", { className: "mt-0.5 text-sm text-muted-foreground", children: [m.dosage, m.frequency, m.duration ? `for ${m.duration}` : null].filter(Boolean).join(" · ") })), m.instructions && _jsx("div", { className: "mt-0.5 text-xs text-muted-foreground", children: m.instructions })] }), _jsxs("div", { className: "flex shrink-0 items-center gap-1 pt-0.5", children: [_jsx(Button, { variant: "ghost", size: "icon", className: "h-8 w-8", onClick: () => openEdit(m), "aria-label": `Edit ${m.name}`, children: _jsx(Pencil, { className: "h-4 w-4" }) }), _jsx(Button, { variant: "ghost", size: "icon", className: "h-8 w-8 text-muted-foreground hover:text-destructive", onClick: () => remove(m), "aria-label": `Remove ${m.name}`, children: _jsx(Trash2, { className: "h-4 w-4" }) })] })] }, m.id));
                        }) })) }) }), _jsx(Dialog, { open: dialogOpen, onOpenChange: setDialogOpen, children: _jsxs(DialogContent, { className: "sm:max-w-lg", children: [_jsx(DialogHeader, { children: _jsx(DialogTitle, { children: editingId ? "Edit medicine" : "Add medicine" }) }), _jsxs("form", { onSubmit: save, className: "grid gap-3", children: [_jsxs("div", { className: "space-y-1.5", children: [_jsx(Label, { className: "text-xs", children: "Name *" }), _jsx(Input, { value: draft.name, onChange: (e) => setDraft({ ...draft, name: e.target.value }), placeholder: "e.g. Amoxicillin 500mg caps", required: true, autoFocus: true })] }), _jsxs("div", { className: "space-y-1.5", children: [_jsx(Label, { className: "text-xs", children: "Group" }), _jsxs(Select, { value: draft.drug_group, onValueChange: (v) => setDraft({ ...draft, drug_group: v }), children: [_jsx(SelectTrigger, { children: _jsx(SelectValue, {}) }), _jsx(SelectContent, { children: GROUPS.map((g) => _jsx(SelectItem, { value: g, children: g }, g)) })] })] }), _jsxs("div", { className: "grid grid-cols-3 gap-3", children: [_jsxs("div", { className: "space-y-1.5", children: [_jsx(Label, { className: "text-xs", children: "Dosage" }), _jsx(Input, { value: draft.dosage, onChange: (e) => setDraft({ ...draft, dosage: e.target.value }), placeholder: "500 mg" })] }), _jsxs("div", { className: "space-y-1.5", children: [_jsx(Label, { className: "text-xs", children: "Frequency" }), _jsx(Input, { value: draft.frequency, onChange: (e) => setDraft({ ...draft, frequency: e.target.value }), placeholder: "3x daily" })] }), _jsxs("div", { className: "space-y-1.5", children: [_jsx(Label, { className: "text-xs", children: "Duration" }), _jsx(Input, { value: draft.duration, onChange: (e) => setDraft({ ...draft, duration: e.target.value }), placeholder: "5 days" })] })] }), _jsxs("div", { className: "space-y-1.5", children: [_jsx(Label, { className: "text-xs", children: "Instructions" }), _jsx(Textarea, { rows: 2, value: draft.instructions, onChange: (e) => setDraft({ ...draft, instructions: e.target.value }), placeholder: "e.g. after meals; avoid alcohol" })] }), _jsxs(DialogFooter, { children: [_jsx(Button, { type: "button", variant: "outline", onClick: () => setDialogOpen(false), children: "Cancel" }), _jsx(Button, { type: "submit", disabled: busy || !draft.name.trim(), children: busy ? "Saving…" : editingId ? "Save changes" : "Add to list" })] })] })] }) })] }));
}
