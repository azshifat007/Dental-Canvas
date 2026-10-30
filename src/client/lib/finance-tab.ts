/**
 * Finance is one nav destination with three views — Billing Record, Revenue
 * Breakdown and Appointment Overview — and the view lives in the route, so a
 * reload or a deep link already lands on the right tab. What the route cannot
 * do is tell the nav where to go next: the rail has a single "Finance" entry,
 * which used to hard-code `/finance/billing-record` and so threw away the tab
 * the user was working in every time they came back from another page.
 *
 * This module remembers the last tab that was open. The nav entry asks for it;
 * everything else keeps using real routes.
 */

export type FinanceTab = "billing" | "revenue" | "appointments";

export const FINANCE_TAB_PATHS: Record<FinanceTab, string> = {
  billing: "/finance/billing-record",
  revenue: "/finance/revenue-breakdown",
  appointments: "/finance/appointment-overview",
};

const STORAGE_KEY = "dental-canvas:finance-tab";

function isFinanceTab(value: string | null): value is FinanceTab {
  return value === "billing" || value === "revenue" || value === "appointments";
}

export function rememberFinanceTab(tab: FinanceTab): void {
  try {
    localStorage.setItem(STORAGE_KEY, tab);
  } catch {
    /* private mode — the nav entry just falls back to Billing Record */
  }
}

/** Path the single Finance nav entry should open. */
export function lastFinanceTabPath(): string {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (isFinanceTab(saved)) return FINANCE_TAB_PATHS[saved];
  } catch {
    /* storage unavailable */
  }
  return FINANCE_TAB_PATHS.billing;
}
