import { useState } from "react";
import { BookmarkCheck, Loader2, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { toast } from "@/components/ui/toast";
import {
  deleteRxClinicalTemplate,
  templateSummary,
  useRxClinicalTemplates,
} from "@/lib/rx-clinical-templates";
import type { RxClinicalTemplate } from "@/types";

/**
 * "Use template": the practice's saved clinical templates, one click to
 * pre-fill the prescription being written. Deleting is offered inline because
 * a template is only useful while it is current (a drug replaced, a dose
 * changed) — without it a stale protocol would sit at the top of the list
 * forever.
 */
export function RxTemplateMenu({
  onApply,
  className,
  disabled,
}: {
  onApply: (template: RxClinicalTemplate) => void;
  className?: string;
  disabled?: boolean;
}) {
  const templates = useRxClinicalTemplates();
  const [busyId, setBusyId] = useState<number | null>(null);

  async function remove(t: RxClinicalTemplate) {
    if (!window.confirm(`Delete the template “${t.name}”? Prescriptions already issued are not affected.`)) return;
    setBusyId(t.id);
    try {
      await deleteRxClinicalTemplate(t.id);
      toast.success(`Deleted “${t.name}”`);
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setBusyId(null);
    }
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button type="button" variant="outline" size="sm" className={className} disabled={disabled}>
          <BookmarkCheck className="h-4 w-4" />
          Use template
          {templates.length > 0 && (
            <span className="rounded-full bg-muted px-1.5 text-xs tabular-nums text-muted-foreground">
              {templates.length}
            </span>
          )}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-80">
        <DropdownMenuLabel className="text-xs uppercase tracking-wider text-muted-foreground">
          Saved templates
        </DropdownMenuLabel>
        {templates.length === 0 ? (
          <p className="px-2 py-3 text-xs text-muted-foreground">
            None yet. Open a finished prescription and choose “Save as template” to keep its medications and advice.
          </p>
        ) : (
          templates.map((t) => (
            <div key={t.id} className="flex items-center gap-1">
              <DropdownMenuItem
                onSelect={() => onApply(t)}
                className="min-w-0 flex-1 flex-col items-start gap-0.5 py-2"
              >
                <span className="w-full truncate text-sm font-medium">{t.name}</span>
                <span className="text-xs text-muted-foreground">{templateSummary(t)}</span>
              </DropdownMenuItem>
              <DropdownMenuItem
                onSelect={(e) => {
                  // Keep the menu's selection model out of the delete action.
                  e.preventDefault();
                  void remove(t);
                }}
                disabled={busyId === t.id}
                aria-label={`Delete ${t.name}`}
                title={`Delete ${t.name}`}
                className="shrink-0 px-2 text-muted-foreground focus:text-destructive"
              >
                {busyId === t.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Trash2 className="h-3.5 w-3.5" />}
              </DropdownMenuItem>
            </div>
          ))
        )}
        <DropdownMenuSeparator />
        <p className="px-2 py-1.5 text-[11px] leading-snug text-muted-foreground">
          Applying a template fills the medications, advice and clinical notes — edit anything before saving.
        </p>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
