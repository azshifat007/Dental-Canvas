import { useEffect, useMemo, useState } from "react";
import {
  Bell,
  Calendar as CalendarIcon,
  ChevronLeft,
  ChevronRight,
  Search,
  TrendingDown,
  TrendingUp,
  UserPlus,
} from "lucide-react";
import { api } from "@/api";
import { useApp } from "@/context";
import { cn, toIsoDate } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { PatientListPanel, ConsultationPanel, DentistNotesPanel } from "./dashboard-panels";
import { openQuickRegister } from "@/lib/quick-register";

// ── Dashboard API types ────────────────────────────────────────────

export interface UpcomingEvent {
  id: number;
  kind: string;
  title: string | null;
  patient_id: number | null;
  start_time: string;
  status: string;
  first_name: string | null;
  last_name: string | null;
  treatment_name: string | null;
  treatment_color: string | null;
}

export interface DashboardSummary {
  total_visits: number;
  visits_delta_pct: number | null;
  new_patients: number;
  new_patients_delta_pct: number | null;
  returning_patients: number;
  returning_patients_delta_pct: number | null;
  upcoming: UpcomingEvent[];
}

const WEEKDAY_LABELS = ["SUN", "MON", "TUE", "WED", "THU", "FRI", "SAT"] as const;

// ── Page ───────────────────────────────────────────────────────────

export function DashboardPage({
  navigate,
  openSearch,
}: {
  navigate: (to: string) => void;
  openSearch?: () => void;
}) {
  const app = useApp();
  const [summary, setSummary] = useState<DashboardSummary | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await api<DashboardSummary>("GET", "/api/dashboard/summary");
        if (!cancelled) setSummary(res);
      } catch (err) {
        app.setError((err as Error).message);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="flex-1 overflow-auto bg-gradient-to-b from-sky-50/60 to-background dark:from-sky-950/30">
      {/* Top bar: search + notifications — redundant on phones (the mobile
          top bar already carries search/register). */}
      <div className="hidden items-center gap-3 px-4 pt-4 md:flex md:px-6">
        <button
          type="button"
          onClick={() => (openSearch ? openSearch() : navigate("/patients"))}
          className="flex h-11 flex-1 items-center gap-2 rounded-xl border bg-card px-4 text-left text-sm text-muted-foreground shadow-sm transition-colors hover:bg-accent/50"
        >
          <Search className="h-4 w-4 shrink-0" />
          <span className="flex-1">Find Patients or Appointments</span>
          <kbd className="hidden rounded border bg-muted px-1.5 py-0.5 text-[10px] font-semibold sm:block">⌘K</kbd>
        </button>
        <Button
          variant="outline"
          size="icon"
          className="h-11 w-11 rounded-xl bg-card shadow-sm"
          onClick={() => navigate("/agenda")}
          aria-label="Notifications"
        >
          <Bell className="h-4 w-4" />
        </Button>
        <Button
          className="h-11 rounded-xl bg-sky-600 shadow-sm hover:bg-sky-700 dark:bg-sky-500 dark:text-sky-950 dark:hover:bg-sky-400"
          onClick={openQuickRegister}
        >
          <UserPlus className="h-4 w-4" />
          <span className="hidden sm:inline">New patient</span>
        </Button>
        <AvatarBadge navigate={navigate} />
      </div>

      {/* Greeting */}
      <div className="px-4 pb-4 pt-5 md:px-6">
        <h1 className="text-2xl font-bold tracking-tight">
          {greeting()}, <span className="text-sky-600">{doctorDisplayName(app.profile.doctor_name)}</span>{" "}
          <span aria-hidden>👋</span>
        </h1>
      </div>

      {/* Main grid */}
      <div className="grid gap-4 px-4 pb-6 md:px-6 xl:grid-cols-[1fr_360px]">
        <div className="flex min-w-0 flex-col gap-4">
          <VisitsCard summary={summary} loading={loading} />
          <div className="grid min-w-0 gap-4 lg:grid-cols-[minmax(280px,380px)_1fr]">
            <PatientListPanel navigate={navigate} />
            <ConsultationPanel navigate={navigate} />
          </div>
        </div>

        <div className="flex min-w-0 flex-col gap-4">
          <ScheduleCard navigate={navigate} />
          <UpcomingCard summary={summary} loading={loading} navigate={navigate} />
          <DentistNotesPanel />
        </div>
      </div>
    </div>
  );
}

function greeting(): string {
  const h = new Date().getHours();
  if (h < 12) return "Good Morning";
  if (h < 18) return "Good Afternoon";
  return "Good Evening";
}

function doctorDisplayName(name: string): string {
  const trimmed = name.trim();
  if (!trimmed) return "Doctor";
  return /^dr\.?\s/i.test(trimmed) ? trimmed : `Dr. ${trimmed}`;
}

function AvatarBadge({ navigate }: { navigate: (to: string) => void }) {
  const app = useApp();
  const initial = (app.profile.doctor_name.trim()[0] ?? "D").toUpperCase();
  return (
    <button
      type="button"
      onClick={() => navigate("/settings")}
      title="Open settings"
      className="flex h-11 w-11 items-center justify-center rounded-full bg-sky-600 text-sm font-semibold text-white shadow-sm transition-transform hover:scale-105 dark:bg-sky-500 dark:text-sky-950"
    >
      {initial}
    </button>
  );
}

// ── Today's Patient Visits ─────────────────────────────────────────

function DeltaBadge({ pct }: { pct: number | null }) {
  if (pct === null) {
    return <span className="rounded-md bg-muted px-2 py-0.5 text-xs font-semibold text-muted-foreground">—</span>;
  }
  const up = pct >= 0;
  const Icon = up ? TrendingUp : TrendingDown;
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-xs font-bold",
        up ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300" : "bg-rose-100 text-rose-700 dark:bg-rose-950 dark:text-rose-300",
      )}
    >
      {Math.abs(pct)}% <Icon className="h-3 w-3" />
    </span>
  );
}

function VisitsCard({ summary, loading }: { summary: DashboardSummary | null; loading: boolean }) {
  return (
    <div className="relative overflow-hidden rounded-2xl border bg-card p-5 shadow-sm">
      <div className="pointer-events-none absolute -right-10 -top-10 h-64 w-64 rounded-full bg-sky-100/70 blur-2xl dark:bg-sky-500/10" />
      <div className="pointer-events-none absolute -bottom-16 right-24 hidden h-44 w-44 rounded-full bg-teal-100/60 blur-2xl md:block dark:bg-teal-500/10" />
      <div className="relative flex flex-col gap-6 md:flex-row md:items-center md:justify-between">
        <div className="min-w-0">
          <h2 className="text-lg font-semibold tracking-tight">Today's Patient Visits</h2>
          <div className="mt-1 flex items-baseline gap-2">
            <span className="text-5xl font-bold tabular-nums tracking-tight">
              {loading ? "…" : summary?.total_visits ?? 0}
            </span>
            <span className="text-sm text-muted-foreground">/person</span>
          </div>

          <div className="mt-5 flex flex-wrap gap-3">
            <div className="min-w-[150px] flex-1 rounded-xl bg-sky-500 p-4 text-white shadow-sm">
              <div className="text-sm font-medium opacity-90">New Patients.</div>
              <div className="mt-2 flex items-center justify-between gap-2">
                <span className="text-3xl font-bold tabular-nums">{loading ? "…" : summary?.new_patients ?? 0}</span>
                <DeltaBadge pct={summary?.new_patients_delta_pct ?? null} />
              </div>
            </div>
            <div className="min-w-[150px] flex-1 rounded-xl bg-rose-400 p-4 text-white shadow-sm">
              <div className="text-sm font-medium opacity-90">Returning Patients</div>
              <div className="mt-2 flex items-center justify-between gap-2">
                <span className="text-3xl font-bold tabular-nums">{loading ? "…" : summary?.returning_patients ?? 0}</span>
                <DeltaBadge pct={summary?.returning_patients_delta_pct ?? null} />
              </div>
            </div>
          </div>
        </div>

        {/* Decorative tooth emblem */}
        <div className="relative mx-auto hidden h-44 w-44 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-sky-100 to-teal-50 shadow-inner md:flex dark:from-sky-950/60 dark:to-teal-950/40">
          <div className="flex h-28 w-28 items-center justify-center rounded-full bg-white shadow-md dark:bg-card">
            <svg viewBox="0 0 24 24" className="h-14 w-14 text-sky-300" fill="currentColor" aria-hidden>
              <path d="M12 2C8.5 2 7 4.5 7 8c0 2.2.4 3.4.4 5.2 0 1.9-.9 4.6-.9 6.3 0 1.4.8 2.5 2 2.5 1.6 0 2-2.3 2.6-4.6.3-1.2.5-1.9.9-1.9s.6.7.9 1.9c.6 2.3 1 4.6 2.6 4.6 1.2 0 2-1.1 2-2.5 0-1.7-.9-4.4-.9-6.3C16.6 11.4 17 10.2 17 8c0-3.5-1.5-6-5-6Z" />
            </svg>
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Your Schedule (calendar) ───────────────────────────────────────

function ScheduleCard({ navigate }: { navigate: (to: string) => void }) {
  const [cursor, setCursor] = useState(() => {
    const now = new Date();
    return { year: now.getFullYear(), month: now.getMonth() };
  });
  const todayIso = toIsoDate(new Date());

  // Days with patient appointments, fetched per visible month.
  const [busyDays, setBusyDays] = useState<Set<string>>(new Set());
  const yearMonth = `${cursor.year}-${String(cursor.month + 1).padStart(2, "0")}`;

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        // Pull the month's appointments via two boundary queries (first/last day).
        const first = `${yearMonth}-01`;
        const lastDay = new Date(cursor.year, cursor.month + 1, 0).getDate();
        const last = `${yearMonth}-${String(lastDay).padStart(2, "0")}`;
        const data = await api<{ appointments: { start_time: string }[] }>(
          "GET",
          `/api/appointments?from=${first}&to=${last}`,
        );
        if (!cancelled) {
          setBusyDays(new Set(data.appointments.map((a) => a.start_time.slice(0, 10))));
        }
      } catch {
        /* non-critical decoration */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [yearMonth, cursor.year, cursor.month]);

  const cells = useMemo(() => {
    const firstDow = new Date(cursor.year, cursor.month, 1).getDay();
    const daysInMonth = new Date(cursor.year, cursor.month + 1, 0).getDate();
    const out: (number | null)[] = Array.from({ length: firstDow }, () => null);
    for (let d = 1; d <= daysInMonth; d++) out.push(d);
    return out;
  }, [cursor]);

  const monthLabel = new Date(cursor.year, cursor.month, 1).toLocaleDateString(undefined, {
    month: "long",
    year: "numeric",
  });

  function shift(delta: number) {
    setCursor((c) => {
      const d = new Date(c.year, c.month + delta, 1);
      return { year: d.getFullYear(), month: d.getMonth() };
    });
  }

  return (
    <div className="rounded-2xl border bg-card p-5 shadow-sm">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold tracking-tight">Your Schedule</h2>
        <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => navigate("/agenda")} title="Open agenda">
          <CalendarIcon className="h-4 w-4" />
        </Button>
      </div>

      <div className="mt-1 flex items-center justify-between">
        <div className="text-sm text-muted-foreground">{monthLabel}</div>
        <div className="flex items-center gap-1">
          <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => shift(-1)} aria-label="Previous month">
            <ChevronLeft className="h-4 w-4" />
          </Button>
          <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => shift(1)} aria-label="Next month">
            <ChevronRight className="h-4 w-4" />
          </Button>
        </div>
      </div>

      <div className="mt-3 grid grid-cols-7 gap-y-1 text-center">
        {WEEKDAY_LABELS.map((d) => (
          <div key={d} className="pb-1 text-[10px] font-semibold tracking-wider text-muted-foreground">
            {d}
          </div>
        ))}
        {cells.map((day, i) => {
          if (day === null) return <div key={`pad-${i}`} />;
          const iso = `${yearMonth}-${String(day).padStart(2, "0")}`;
          const isToday = iso === todayIso;
          const hasVisits = busyDays.has(iso);
          return (
            <button
              key={iso}
              type="button"
              onClick={() => navigate(`/agenda?date=${iso}`)}
              className={cn(
                "mx-auto flex h-8 w-8 items-center justify-center rounded-lg text-sm transition-colors",
                isToday
                  ? "bg-sky-500 font-semibold text-white"
                  : hasVisits
                    ? "bg-sky-100 font-medium text-sky-900 hover:bg-sky-200"
                    : "hover:bg-accent",
              )}
            >
              {day}
            </button>
          );
        })}
      </div>
    </div>
  );
}

// ── Upcoming ───────────────────────────────────────────────────────

function UpcomingCard({
  summary,
  loading,
  navigate,
}: {
  summary: DashboardSummary | null;
  loading: boolean;
  navigate: (to: string) => void;
}) {
  const events = summary?.upcoming ?? [];
  return (
    <div className="rounded-2xl border bg-card p-5 shadow-sm">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold tracking-tight">Upcoming</h2>
        <button
          type="button"
          onClick={() => navigate("/agenda")}
          className="text-xs font-medium text-sky-600 underline-offset-2 hover:underline"
        >
          View All
        </button>
      </div>
      <div className="mt-3 space-y-2">
        {loading ? (
          <p className="py-2 text-sm text-muted-foreground">Loading…</p>
        ) : events.length === 0 ? (
          <p className="py-2 text-sm text-muted-foreground">Nothing scheduled — enjoy the calm.</p>
        ) : (
          events.map((ev) => {
            const d = new Date(ev.start_time.length <= 10 ? `${ev.start_time}T00:00:00` : ev.start_time);
            const valid = !Number.isNaN(d.getTime());
            const dateLabel = valid
              ? ev.start_time.length <= 10
                ? `${d.getDate()} ${d.toLocaleDateString(undefined, { month: "long" })}, ${d.getFullYear()}`
                : `${d.getDate()} ${d.toLocaleDateString(undefined, { month: "long" })}, ${d.getFullYear()} | ${d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", hour12: true })}`
              : ev.start_time;
            const name =
              ev.kind === "recall"
                ? "Recall"
                : [ev.first_name, ev.last_name].filter(Boolean).join(" ") || "Appointment";
            return (
              <button
                key={`${ev.kind}-${ev.id}`}
                type="button"
                onClick={() => navigate(ev.kind === "recall" ? "/patients" : "/agenda")}
                className="flex w-full items-center gap-3 rounded-xl border bg-sky-50/60 px-3 py-2.5 text-left transition-colors hover:bg-sky-100/60"
              >
                <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-sky-500 text-white">
                  <CalendarIcon className="h-4 w-4" />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-semibold">{ev.title ?? name}</span>
                  <span className="block truncate text-xs text-muted-foreground">
                    {name} · {dateLabel}
                  </span>
                </span>
              </button>
            );
          })
        )}
      </div>
    </div>
  );
}

