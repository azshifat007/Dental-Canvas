import { useState, useEffect, useCallback, useMemo } from "react";

export type Route =
  | { name: "dashboard" }
  | { name: "agenda" }
  | { name: "kiosk" }
  | { name: "public-booking"; token: string }
  | { name: "patients" }
  | { name: "patient"; id: number }
  | { name: "patient-prescription"; id: number; prescriptionId: number }
  | { name: "patient-invoice"; id: number; invoiceId: number }
  | { name: "reports" }
  | { name: "lab" }
  | { name: "medicines" }
  | { name: "inventory" }
  | { name: "finance-billing" }
  | { name: "finance-revenue" }
  | { name: "finance-appointments" }
  | { name: "settings" }
  | { name: "whats-new" }
  | { name: "share-prescription"; token: string }
  | { name: "not-found" };

function parse(path: string): Route {
  if (path === "/" || path === "/dashboard") return { name: "dashboard" };
  if (path === "/agenda") return { name: "agenda" };
  if (path === "/kiosk") return { name: "kiosk" };
  {
    const m = path.match(/^\/book\/([a-f0-9]+)\/?$/);
    if (m) return { name: "public-booking", token: m[1] };
  }
  if (path === "/patients") return { name: "patients" };
  const m = path.match(/^\/patients\/(\d+)$/);
  if (m) return { name: "patient", id: parseInt(m[1], 10) };
  const rx = path.match(/^\/patients\/(\d+)\/prescriptions\/(\d+)$/);
  if (rx) return { name: "patient-prescription", id: parseInt(rx[1], 10), prescriptionId: parseInt(rx[2], 10) };
  const inv = path.match(/^\/patients\/(\d+)\/invoices\/(\d+)$/);
  if (inv) return { name: "patient-invoice", id: parseInt(inv[1], 10), invoiceId: parseInt(inv[2], 10) };
  if (path === "/reports") return { name: "reports" };
  if (path === "/finance/billing-record") return { name: "finance-billing" };
  if (path === "/finance/revenue-breakdown") return { name: "finance-revenue" };
  if (path === "/finance/appointment-overview") return { name: "finance-appointments" };
  if (path === "/lab") return { name: "lab" };
  if (path === "/medicines") return { name: "medicines" };
  if (path === "/inventory") return { name: "inventory" };
  if (path === "/settings") return { name: "settings" };
  if (path === "/whats-new") return { name: "whats-new" };
  const share = path.match(/^\/share\/prescription\/([a-f0-9]+)\/?$/);
  if (share) return { name: "share-prescription", token: share[1] };
  return { name: "not-found" };
}

export function useRouter() {
  const [path, setPath] = useState<string>(() => window.location.pathname);

  const navigate = useCallback((to: string) => {
    if (to === window.location.pathname) return;
    window.history.pushState(null, "", to);
    setPath(to);
  }, []);

  useEffect(() => {
    const handler = () => setPath(window.location.pathname);
    window.addEventListener("popstate", handler);
    return () => window.removeEventListener("popstate", handler);
  }, []);

  // Memoised: `parse` builds a fresh object every call, so an unmemoised route
  // gave every `useEffect(..., [route])` a new dependency on each parent render
  // — the mobile nav's "close the More sheet on navigation" effect was firing
  // on unrelated re-renders and dismissing the sheet a moment after it opened.
  const route = useMemo(() => parse(path), [path]);

  return { path, route, navigate };
}
