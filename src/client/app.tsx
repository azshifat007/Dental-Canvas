import { useCallback, useEffect, useState } from "react";
import { reportLocation } from "@clawnify/app/client";
import { useAppState } from "./hooks/use-app-state";
import { useRouter } from "./hooks/use-router";
import { AppContext } from "./context";
import { Sidebar } from "./components/sidebar";
import { ErrorBanner } from "./components/error-banner";
import { useAutoBackup } from "./hooks/use-auto-backup";
import { useTheme } from "./hooks/use-theme";
import { SearchPalette, useGlobalSearchHotkey } from "./components/search/search-palette";
import { PatientDialog } from "./components/patients/patient-dialog";
import { PublicPrescriptionView } from "./components/prescriptions/public-prescription-view";
import { PrescriptionPrintView } from "./components/prescriptions/prescription-print-view";
import { InvoicePrintView } from "./components/patients/invoice-print-view";
import { OPEN_REGISTER_PATIENT } from "./lib/quick-register";
import type { Patient } from "./types";
import { AgendaPage } from "./components/agenda/agenda-page";
import { DashboardPage } from "./components/dashboard/dashboard-page";
import { PatientsList } from "./components/patients/patients-list";
import { PatientPage } from "./components/patients/patient-page";
import { ReportsPage } from "./components/reports/reports-page";
import { LabPage } from "./components/lab/lab-page";
import { SettingsPage } from "./components/settings/settings-page";

export function App() {
  const state = useAppState();
  const { path, route, navigate } = useRouter();
  const [searchOpen, setSearchOpen] = useState(false);
  const [registerOpen, setRegisterOpen] = useState(false);

  // Timer-based auto backup — runs app-wide while Dental Canvas is open.
  useAutoBackup(state.backupSchedule);

  // Theme: follows the OS dark mode by default, with a manual override.
  useTheme();

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

  // Public prescription share view renders bare — no sidebar, no shell — so
  // the printed sheet looks right and patients see nothing else.
  if (route.name === "public-prescription") {
    return (
      <AppContext.Provider value={state}>
        <PublicPrescriptionView token={route.token} />
        <ErrorBanner />
      </AppContext.Provider>
    );
  }

  return (
    <AppContext.Provider value={state}>
      <div className="flex h-screen min-h-0 overflow-hidden">
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
              {route.name === "lab" && <LabPage navigate={navigate} />}
              {route.name === "settings" && <SettingsPage />}
              {route.name === "not-found" && (
                <Placeholder title="Not found" message="That page doesn't exist." />
              )}
            </>
          )}
        </main>
        <ErrorBanner />
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
