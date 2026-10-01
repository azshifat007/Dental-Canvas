import { Pill } from "lucide-react";
import { MedicinesTab } from "./medicines-tab";

/**
 * The practice's medicine formulary (Medicines). Entries here feed the drug
 * autocomplete when writing prescriptions and survive redeploys (database).
 */
export function MedicinesPage() {
  return (
    <div className="flex flex-1 flex-col overflow-hidden">
      <div className="flex flex-wrap items-center gap-3 border-b bg-card px-4 py-3">
        <h1 className="flex items-center gap-2 text-lg font-semibold tracking-tight">
          <Pill className="h-5 w-5" /> Medicines
        </h1>
        <p className="hidden text-sm text-muted-foreground sm:block">
          The drugs your practice prescribes — they power the prescription editor&apos;s suggestions.
        </p>
      </div>
      {/* Must be a FLEX container, not a plain block: MedicinesTab's root is
          flex-1/min-h-0, which only bounds its height when the direct parent
          distributes vertical space. As a plain block the tab grew to its
          content height and overflow-hidden clipped it with no scrollbar. */}
      <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
        <MedicinesTab />
      </div>
    </div>
  );
}