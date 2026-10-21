import { Pill } from "lucide-react";
import { MedicinesTab } from "./medicines-tab";

/**
 * The practice's medicine formulary (Medicines). Entries here feed the drug
 * autocomplete when writing prescriptions and survive redeploys (database).
 *
 * Height contract (do not "simplify" it away — this list has been reported as
 * non-scrolling four times, every time because one link in this chain broke):
 *
 *   main (flex column, overflow-hidden)
 *     └─ this root: flex-1 column, overflow-hidden  → gets a bounded height
 *          ├─ header: shrink-0
 *          └─ MedicinesTab: min-h-0 flex-1 → bounded, so ITS list scrolls
 *
 * Anything that reintroduces a plain `overflow-hidden` block between the two
 * `flex` links makes `flex-1` meaningless, and the list grows past the window
 * with no scrollbar. scripts/check-scroll-layout.mjs fails the build for that.
 */
export function MedicinesPage() {
  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
      <div className="flex shrink-0 flex-wrap items-center gap-3 border-b bg-card px-4 py-3">
        <h1 className="flex items-center gap-2 text-lg font-semibold tracking-tight">
          <Pill className="h-5 w-5" /> Medicines
        </h1>
        <p className="hidden text-sm text-muted-foreground sm:block">
          The drugs your practice prescribes — they power the prescription editor&apos;s suggestions.
        </p>
      </div>
      {/* No scroll container here: MedicinesTab owns the one scroll area (its
          list), so the search field and "Add medicine" stay put while the
          formulary scrolls. */}
      <MedicinesTab />
    </div>
  );
}
