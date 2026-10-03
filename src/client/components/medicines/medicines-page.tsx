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
      {/* The tab sizes itself with absolute inset-0 (see below), which only
          needs THIS element to be position:relative — its height no longer
          depends on the flex/height chain above it at all. (Two earlier
          flex-only fixes still failed to scroll on some Windows installs.) */}
      <div className="relative min-h-0 flex-1 overflow-hidden">
        <MedicinesTab />
      </div>
    </div>
  );
}