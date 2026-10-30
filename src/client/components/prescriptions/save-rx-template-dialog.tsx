import { useEffect, useState } from "react";
import { BookmarkPlus, Check, Loader2, Pill, Stethoscope, MessageSquareText } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "@/components/ui/toast";
import { saveRxClinicalTemplate, suggestedTemplateName } from "@/lib/rx-clinical-templates";
import type { RxClinicalTemplate, RxTemplateSource } from "@/types";

/**
 * "Save as template" for an open prescription.
 *
 * A finished Rx is the practice's real protocol — the medications, the advice,
 * the diagnosis wording — so it can be kept as a reusable clinical template in
 * one step: the name is prefilled from the Rx, and saving puts the template in
 * every prescription's "Use template" menu. Only clinical content is stored;
 * the patient, tooth, date and x-rays stay with the original Rx.
 */

export function SaveRxTemplateDialog({
  open,
  onOpenChange,
  source,
  defaultName,
  onSaved,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  source: RxTemplateSource;
  /** Overrides the auto-suggested name (e.g. an existing template's name). */
  defaultName?: string;
  onSaved?: (template: RxClinicalTemplate) => void;
}) {
  const suggested = defaultName?.trim() || suggestedTemplateName(source);
  const [name, setName] = useState(suggested);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Re-seed the field each time the dialog opens for a (possibly different) Rx.
  useEffect(() => {
    if (open) {
      setName(suggested);
      setError(null);
    }
  }, [open, suggested]);

  const meds = source.items.filter((i) => i.drug_name.trim());
  const carries = [
    meds.length ? { icon: Pill, text: `${meds.length} medication${meds.length === 1 ? "" : "s"}` } : null,
    source.diagnosis?.trim() ? { icon: Stethoscope, text: "Diagnosis, O/E & H/O" } : null,
    source.advice?.trim() ? { icon: MessageSquareText, text: "Advice" } : null,
  ].filter(Boolean) as { icon: typeof Pill; text: string }[];

  async function save(e: React.FormEvent) {
    e.preventDefault();
    const trimmed = name.trim();
    if (!trimmed) {
      setError("Give the template a name.");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const saved = await saveRxClinicalTemplate(trimmed, source);
      toast.success(`Saved “${saved.name}” — it is now in Use template on every prescription.`);
      onSaved?.(saved);
      onOpenChange(false);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="text-base">Save as template</DialogTitle>
          <DialogDescription className="text-xs">
            Keep this prescription’s clinical content to pre-fill future ones. The patient, tooth and date are not
            saved.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={save} className="space-y-3">
          <div className="space-y-1.5">
            <Label className="text-xs">Template name</Label>
            <Input
              value={name}
              onChange={(e) => setName(e.target.value)}
              maxLength={120}
              placeholder="e.g. Post-extraction protocol"
              autoFocus
              onFocus={(e) => e.currentTarget.select()}
            />
          </div>

          <div className="rounded-lg border bg-muted/30 p-3">
            <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">What is saved</p>
            {carries.length === 0 ? (
              <p className="mt-1 text-sm text-muted-foreground">Add a medication or some advice first.</p>
            ) : (
              <ul className="mt-2 space-y-1.5">
                {carries.map(({ icon: Icon, text }) => (
                  <li key={text} className="flex items-center gap-2 text-sm">
                    <Icon className="h-3.5 w-3.5 shrink-0 text-teal-600 dark:text-teal-400" aria-hidden />
                    {text}
                  </li>
                ))}
              </ul>
            )}
            {meds.length > 0 && (
              <p className="mt-2 line-clamp-2 text-xs text-muted-foreground">
                {meds.map((m) => m.drug_name).join(", ")}
              </p>
            )}
          </div>

          {error && <p className="text-xs text-rose-600 dark:text-rose-400">{error}</p>}

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>
              Cancel
            </Button>
            <Button type="submit" disabled={saving || meds.length === 0} className="gap-1.5">
              {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
              {saving ? "Saving…" : "Save template"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/**
 * The one-button entry point: "Save as template" on an open prescription,
 * anywhere the doctor is looking at one.
 */
export function SaveRxTemplateButton({
  source,
  defaultName,
  label = "Save as template",
  className,
  variant = "outline",
  size = "sm",
  title = "Keep this prescription’s medications, advice and clinical notes as a reusable template",
  onSaved,
}: {
  source: RxTemplateSource;
  defaultName?: string;
  label?: string;
  className?: string;
  variant?: "default" | "outline" | "secondary" | "ghost";
  size?: "default" | "sm" | "lg" | "icon";
  title?: string;
  onSaved?: (template: RxClinicalTemplate) => void;
}) {
  const [open, setOpen] = useState(false);
  const hasContent = source.items.some((i) => i.drug_name.trim());

  return (
    <>
      <Button
        type="button"
        variant={variant}
        size={size}
        className={className}
        onClick={() => setOpen(true)}
        disabled={!hasContent}
        title={hasContent ? title : "Add a medication first — a template needs something to reuse"}
      >
        <BookmarkPlus className="h-4 w-4" />
        {label}
      </Button>
      {open && (
        <SaveRxTemplateDialog
          open={open}
          onOpenChange={setOpen}
          source={source}
          defaultName={defaultName}
          onSaved={onSaved}
        />
      )}
    </>
  );
}
