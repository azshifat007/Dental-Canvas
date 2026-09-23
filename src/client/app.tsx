import { useCallback, useEffect, useState } from "react";
import { reportLocation } from "@clawnify/app/client";
import { useAppState } from "./hooks/use-app-state";
import { useRouter } from "./hooks/use-router";
import { AppContext } from "./context";
import { Sidebar } from "./components/sidebar";
import { MobileTopBar, BottomNav } from "./components/mobile-nav";
import { ErrorBanner } from "./components/error-banner";
import { Toaster } from "./components/ui/toast";
import { useAutoBackup } from "./hooks/use-auto-backup";
import { isTauriDesktop } from "./offline/activate";
import { startDesktopBackupScheduler } from "./offline/desktop-backup";
import { useDailyInventoryScan } from "./hooks/use-daily-inventory-scan";
import { useDailyDigest } from "./hooks/use-daily-digest";
import { useTheme } from "./hooks/use-theme";
import { useAccessibility } from "./hooks/use-accessibility";
import { useBrandAccent } from "./hooks/use-brand-accent";
import { SearchPalette, useGlobalSearchHotkey } from "./components/search/search-palette";
import { SetupWizard } from "./components/setup/setup-wizard";
import { PatientDialog } from "./components/patients/patient-dialog";
import { PrescriptionPrintView } from "./components/prescriptions/prescription-print-view";
import { InvoicePrintView } from "./components/patients/invoice-print-view";
import { OPEN_REGISTER_PATIENT } from "./lib/quick-register";
import { KioskPage } from "./components/kiosk/kiosk-page";
import type { Patient } from "./types";
import { AgendaPage } from "./components/agenda/agenda-page";
import { DashboardPage } from "./components/dashboard/dashboard-page";
import { PatientsList } from "./components/patients/patients-list";
import { PatientPage } from "./components/patients/patient-page";
import { ReportsPage } from "./components/reports/reports-page";
import { LabPage } from "./components/lab/lab-page";
import { MedicinesPage } from "./components/medicines/medicines-page";
import { InventoryPage } from "./components/inventory/inventory-page";
import { SettingsPage } from "./components/settings/settings-page";
import { FinancePage } from "./components/finance/finance-page";

export function App() {
  const state = useAppState();
  const { path, route, navigate } = useRouter();
  const [searchOpen, setSearchOpen] = useState(false);
  const [registerOpen, setRegisterOpen] = useState(false);

  // First-run setup wizard (desktop only): on a fresh offline install the
  // profile is empty — no doctor name, no clinic name — and the whole app
  // (dashboard greeting, letterheads, invoices) is built around them. Show a
  // two-step wizard once; "Skip for now" is remembered so it never nags.
  const [wizardDone, setWizardDone] = useState(() => {
    try {
      return window.localStorage.getItem("dental-canvas:setup-wizard-done") === "1";
    } catch {
      return false;
    }
  });
  const showWizard =
    isTauriDesktop() &&
    !state.loading &&
    !wizardDone &&
    state.profile.doctor_name.trim() === "" &&
    state.profile.clinic_name.trim() === "";
  const completeWizard = useCallback(() => {
    try {
      window.localStorage.setItem("dental-canvas:setup-wizard-done", "1");
    } catch {
      /* private mode — profile will be non-empty anyway, or it re-offers */
    }
    setWizardDone(true);
  }, []);

  // Timer-based auto backup — runs app-wide while Dental Canvas is open.
  useAutoBackup(state.backupSchedule);

  // Desktop only: weekly folder auto-backup (first one right after a folder is
  // picked — "on install"). No-op in the browser.
  useEffect(() => {
    if (!isTauriDesktop()) return;
    return startDesktopBackupScheduler();
  }, []);

  // Once-per-day stock scan — refreshes low-stock/expiry alerts and the
  // dashboard notification panel (serverless: the timer lives in the browser).
  useDailyInventoryScan();

  // Once-per-day worklist digest email (reminders/recalls/installments) to
  // the clinic inbox — same serverless pattern, scheduled in Settings → Email.
  useDailyDigest(true);

  // Theme: follows the OS dark mode by default, with a manual override.
  useTheme();

  // Accessibility prefs (high contrast, reduced motion) — same lifecycle.
  useAccessibility();

  // Clinic brand accent color (re-colors the primary teal).
  useBrandAccent();

  // Deep-link support: pages can request the search palette via ?search=open.
  useEffect(() => {
    if (new URLSearchParams(window.location.search).get("search") === "open") {
      setSearchOpen(true);
      window.history.replaceState(null, "", window.location.pathname);
    }
  }, []);
  const openSearch = useCallback(() => setSearchOpen(true), []);
  useGlobalSearchHotkey(openSearch);

  // Global quick patient registration: any surface can open the one dialog
  // that lives here, via the custom event or the keyboard shortcuts.
  useEffect(() => {
    const open = () => setRegisterOpen(true);
    window.addEventListener(OPEN_REGISTER_PATIENT, open);
    return () => window.removeEventListener(OPEN_REGISTER_PATIENT, open);
  }, []);
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key.toLowerCase() === "p") {
        e.preventDefault();
        setRegisterOpen(true);
        return;
      }
      // Plain "n" — like Gmail — but never while typing in a field.
      if (e.key.toLowerCase() === "n" && !e.ctrlKey && !e.metaKey && !e.altKey) {
        const target = e.target as HTMLElement | null;
        const tag = target?.tagName;
        if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || target?.isContentEditable) return;
        e.preventDefault();
        setRegisterOpen(true);
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
  useEffect(() => { reportLocation(window.location.pathname + window.location.search); }, [path]);

  // Full-screen paper routes (prescription/invoice print views) render without
  // nav chrome, like a document viewer. The check-in kiosk is likewise
  // chrome-free — it runs unattended on a waiting-room tablet.
  const isPrintRoute = route.name === "patient-prescription" || route.name === "patient-invoice";
  // The check-in kiosk is a full-screen takeover — no app chrome at all.
  if (route.name === "kiosk") {
    return (
      <AppContext.Provider value={state}>
        <KioskPage />
        <ErrorBanner />
      </AppContext.Provider>
    );
  }

  return (
    <AppContext.Provider value={state}>
      {showWizard && <SetupWizard onDone={completeWizard} />}
      <div className="flex h-screen min-h-0 flex-col md:flex-row overflow-hidden">
        {!isPrintRoute && <MobileTopBar onOpenSearch={openSearch} />}
        <div className="flex min-h-0 flex-1 overflow-hidden">
          <Sidebar route={route} navigate={navigate} onOpenSearch={openSearch} />
          <main className="flex flex-1 flex-col overflow-hidden">
          {state.loading ? (
            <div className="flex flex-1 items-center justify-center text-muted-foreground">
              Loading…
            </div>
          ) : (
            <>
              {route.name === "dashboard" && <DashboardPage navigate={navigate} openSearch={openSearch} />}
              {route.name === "agenda" && <AgendaPage />}
              {route.name === "patients" && <PatientsList navigate={navigate} />}
              {route.name === "patient" && <PatientPage id={route.id} navigate={navigate} />}
              {route.name === "patient-prescription" && (
                <PrescriptionPrintView prescriptionId={route.prescriptionId} navigate={navigate} />
              )}
              {route.name === "patient-invoice" && (
                <InvoicePrintView invoiceId={route.invoiceId} navigate={navigate} />
              )}
              {route.name === "reports" && <ReportsPage />}
              {(route.name === "finance-billing" || route.name === "finance-revenue" || route.name === "finance-appointments") && (
                <FinancePage route={route} navigate={navigate} />
              )}
              {route.name === "lab" && <LabPage navigate={navigate} />}
              {route.name === "medicines" && <MedicinesPage />}
              {route.name === "inventory" && <InventoryPage />}
              {route.name === "settings" && <SettingsPage />}
              {route.name === "not-found" && (
                <Placeholder title="Not found" message="That page doesn't exist." />
              )}
            </>
          )}
        </main>
        </div>
        {!isPrintRoute && <BottomNav route={route} navigate={navigate} />}
        <ErrorBanner />
        <Toaster />
      </div>
      <SearchPalette open={searchOpen} onOpenChange={setSearchOpen} navigate={navigate} />
      <PatientDialog
        open={registerOpen}
        onOpenChange={setRegisterOpen}
        patient={null}
        onOpenPatient={(p: Patient) => navigate(`/patients/${p.id}`)}
        openPatientLabel="Open record"
      />
    </AppContext.Provider>
  );
}

function Placeholder({ title, message }: { title: string; message: string }) {
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-2 p-12 text-center">
      <h1 className="text-xl font-semibold tracking-tight">{title}</h1>
      <p className="text-sm text-muted-foreground">{message}</p>
    </div>
  );
}
