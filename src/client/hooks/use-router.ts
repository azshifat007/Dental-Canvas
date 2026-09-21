import { useState, useEffect, useCallback } from "react";

export type Route =
  | { name: "dashboard" }
  | { name: "agenda" }
  | { name: "patients" }
  | { name: "patient"; id: number }
  | { name: "patient-prescription"; id: number; prescriptionId: number }
  | { name: "patient-invoice"; id: number; invoiceId: number }
  | { name: "reports" }
  | { name: "lab" }
  | { name: "medicines" }
  | { name: "inventory" }
  | { name: "settings" }
  | { name: "not-found" };

function parse(path: string): Route {
  if (path === "/" || path === "/dashboard") return { name: "dashboard" };
  if (path === "/agenda") return { name: "agenda" };
  if (path === "/patients") return { name: "patients" };
  const m = path.match(/^\/patients\/(\d+)$/);
  if (m) return { name: "patient", id: parseInt(m[1], 10) };
  const rx = path.match(/^\/patients\/(\d+)\/prescriptions\/(\d+)$/);
  if (rx) return { name: "patient-prescription", id: parseInt(rx[1], 10), prescriptionId: parseInt(rx[2], 10) };
  const inv = path.match(/^\/patients\/(\d+)\/invoices\/(\d+)$/);
  if (inv) return { name: "patient-invoice", id: parseInt(inv[1], 10), invoiceId: parseInt(inv[2], 10) };
  if (path === "/reports") return { name: "reports" };
  if (path === "/lab") return { name: "lab" };
  if (path === "/medicines") return { name: "medicines" };
  if (path === "/inventory") return { name: "inventory" };
  if (path === "/settings") return { name: "settings" };
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

  return { path, route: parse(path), navigate };
}
