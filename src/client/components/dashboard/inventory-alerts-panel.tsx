import { useCallback, useEffect, useState } from "react";
import { AlertTriangle, Boxes, RefreshCw } from "lucide-react";
import { api } from "@/api";
import { useApp } from "@/context";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import type { InventoryAlert, InventoryAlertSeverity } from "@/types";

/**
 * Inventory notifications on the dashboard. The daily stock scan (see
 * use-daily-inventory-scan) mints the alerts; this panel surfaces the open
 * ones — low/out-of-stock items and near-expiry products — with a one-tap
 * deep link into the Inventory page. Refreshes when the scan finishes
 * (`dental-canvas:inventory-scan` event) so the badge stays truthful.
 */

const SEVERITY_ROW: Record<InventoryAlertSeverity, string> = {
  critical: "border-rose-200 bg-rose-50/70 dark:border-rose-900 dark:bg-rose-950/30",
  warning: "border-amber-200 bg-amber-50/70 dark:border-amber-900 dark:bg-amber-950/30",
  info: "border-sky-200 bg-sky-50/70 dark:border-sky-900 dark:bg-sky-950/30",
};

const SEVERITY_DOT: Record<InventoryAlertSeverity, string> = {
  critical: "bg-rose-500",
  warning: "bg-amber-500",
  info: "bg-sky-500",
};

const KIND_LABEL: Record<InventoryAlert["kind"], string> = {
  out_of_stock: "Out of stock",
  low_stock: "Low stock",
  expiring: "Expiring",
  expired: "Expired",
};

export function InventoryAlertsPanel({ navigate }: { navigate: (to: string) => void }) {
  const app = useApp();
  const [alerts, setAlerts] = useState<InventoryAlert[]>([]);
  const [refreshing, setRefreshing] = useState(false);

  const reload = useCallback(async () => {
    try {
      const res = await api<{ alerts: InventoryAlert[] }>("GET", "/api/inventory/alerts");
      setAlerts(res.alerts);
    } catch (err) {
      app.setError((err as Error).message);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    reload();
    const onScan = () => void reload();
    window.addEventListener("dental-canvas:inventory-scan", onScan);
    return () => window.removeEventListener("dental-canvas:inventory-scan", onScan);
  }, [reload]);

  async function refresh() {
    setRefreshing(true);
    await reload();
    setRefreshing(false);
  }

  const critical = alerts.filter((a) => a.severity === "critical").length;

  return (
    <div className="rounded-2xl border bg-card p-5 shadow-sm">
      <div className="flex items-center justify-between">
        <h2 className="flex items-center gap-2 text-lg font-semibold tracking-tight">
          <AlertTriangle className={cn("h-4 w-4", alerts.length > 0 ? "text-amber-500" : "text-muted-foreground")} />
          Inventory Alerts
          {alerts.length > 0 && (
            <span className={cn(
              "rounded-full px-2 py-0.5 text-xs font-bold",
              critical > 0 ? "bg-rose-100 text-rose-800 dark:bg-rose-950 dark:text-rose-200" : "bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-200",
            )}>
              {alerts.length}
            </span>
          )}
        </h2>
        <button
          type="button"
          onClick={() => void refresh()}
          title="Refresh alerts"
          aria-label="Refresh inventory alerts"
          className="rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
        >
          <RefreshCw className={cn("h-4 w-4", refreshing && "animate-spin")} />
        </button>
      </div>

      <div className="mt-3 space-y-2">
        {alerts.length === 0 ? (
          <p className="py-4 text-sm text-muted-foreground">
            No stock alerts right now — supplies look good.
          </p>
        ) : (
          alerts.slice(0, 4).map((a) => (
            <div key={a.id} className={cn("flex items-start gap-2 rounded-xl border px-3 py-2.5", SEVERITY_ROW[a.severity])}>
              <span className={cn("mt-1.5 h-2 w-2 shrink-0 rounded-full", SEVERITY_DOT[a.severity])} />
              <div className="min-w-0 flex-1">
                <div className="text-xs font-semibold">{KIND_LABEL[a.kind]}</div>
                <div className="truncate text-sm text-foreground/90">{a.message}</div>
              </div>
            </div>
          ))
        )}
      </div>

      <Button
        variant="outline"
        size="sm"
        className="mt-3 w-full text-sky-700 dark:text-sky-300"
        onClick={() => navigate("/inventory")}
      >
        <Boxes className="h-4 w-4" /> Open inventory
      </Button>
    </div>
  );
}