import { useMemo, useState } from "react";
import { ArrowDown, ArrowUp, Check, Pencil, Plus, Trash2 } from "lucide-react";
import { useApp } from "@/context";
import { api } from "@/api";
import { toast } from "@/components/ui/toast";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { cn } from "@/lib/utils";
import type { PrescriptionLayout, PrescriptionTemplate, PrescriptionTemplateId, RxTemplateConfig } from "@/types";
import {
  PRESCRIPTION_TEMPLATES,
  PrescriptionSheet,
  type PrescriptionSheetData,
} from "@/components/prescriptions/prescription-sheet";
import { TemplateThumbnail } from "@/components/prescriptions/template-picker";
import {
  RX_ACCENT_SWATCHES,
  RX_HEADER_SWATCHES,
  RX_SECTION_LABELS,
  baseRxConfig,
  loadPrescriptionLayouts,
  newRxConfig,
  usePrescriptionLayouts,
} from "@/lib/prescription-layouts";

/**
 * Settings → Rx templates: the gallery of built-in prescription layouts, each
 * of which can be customized into the doctor's own template, plus the practice's
 * saved templates (edit / delete). A custom template is data — layout, palette,
 * typography and which clinical blocks print — rendered by CustomSheet, so it
 * flows into the composer picker, preview, print, PDF and the share page.
 */

interface Draft {
  /** null = creating a new template. */
  id: number | null;
  name: string;
  base: PrescriptionTemplate;
  config: RxTemplateConfig;
}

export function RxTemplatesTab() {
  const app = useApp();
  const layouts = usePrescriptionLayouts();
  const [draft, setDraft] = useState<Draft | null>(null);
  const [busyId, setBusyId] = useState<number | null>(null);

  function customize(base: PrescriptionTemplate, label: string) {
    setDraft({
      id: null,
      name: `${label} (mine)`,
      base,
      config: baseRxConfig(base),
    });
  }

  function createNew() {
    setDraft({ id: null, name: "My prescription template", base: "chamber", config: newRxConfig() });
  }

  function edit(layout: PrescriptionLayout) {
    setDraft({
      id: layout.id,
      name: layout.name,
      base: layout.based_on,
      config: layout.config,
    });
  }

  async function remove(layout: PrescriptionLayout) {
    if (
      !window.confirm(
        `Delete “${layout.name}”? Prescriptions already printed with it fall back to the Chamber layout. This cannot be undone.`,
      )
    ) {
      return;
    }
    setBusyId(layout.id);
    try {
      await api("DELETE", `/api/prescription-layouts/${layout.id}`);
      await loadPrescriptionLayouts(true);
      toast.success(`Deleted “${layout.name}”`);
    } catch (err) {
      app.setError((err as Error).message);
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader className="flex flex-row items-start justify-between gap-3 space-y-0">
          <div>
            <CardTitle className="text-base">Prescription templates</CardTitle>
            <p className="mt-1 text-sm text-muted-foreground">
              Build the sheet your patients take home: the structure, the colors, and which clinical blocks print.
              Customize any built-in below, or start from a blank template.
            </p>
          </div>
          <Button type="button" size="sm" onClick={createNew} className="shrink-0 gap-1.5">
            <Plus className="h-4 w-4" /> New template
          </Button>
        </CardHeader>
        <CardContent className="space-y-6">
          <div>
            <Label className="text-xs uppercase tracking-wider text-muted-foreground">Built-in layouts</Label>
            <div className="mt-2 grid gap-3 sm:grid-cols-3 lg:grid-cols-5">
              {PRESCRIPTION_TEMPLATES.map((t) => (
                <div key={t.id} className="rounded-lg border bg-card p-2 shadow-sm">
                  <div className="flex justify-center">
                    <TemplateThumbnail template={t.id} width={104} />
                  </div>
                  <div className="mt-2 flex items-center justify-between gap-1">
                    <span className="text-sm font-medium">{t.label}</span>
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      className="h-7 gap-1 px-2 text-xs"
                      onClick={() => customize(t.id, t.label)}
                    >
                      <Pencil className="h-3.5 w-3.5" /> Edit
                    </Button>
                  </div>
                  <p className="mt-0.5 line-clamp-2 text-xs text-muted-foreground">{t.blurb}</p>
                </div>
              ))}
            </div>
            <p className="mt-2 text-xs text-muted-foreground">
              Editing a built-in saves your own copy — the original stays available, and prescriptions already printed
              with it do not change.
            </p>
          </div>

          <div>
            <Label className="text-xs uppercase tracking-wider text-muted-foreground">Your templates</Label>
            {layouts.length === 0 ? (
              <p className="mt-2 rounded-lg border border-dashed p-4 text-sm text-muted-foreground">
                No custom templates yet. Pick “Edit” on a built-in, or start a new one — it appears in the prescription
                editor’s template picker as soon as you save it.
              </p>
            ) : (
              <ul className="mt-2 space-y-2">
                {layouts.map((layout) => (
                  <li
                    key={layout.id}
                    className="flex flex-wrap items-center gap-3 rounded-lg border bg-card p-2 shadow-sm"
                  >
                    <TemplateThumbnail
                      template={layout.slug as PrescriptionTemplateId}
                      config={layout.config}
                      width={52}
                    />
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-sm font-medium">{layout.name}</div>
                      <p className="text-xs text-muted-foreground">
                        {layout.config?.layout === "stacked" ? "Stacked page" : "Sidebar pad"} · from{" "}
                        {PRESCRIPTION_TEMPLATES.find((t) => t.id === layout.based_on)?.label ?? layout.based_on} · id{" "}
                        <code className="font-mono">{layout.slug}</code>
                      </p>
                    </div>
                    <div className="flex items-center gap-1">
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        className="h-8 gap-1"
                        onClick={() => edit(layout)}
                        disabled={busyId === layout.id}
                      >
                        <Pencil className="h-3.5 w-3.5" /> Edit
                      </Button>
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        className="h-8 gap-1 text-destructive hover:text-destructive"
                        onClick={() => remove(layout)}
                        disabled={busyId === layout.id}
                      >
                        <Trash2 className="h-3.5 w-3.5" /> Delete
                      </Button>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </CardContent>
      </Card>

      {draft && (
        <RxTemplateEditor
          draft={draft}
          onClose={() => setDraft(null)}
          onSaved={async (name) => {
            setDraft(null);
            await loadPrescriptionLayouts(true);
            toast.success(`Saved “${name}” — it is now in the template picker.`);
          }}
        />
      )}
    </div>
  );
}

// ── Editor ──────────────────────────────────────────────────────────

function RxTemplateEditor({
  draft,
  onClose,
  onSaved,
}: {
  draft: Draft;
  onClose: () => void;
  onSaved: (name: string) => Promise<void> | void;
}) {
  const app = useApp();
  const [name, setName] = useState(draft.name);
  const [config, setConfig] = useState<RxTemplateConfig>(draft.config);
  const [saving, setSaving] = useState(false);

  function patch(p: Partial<RxTemplateConfig>) {
    setConfig((c) => ({ ...c, ...p }));
  }

  /** The live A4 preview uses the doctor's real letterhead plus sample clinical data. */
  const previewData: PrescriptionSheetData = useMemo(
    () => ({
      clinic_name: app.profile.clinic_name || "Bright Smile Dental",
      clinic_address: app.profile.clinic_address || "123 Main St",
      clinic_phone: app.profile.doctor_phone || "+1 555 010 2030",
      clinic_logo: app.profile.clinic_logo || null,
      doctor_name: app.profile.doctor_name || "Sarah",
      doctor_specialty: app.profile.doctor_specialty || "Dentist",
      doctor_license: app.profile.doctor_license || "DDS-102938",
      patient_name: "Jane Cooper",
      patient_id: 42,
      patient_age: "32 yrs",
      patient_gender: "F",
      issued_date: new Date().toISOString().slice(0, 10),
      template: draft.id ? (`custom-${draft.id}` as PrescriptionTemplateId) : "chamber",
      template_config: config,
      diagnosis: "Periapical abscess, tooth 36",
      on_examination: "Deep caries, 36; tender to percussion",
      history: "Pain for 5 days, worse at night",
      advice: "Warm salt-water rinses. Soft diet for 48 hours.",
      follow_up: "Recheck in 2 weeks",
      tooth: "36",
      complaints: { items: [{ label: "Toothache", duration: "5 days", site: "lower left" }] },
      investigations: { items: [{ label: "IOPA 36", result: "Periapical radiolucency" }] },
      vitals: { bp: "120/80", temperature: "98.6°F", pulse: "78", spo2: "98%" },
      chamber_footer_instructions: app.profile.chamber_footer_instructions || null,
      items: [
        { drug_name: "Amoxicillin", dosage: "500 mg", frequency: "3x daily", duration: "5 days", instructions: "after meals" },
        { drug_name: "Ibuprofen", dosage: "400 mg", frequency: "as needed", duration: "3 days", instructions: null },
      ],
    }),
    [app.profile, config, draft.id],
  );

  async function save() {
    const trimmed = name.trim();
    if (!trimmed) {
      app.setError("Give the template a name.");
      return;
    }
    setSaving(true);
    try {
      const body = { name: trimmed, base: draft.base, config };
      if (draft.id === null) {
        await api("POST", "/api/prescription-layouts", body);
      } else {
        await api("PUT", `/api/prescription-layouts/${draft.id}`, body);
      }
      await onSaved(trimmed);
    } catch (err) {
      app.setError((err as Error).message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="flex max-h-[92vh] w-[min(96vw,1000px)] max-w-none flex-col overflow-hidden p-0">
        <DialogHeader className="border-b px-5 py-3">
          <DialogTitle className="text-base">
            {draft.id === null ? "New prescription template" : `Edit “${draft.name}”`}
          </DialogTitle>
          <DialogDescription className="text-xs">
            The preview is the real A4 sheet — what prints, downloads as PDF and opens from a share link.
          </DialogDescription>
        </DialogHeader>

        <div className="grid min-h-0 flex-1 overflow-hidden lg:grid-cols-[minmax(0,1fr)_400px]">
          <div className="min-h-0 space-y-4 overflow-auto px-5 py-4">
            <div className="space-y-1.5">
              <Label className="text-xs">Template name</Label>
              <Input value={name} onChange={(e) => setName(e.target.value)} maxLength={60} placeholder="e.g. Kids letterhead" />
            </div>

            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label className="text-xs">Structure</Label>
                <Select
                  value={config.layout}
                  onValueChange={(v) => patch({ layout: v as RxTemplateConfig["layout"] })}
                >
                  <SelectTrigger className="h-9">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="sidebar">Sidebar pad — clinical column + ℞ panel</SelectItem>
                    <SelectItem value="stacked">Stacked page — full-width ℞</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs">Typeface</Label>
                <Select value={config.font} onValueChange={(v) => patch({ font: v as RxTemplateConfig["font"] })}>
                  <SelectTrigger className="h-9">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="sans">Sans — Inter / system</SelectItem>
                    <SelectItem value="serif">Serif — Georgia</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="rounded-lg border p-3">
              <Label className="text-xs">Start from a built-in</Label>
              <p className="mt-0.5 text-xs text-muted-foreground">
                Loads that layout’s colors, typeface and structure as the starting point.
              </p>
              <div className="mt-2 flex flex-wrap gap-1.5">
                {PRESCRIPTION_TEMPLATES.map((t) => (
                  <Button
                    key={t.id}
                    type="button"
                    variant="outline"
                    size="sm"
                    className="h-7 rounded-full px-2.5 text-xs"
                    onClick={() => setConfig(baseRxConfig(t.id))}
                  >
                    {t.label}
                  </Button>
                ))}
              </div>
            </div>

            <ColorRow
              label="Accent"
              hint="Rules, ℞, numbering and the sidebar tint."
              value={config.accent}
              swatches={RX_ACCENT_SWATCHES}
              onChange={(accent) => patch({ accent })}
            />
            <ColorRow
              label="Letterhead background"
              hint="The band behind the clinic name."
              value={config.header_bg}
              swatches={RX_HEADER_SWATCHES}
              onChange={(header_bg) => patch({ header_bg })}
            />
            <ColorRow
              label="Letterhead text"
              hint="Clinic and doctor names on the band."
              value={config.header_text}
              swatches={["#ffffff", "#0f172a", "#14532d", "#0e7490", "#7c2d12", "#111827"] as const}
              onChange={(header_text) => patch({ header_text })}
            />

            <div className="rounded-lg border p-3">
              <Label className="text-xs">Sheet details</Label>
              <div className="mt-2 space-y-2">
                <Switch label="Rule under the letterhead" checked={config.show_rule} onChange={(v) => patch({ show_rule: v })} />
                <Switch label="Print the clinic logo" checked={config.show_logo} onChange={(v) => patch({ show_logo: v })} />
                <Switch
                  label="Tooth watermark behind the ℞ panel"
                  checked={config.show_watermark}
                  onChange={(v) => patch({ show_watermark: v })}
                />
                <Switch label="Signature line" checked={config.show_signature} onChange={(v) => patch({ show_signature: v })} />
                <Switch
                  label="Bangla sub-labels beside each heading"
                  hint="Chamber-pad style; only used by the sidebar structure."
                  checked={config.show_bangla}
                  disabled={config.layout !== "sidebar"}
                  onChange={(v) => patch({ show_bangla: v })}
                />
              </div>
            </div>

            <div className="rounded-lg border p-3">
              <Label className="text-xs">Clinical blocks</Label>
              <p className="mt-0.5 text-xs text-muted-foreground">
                Print order, top to bottom. Unticked blocks are left off the sheet.
              </p>
              <ul className="mt-2 space-y-1.5">
                {config.sections.map((section, i) => (
                  <li key={section.key} className="flex items-center gap-2 rounded-md border bg-card/60 px-2 py-1.5">
                    <label className="flex items-center gap-2 text-xs">
                      <input
                        type="checkbox"
                        checked={section.enabled}
                        onChange={(e) => {
                          const sections = config.sections.map((s, idx) =>
                            idx === i ? { ...s, enabled: e.target.checked } : s,
                          );
                          patch({ sections });
                        }}
                        className="h-3.5 w-3.5 rounded border-input accent-primary"
                        aria-label={`Print ${RX_SECTION_LABELS[section.key]}`}
                      />
                    </label>
                    <span className={cn("w-40 shrink-0 text-xs", !section.enabled && "text-muted-foreground line-through")}>
                      {RX_SECTION_LABELS[section.key]}
                    </span>
                    <Input
                      value={section.label}
                      onChange={(e) => {
                        const sections = config.sections.map((s, idx) =>
                          idx === i ? { ...s, label: e.target.value.slice(0, 40) } : s,
                        );
                        patch({ sections });
                      }}
                      placeholder="Heading (optional)"
                      className="h-7 flex-1 text-xs"
                    />
                    <div className="flex shrink-0 items-center">
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        className="h-7 w-7"
                        aria-label="Move up"
                        disabled={i === 0}
                        onClick={() => {
                          const sections = [...config.sections];
                          [sections[i - 1], sections[i]] = [sections[i], sections[i - 1]];
                          patch({ sections });
                        }}
                      >
                        <ArrowUp className="h-3.5 w-3.5" />
                      </Button>
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        className="h-7 w-7"
                        aria-label="Move down"
                        disabled={i === config.sections.length - 1}
                        onClick={() => {
                          const sections = [...config.sections];
                          [sections[i + 1], sections[i]] = [sections[i], sections[i + 1]];
                          patch({ sections });
                        }}
                      >
                        <ArrowDown className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                  </li>
                ))}
              </ul>
            </div>

            <div className="space-y-1.5">
              <Label className="text-xs">Footer note</Label>
              <Textarea
                rows={2}
                value={config.footer_note}
                maxLength={600}
                onChange={(e) => patch({ footer_note: e.target.value })}
                placeholder="e.g. In case of bleeding or fever, call +1 555 010 2030"
              />
              <p className="text-xs text-muted-foreground">
                Printed under the practice contact line. Empty = the practice footer instructions from Profile.
              </p>
            </div>
          </div>

          <div className="hidden min-h-0 flex-col items-center gap-2 overflow-auto border-l bg-muted/40 px-4 py-4 lg:flex">
            <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Live preview</span>
            <SheetPreview data={previewData} />
          </div>
        </div>

        <DialogFooter className="border-t px-5 py-3">
          <Button type="button" variant="outline" onClick={onClose} disabled={saving}>
            Cancel
          </Button>
          <Button type="button" onClick={save} disabled={saving} className="gap-1.5">
            <Check className="h-4 w-4" /> {saving ? "Saving…" : draft.id === null ? "Save template" : "Save changes"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** Full A4 sheet scaled to the editor’s preview column. */
function SheetPreview({ data }: { data: PrescriptionSheetData }) {
  const width = 360;
  return (
    <div
      className="overflow-hidden rounded-md border bg-white shadow-md"
      style={{ width, height: Math.round(width * 1.414) }}
      aria-label="Prescription preview"
    >
      <div style={{ width: "210mm", transformOrigin: "top left", transform: `scale(${width / (210 * 3.7795)})` }}>
        <PrescriptionSheet data={data} />
      </div>
    </div>
  );
}

function ColorRow({
  label,
  hint,
  value,
  swatches,
  onChange,
}: {
  label: string;
  hint: string;
  value: string;
  swatches: readonly string[];
  onChange: (hex: string) => void;
}) {
  return (
    <div className="rounded-lg border p-3">
      <div className="flex items-baseline justify-between gap-2">
        <Label className="text-xs">{label}</Label>
        <span className="font-mono text-xs text-muted-foreground">{value}</span>
      </div>
      <p className="mt-0.5 text-xs text-muted-foreground">{hint}</p>
      <div className="mt-2 flex flex-wrap items-center gap-1.5">
        {swatches.map((hex) => (
          <button
            key={hex}
            type="button"
            onClick={() => onChange(hex)}
            aria-label={hex}
            aria-pressed={value.toLowerCase() === hex.toLowerCase()}
            className={cn(
              "h-7 w-7 rounded-full border transition-transform hover:scale-110",
              value.toLowerCase() === hex.toLowerCase() && "ring-2 ring-primary ring-offset-2 ring-offset-background",
            )}
            style={{ background: hex }}
          />
        ))}
        <label className="ml-1 inline-flex cursor-pointer items-center gap-2 text-xs text-muted-foreground">
          Custom
          <input
            type="color"
            value={value}
            onChange={(e) => onChange(e.target.value)}
            className="h-8 w-10 cursor-pointer rounded border bg-background"
            aria-label={`${label} custom color`}
          />
        </label>
      </div>
    </div>
  );
}

function Switch({
  label,
  hint,
  checked,
  onChange,
  disabled,
}: {
  label: string;
  hint?: string;
  checked: boolean;
  onChange: (v: boolean) => void;
  disabled?: boolean;
}) {
  return (
    <div className="flex items-start justify-between gap-3">
      <div className="min-w-0">
        <div className="text-sm">{label}</div>
        {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
      </div>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        aria-label={label}
        disabled={disabled}
        onClick={() => onChange(!checked)}
        className={cn(
          "relative inline-flex h-5 w-9 shrink-0 items-center rounded-full transition-colors disabled:opacity-40",
          checked ? "bg-primary" : "bg-muted-foreground/30",
        )}
      >
        <span
          className={cn(
            "inline-block h-3.5 w-3.5 rounded-full bg-background shadow transition-transform",
            checked ? "translate-x-[1.15rem]" : "translate-x-1",
          )}
        />
      </button>
    </div>
  );
}
