/**
 * Client API helper — every call goes through here so the offline/online
 * boundary stays in one place. Successful mutations additionally emit a
 * data-change signal (see ./data-change-signal) that feeds the
 * change-triggered auto-backup: after the app writes anything meaningful,
 * a debounced snapshot is scheduled without every caller having to remember
 * to ask for one.
 */
import { notifyDataChanged, type DataChangeReason } from "./lib/data-change-signal";

/**
 * Map a mutating request to the kind of data it touched. GETs and
 * non-data endpoints (backups, settings, drive auth, dashboard reads, the
 * auto-backup call itself) return null and signal nothing — backing up on a
 * backup would be self-inducing.
 */
function changeReasonFor(method: string, path: string): DataChangeReason | null {
  if (method === "GET") return null;
  const p = path.split("?")[0];
  // The auto-backup endpoint writes only to the backups table, which is
  // deliberately excluded from dumps — never signal on it.
  if (p.startsWith("/api/backup")) return null;
  if (p.startsWith("/api/settings") || p.startsWith("/api/storage") || p.startsWith("/api/drive")) return null;
  if (p.includes("/appointments") || p.includes("/waiting-list") || p.includes("/appointments-to-make") || p.includes("/recalls")) {
    return "appointment";
  }
  if (p.includes("/patients") && !p.includes("/images")) return "patient";
  if (p.includes("/images")) return "image";
  if (p.includes("/invoices") || p.includes("/payment-plans") || p.includes("/installments")) return "invoice";
  if (p.includes("/prescriptions")) return "prescription";
  if (p.includes("note") || p.includes("/tooth") || p.includes("/treatment-plan") || p.includes("/consents") || p.includes("/lab")) {
    return "clinical_note";
  }
  if (p.includes("/medicines")) return "medicine";
  if (p.includes("/inventory")) return "inventory";
  return null;
}

export async function api<T>(method: string, path: string, body?: unknown): Promise<T> {
  const opts: RequestInit = { method, headers: {} };
  if (body !== undefined) {
    (opts.headers as Record<string, string>)["Content-Type"] = "application/json";
    opts.body = JSON.stringify(body);
  }
  const reason = changeReasonFor(method, path);
  const r = await fetch(path, opts);
  let data: unknown = null;
  try {
    data = await r.json();
  } catch {
    /* empty body */
  }
  if (!r.ok) {
    const msg = (data as { error?: string } | null)?.error || `${r.status} ${r.statusText}`;
    throw new Error(msg);
  }
  // Success on a data mutation → schedule (or extend) the change-triggered
  // backup window. Fire-and-forget; failures inside the signal are swallowed.
  if (reason) notifyDataChanged(reason);
  return data as T;
}
