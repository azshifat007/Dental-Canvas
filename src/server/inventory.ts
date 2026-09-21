import { query, get, run } from "./db";
import { DEFAULT_INVENTORY_SETTINGS } from "./seed";

/**
 * Inventory support module.
 *
 * The daily "cron" for this serverless app is client-orchestrated the same way
 * as the auto-backup timer (`src/client/hooks/use-auto-backup.ts`): the app
 * shell calls POST /api/inventory/scan once per session while the schedule is
 * due and records the run in localStorage. The scan itself lives **here**, as a
 * pure server-side pass over the inventory tables, so it can equally be driven
 * by a real Cloudflare Cron trigger, a call from another system, or the "Scan
 * now" button on the Inventory page — without duplicating the logic.
 */

export type InventoryAlertKind = "out_of_stock" | "low_stock" | "expiring" | "expired";
export type InventoryAlertSeverity = "critical" | "warning" | "info";

/** Pick list for the add/edit form and quick entry. Practice can store any string. */
export const INVENTORY_CATEGORIES = [
  "Restorative",
  "Anesthetics",
  "Sterilization",
  "Surgical",
  "Endodontic",
  "Prosthodontic",
  "PPE",
  "Consumables",
  "Other",
] as const;

export interface InventoryItemRow {
  id: number;
  name: string;
  category: string | null;
  sku: string | null;
  unit: string;
  current_stock: number;
  min_threshold: number;
  reorder_quantity: number | null;
  supplier_name: string | null;
  supplier_contact: string | null;
  batch_number: string | null;
  expiry_date: string | null;
  location: string | null;
  unit_cost: number;
  notes: string | null;
  active: number;
  created_at: string;
  updated_at: string;
}

interface AlertSpec {
  kind: InventoryAlertKind;
  severity: InventoryAlertSeverity;
  message: string;
}

const KIND_PRIORITY: Record<InventoryAlertKind, number> = {
  out_of_stock: 3,
  expired: 3,
  low_stock: 2,
  expiring: 1,
};

const SEVERITY_STYLE: Record<InventoryAlertSeverity, string> = {
  critical: "text-rose-700 dark:text-rose-300",
  warning: "text-amber-700 dark:text-amber-300",
  info: "text-sky-700 dark:text-sky-300",
};

/** Escape HTML-sensitive characters for email bodies. */
function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[ch] ?? ch);
}

/** Read the alert settings with defaults. */
export async function getInventorySettings(): Promise<{ expiryDays: number; alertEmail: string }> {
  const rows = await query<{ key: string; value: string }>(
    "SELECT key, value FROM settings WHERE key IN ('inventory_expiry_alert_days', 'inventory_alert_email')",
  ).catch(() => []);
  const map = Object.fromEntries(rows.map((r) => [r.key, r.value]));
  const days = parseInt(map.inventory_expiry_alert_days ?? DEFAULT_INVENTORY_SETTINGS.inventory_expiry_alert_days, 10);
  return {
    expiryDays: Number.isFinite(days) && days >= 0 ? Math.min(days, 3650) : 30,
    alertEmail: (map.inventory_alert_email ?? "").trim(),
  };
}

/** Today and a cutoff date as 'YYYY-MM-DD', computed in SQLite's timezone. */
async function dateBounds(expiryDays: number): Promise<{ today: string; cutoff: string }> {
  const row = await get<{ today: string; cutoff: string }>(
    `SELECT date('now') AS today, date('now', '+' || ? || ' days') AS cutoff`,
    [expiryDays],
  );
  return { today: row?.today ?? "", cutoff: row?.cutoff ?? "" };
}

/** The single source of truth for an item's alert state at scan time. */
export function computeItemAlerts(
  item: Pick<InventoryItemRow, "id" | "name" | "unit" | "current_stock" | "min_threshold" | "expiry_date">,
  today: string,
  cutoff: string,
): AlertSpec[] {
  const specs: AlertSpec[] = [];
  const unit = item.unit === "piece" ? "" : ` ${item.unit}`;

  if (item.min_threshold > 0 && item.current_stock === 0) {
    specs.push({
      kind: "out_of_stock",
      severity: "critical",
      message: `${item.name} is out of stock${unit ? ` (0 ${item.unit})` : " (0)"} — reorder at ${item.min_threshold}.`,
    });
  } else if (item.min_threshold > 0 && item.current_stock <= item.min_threshold) {
    specs.push({
      kind: "low_stock",
      severity: "warning",
      message: `${item.name} is low — ${item.current_stock}${unit} left, threshold ${item.min_threshold}.`,
    });
  }

  if (item.expiry_date) {
    if (item.expiry_date <= today) {
      specs.push({
        kind: "expired",
        severity: "critical",
        message: `${item.name} expired on ${item.expiry_date} — remove from usable stock.`,
      });
    } else if (item.expiry_date <= cutoff) {
      specs.push({
        kind: "expiring",
        severity: "info",
        message: `${item.name} expires on ${item.expiry_date} — use before the date or rotate stock.`,
      });
    }
  }

  return specs;
}

export interface InventoryScanResult {
  scanned_at: string;
  created: { item_id: number; kind: InventoryAlertKind; severity: InventoryAlertSeverity; message: string }[];
  resolved: number;
  open: number;
  by_kind: Record<InventoryAlertKind, number>;
  emailed: boolean;
  email_recipient: string | null;
}

/**
 * The daily pass (also POST /api/inventory/scan). Rebuilds the set of *open*
 * alerts to exactly match the current state of every active item — an alert
 * that healed (stock restocked, item replaced) disappears; a stale one re-syncs
 * on the next run. Idempotent: running it twice in a row changes nothing.
 *
 * Optionally emails a summary to `inventory_alert_email` when the practice has
 * configured Resend delivery (Settings → Email), reusing the same keys the
 * prescription emailer uses.
 */
export async function runInventoryScan(): Promise<InventoryScanResult> {
  const { expiryDays, alertEmail } = await getInventorySettings();
  const { today, cutoff } = await dateBounds(expiryDays);

  const items = await query<InventoryItemRow>("SELECT * FROM inventory_items WHERE active = 1").catch(() => []);

  const specRows: { item_id: number; kind: InventoryAlertKind; severity: InventoryAlertSeverity; message: string }[] = [];
  for (const item of items) {
    for (const spec of computeItemAlerts(item, today, cutoff)) {
      specRows.push({ item_id: item.id, ...spec });
    }
  }
  specRows.sort((a, b) => KIND_PRIORITY[b.kind] - KIND_PRIORITY[a.kind] || a.item_id - b.item_id);

  // Replace the open-alert set with the recomputed one. Resolved rows persist.
  await run("DELETE FROM inventory_alerts WHERE resolved = 0").catch(() => undefined);
  for (const r of specRows) {
    await run(
      "INSERT INTO inventory_alerts (item_id, kind, severity, message) VALUES (?, ?, ?, ?)",
      [r.item_id, r.kind, r.severity, r.message],
    ).catch(() => undefined);
  }

  const by_kind = {
    out_of_stock: 0,
    low_stock: 0,
    expiring: 0,
    expired: 0,
  };
  for (const s of specRows) by_kind[s.kind] += 1;

  let emailed = false;
  let email_recipient: string | null = null;
  if (specRows.length > 0 && alertEmail) {
    emailed = await sendInventoryAlertEmail(alertEmail, specRows);
    email_recipient = emailed ? alertEmail : null;
  }

  return {
    scanned_at: new Date().toISOString(),
    created: specRows,
    resolved: 0,
    open: specRows.length,
    by_kind,
    emailed,
    email_recipient,
  };
}

async function sendInventoryAlertEmail(
  to: string,
  alerts: InventoryScanResult["created"],
): Promise<boolean> {
  const settingsRows = await query<{ key: string; value: string }>("SELECT key, value FROM settings").catch(() => []);
  const settings = Object.fromEntries(settingsRows.map((r) => [r.key, r.value]));
  const apiKey = (settings.email_api_key ?? "").trim();
  const from = (settings.email_from ?? "").trim();
  if (!apiKey || !from) return false;

  const clinicName = (settings.clinic_name ?? "").trim();
  const doctorName = (settings.doctor_name ?? "").trim();
  const practiceLabel = clinicName || doctorName || "Dental Canvas";

  const sections = (["out_of_stock", "expired", "low_stock", "expiring"] as const)
    .map((kind) => alerts.filter((a) => a.kind === kind))
    .filter((rows) => rows.length > 0)
    .map((rows) => rows.map((r) => `<li style="margin:2px 0">${escapeHtml(r.message)}</li>`).join(""))
    .join("");

  const html = `
    <div style="font-family:Segoe UI,Arial,sans-serif;max-width:560px;margin:0 auto;color:#1f2937">
      <h2 style="margin:0 0 4px;color:#9a3412">${escapeHtml(practiceLabel)} — Inventory Alerts</h2>
      <p style="margin:0 0 16px;color:#6b7280;font-size:13px">Daily stock check · ${new Date().toISOString().slice(0, 10)}</p>
      <p style="margin:0 0 8px">The daily inventory scan found ${alerts.length} item${alerts.length === 1 ? "" : "s"} needing attention:</p>
      <ul style="margin:0 0 16px;padding-left:20px;color:#374151">${sections}</ul>
      <p style="margin:0;color:#6b7280;font-size:13px">Review and restock in the Inventory page of Dental Canvas.</p>
    </div>`;

  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        from,
        to: [to],
        subject: `Inventory alerts — ${alerts.length} item${alerts.length === 1 ? "" : "s"} to review`,
        html,
      }),
    });
    return res.ok;
  } catch {
    return false;
  }
}

/** Open alerts joined with their item for the dashboard panel and page. */
export function severityClasses(severity: InventoryAlertSeverity): string {
  return SEVERITY_STYLE[severity] ?? SEVERITY_STYLE.info;
}