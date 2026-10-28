import { useEffect, useMemo, useState } from "react";
import {
  Armchair,
  Bell,
  Calendar as CalendarIcon,
  Cake,
  ChevronLeft,
  ChevronRight,
  Repeat,
  Search,
  TrendingDown,
  TrendingUp,
  UserPlus,
} from "lucide-react";
import { api } from "@/api";
import { useApp } from "@/context";
import { cn, toIsoDate } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { MiniStatRing, ProgressRing } from "@/components/ui/progress-ring";
import { PatientListPanel, ConsultationPanel, DentistNotesPanel } from "./dashboard-panels";
import { InventoryAlertsPanel } from "./inventory-alerts-panel";
import { visitMetrics } from "./visits-metrics";
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

export interface Birthday {
  id: number;
  name: string;
  date_of_birth: string | null;
  phone: string | null;
  turning: number;
  days_away: number;
  is_today: boolean;
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
        // The server's clock is UTC; send the clinic's own calendar day so a
        // 9am appointment in UTC+6 is not counted against yesterday.
        const res = await api<DashboardSummary>("GET", `/api/dashboard/summary?today=${toIsoDate(new Date())}`);
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
          aria-label="Open the agenda"
          title="Open the agenda"
        >
          <Bell className="h-4 w-4" />
        </Button>
        <Button
          className="h-11 rounded-xl shadow-sm"
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
          {greeting()}, <span className="text-primary">{doctorDisplayName(app.profile.doctor_name)}</span>{" "}
          <span aria-hidden>👋🦷</span>
        </h1>
      </div>

      {/* Main grid — cards rise in with a stagger (pure CSS, reduced-motion aware). */}
      <div className="grid gap-4 px-4 pb-6 md:px-6 xl:grid-cols-[1fr_360px]">
        <div className="stagger flex min-w-0 flex-col gap-4">
          <VisitsCard summary={summary} loading={loading} />
          <div className="stagger grid min-w-0 gap-4 lg:grid-cols-[minmax(280px,380px)_1fr]">
            <PatientListPanel navigate={navigate} />
            <ConsultationPanel navigate={navigate} />
          </div>
          {/* Stock alerts and notes sit under the lists rather than at the
              bottom of the rail: the rail's three dated cards already run
              longer, and keeping all five there left half the left column
              empty on a wide screen. */}
          <div className="stagger grid min-w-0 gap-4 lg:grid-cols-2">
            <InventoryAlertsPanel navigate={navigate} />
            <DentistNotesPanel />
          </div>
        </div>

        <div className="stagger flex min-w-0 flex-col gap-4">
          <ScheduleCard navigate={navigate} />
          <UpcomingCard summary={summary} loading={loading} navigate={navigate} />
          <BirthdaysCard navigate={navigate} />
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
      className="flex h-11 w-11 items-center justify-center rounded-full bg-primary text-sm font-semibold text-primary-foreground shadow-sm transition-transform hover:scale-105"
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
  const m = visitMetrics(summary);

  return (
    <div className="card-lift animate-rise rounded-2xl border bg-card p-5 shadow-sm">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">Today</p>
          <h2 className="text-lg font-semibold tracking-tight">Patient Visits</h2>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <span className="text-[11px] font-medium text-muted-foreground">vs last month</span>
          <DeltaBadge pct={m.visitsDelta} />
        </div>
      </div>

      {/* Headline count and the ring that summarises the day. New and returning
          patients are shown once, as the sub-gauges below — they used to sit in
          coloured tiles here as well, which said the same thing twice. */}
      <div className="mt-4 flex flex-col gap-5 sm:flex-row sm:items-center">
        <div className="min-w-0 flex-1">
          <div className="flex items-baseline gap-2">
            <span
              key={m.visits}
              className="animate-count text-5xl font-bold tabular-nums tracking-tight"
            >
              {loading ? "…" : m.visits}
            </span>
            <span className="text-sm text-muted-foreground">of {m.capacity} chair slots</span>
          </div>
          <p className="mt-2 text-sm text-muted-foreground">
            {loading
              ? "Loading today's schedule…"
              : m.visits === 0
                ? "No patient visits booked yet today."
                : m.openSlots > 0
                  ? `${m.openSlots} ${m.openSlots === 1 ? "chair slot is" : "chair slots are"} still open today.`
                  : "The day is fully booked — every chair slot is taken."}
          </p>
        </div>

        <ProgressRing
          value={loading ? 0 : m.fillPercent}
          size={132}
          caption="Chair utilization"
          label={`Chair utilization today: ${Math.round(m.fillPercent)} percent of ${m.capacity} chair slots`}
          className="self-center sm:self-auto"
        />
      </div>

      {/* Sub-gauges: the day's new-patient goal, how much of the day is repeat
          business, and what is left to book. */}
      <div className="mt-5 grid grid-cols-3 gap-2 rounded-xl border bg-muted/40 px-2 py-3">
        <MiniStatRing
          icon={<UserPlus className="h-4 w-4" />}
          value={loading ? 0 : m.newGoalPercent}
          label="New patients"
          display={`${loading ? "…" : m.newToday}/${m.newGoal}`}
          detail={
            loading
              ? "New patients today"
              : `${m.newToday} of ${m.newGoal} new patients today — ${
                  m.newGoalRemaining === 0
                    ? "daily goal met"
                    : `${m.newGoalRemaining} more to reach the daily goal`
                }`
          }
          ariaLabel={
            loading
              ? "New patients today: loading"
              : `New patients today: ${m.newToday} of ${m.newGoal}, ${Math.round(m.newGoalPercent)} percent of the daily goal`
          }
          tone="teal"
        />
        <MiniStatRing
          icon={<Repeat className="h-4 w-4" />}
          value={loading ? 0 : m.returningShare}
          label="Returning"
          detail={
            loading
              ? "Returning patients today"
              : `${m.returningToday} of today's ${m.visits} ${m.visits === 1 ? "visit is" : "visits are"} returning patients (a completed visit before today)`
          }
          ariaLabel={
            loading
              ? "Returning patients today: loading"
              : `Returning patients: ${m.returningToday} of today's ${m.visits} visits, ${Math.round(m.returningShare)} percent`
          }
          tone="violet"
        />
        <MiniStatRing
          icon={<Armchair className="h-4 w-4" />}
          value={loading ? 0 : m.openPercent}
          label="Open chairs"
          detail={
            loading
              ? "Open chair slots today"
              : `${m.openSlots} of ${m.capacity} chair slots are still open today`
          }
          ariaLabel={
            loading
              ? "Open chair slots today: loading"
              : `Open chair slots today: ${m.openSlots} of ${m.capacity}, ${Math.round(m.openPercent)} percent`
          }
          tone="amber"
        />
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
    <div className="card-lift animate-rise rounded-2xl border bg-card p-5 shadow-sm">
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
              style={{ "--stagger-i": Math.min(i, 30) } as React.CSSProperties}
              aria-label={`${new Date(`${iso}T00:00:00`).toLocaleDateString(undefined, {
                weekday: "long",
                day: "numeric",
                month: "long",
                year: "numeric",
              })}${isToday ? ", today" : ""}${hasVisits ? ", appointments booked" : ""}`}
              className={cn(
                "animate-day mx-auto flex h-8 w-8 items-center justify-center rounded-lg text-sm transition-colors",
                isToday
                  ? "bg-primary font-semibold text-primary-foreground"
                  : hasVisits
                    ? "bg-primary/10 font-medium text-primary hover:bg-primary/20"
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

// ── Birthdays ──────────────────────────────────────────────────────

function BirthdaysCard({ navigate }: { navigate: (to: string) => void }) {
  const [birthdays, setBirthdays] = useState<Birthday[] | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await api<{ birthdays: Birthday[] }>(
          "GET",
          `/api/dashboard/birthdays?days=30&today=${toIsoDate(new Date())}`,
        );
        if (!cancelled) setBirthdays(res.birthdays);
      } catch {
        if (!cancelled) setBirthdays([]); // non-critical panel — fail quiet
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const today = birthdays?.filter((b) => b.is_today) ?? [];
  const upcoming = birthdays?.filter((b) => !b.is_today) ?? [];

  return (
    <div className="card-lift animate-rise rounded-2xl border bg-card p-5 shadow-sm">
      <div className="flex items-center gap-2">
        <Cake className="h-5 w-5 animate-pop text-pink-500" />
        <h2 className="text-lg font-semibold tracking-tight">Birthdays</h2>
        <span className="ml-auto text-xs text-muted-foreground">next 30 days</span>
      </div>
      <div className="stagger mt-3 space-y-2">
        {birthdays === null ? (
          <p className="py-2 text-sm text-muted-foreground">Loading…</p>
        ) : birthdays.length === 0 ? (
          <p className="py-2 text-sm text-muted-foreground">No patient birthdays this month.</p>
        ) : (
          <>
            {today.map((b) => (
              <button
                key={b.id}
                type="button"
                onClick={() => navigate(`/patients/${b.id}`)}
                className="flex w-full items-center gap-3 rounded-xl border border-pink-200 bg-pink-50 px-3 py-2.5 text-left transition-colors hover:bg-pink-100 dark:border-pink-900 dark:bg-pink-950/40 dark:hover:bg-pink-950/70"
              >
                <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-pink-500 text-white">
                  <Cake className="h-4 w-4" />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-semibold">{b.name}</span>
                  <span className="block text-xs text-pink-700 dark:text-pink-300">🎂 Turns {b.turning} today!</span>
                </span>
              </button>
            ))}
            {upcoming.map((b) => (
              <button
                key={b.id}
                type="button"
                onClick={() => navigate(`/patients/${b.id}`)}
                className="flex w-full items-center gap-3 rounded-xl border bg-sky-50/60 px-3 py-2.5 text-left transition-colors hover:bg-sky-100/60 dark:border-sky-900/60 dark:bg-sky-950/30 dark:hover:bg-sky-950/60"
              >
                <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-sky-500/15 text-sky-700 dark:text-sky-300">
                  <Cake className="h-4 w-4" />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-semibold">{b.name}</span>
                  <span className="block truncate text-xs text-muted-foreground">
                    Turns {b.turning} · {b.days_away === 1 ? "tomorrow" : `in ${b.days_away} days`}
                  </span>
                </span>
              </button>
            ))}
          </>
        )}
      </div>
    </div>
  );
}

// ── Upcoming ───────────────────────────────────────────────────────

/** "29 Oct, 9:00 AM" — the year only appears when it is not the current one,
 *  so rows stay one line in a 360px column. */
export function formatEventWhen(iso: string): string {
  const dateOnly = iso.length <= 10;
  const d = new Date(dateOnly ? `${iso}T00:00:00` : iso);
  if (Number.isNaN(d.getTime())) return iso;
  const sameYear = d.getFullYear() === new Date().getFullYear();
  const day = d.toLocaleDateString(undefined, {
    day: "numeric",
    month: "short",
    ...(sameYear ? {} : { year: "numeric" }),
  });
  if (dateOnly) return day;
  return `${day}, ${d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}`;
}

/** Placeholder rows while the summary loads — same rhythm as the real rows so
 *  the panel does not jump when the data lands. */
function UpcomingSkeleton() {
  return (
    <div className="space-y-2" aria-hidden>
      {[0, 1, 2].map((i) => (
        <div key={i} className="flex items-center gap-3 rounded-xl border px-3 py-2.5">
          <div className="h-9 w-9 shrink-0 animate-pulse rounded-lg bg-muted" />
          <div className="min-w-0 flex-1 space-y-1.5">
            <div className="h-3 w-2/3 animate-pulse rounded bg-muted" />
            <div className="h-2.5 w-1/2 animate-pulse rounded bg-muted" />
          </div>
        </div>
      ))}
    </div>
  );
}

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
    <div className="card-lift animate-rise rounded-2xl border bg-card p-5 shadow-sm">
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
      <div className="stagger mt-3 space-y-2">
        {loading ? (
          <UpcomingSkeleton />
        ) : events.length === 0 ? (
          <p className="py-2 text-sm text-muted-foreground">Nothing scheduled — enjoy the calm.</p>
        ) : (
          events.map((ev) => {
            const patientName = [ev.first_name, ev.last_name].filter(Boolean).join(" ");
            const isRecall = ev.kind === "recall";
            // The headline is the patient (or the free-text title for a block
            // like "Lunch"); everything else moves to the second line. Before,
            // the patient name was printed on both lines.
            const title = ev.title ?? (isRecall ? "Recall" : patientName || "Appointment");
            const detail = [
              ev.title ? patientName : "",
              ev.treatment_name ?? "",
              `${isRecall ? "Recall due" : ""} ${formatEventWhen(ev.start_time)}`.trim(),
            ].filter(Boolean);
            return (
              <button
                key={`${ev.kind}-${ev.id}`}
                type="button"
                onClick={() => navigate(ev.kind === "recall" ? "/patients" : "/agenda")}
                className="flex w-full items-center gap-3 rounded-xl border bg-sky-50/60 px-3 py-2.5 text-left transition-colors hover:bg-sky-100/60 dark:border-sky-900/60 dark:bg-sky-950/30 dark:hover:bg-sky-950/60"
              >
                <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-sky-500/15 text-sky-700 dark:text-sky-300">
                  <CalendarIcon className="h-4 w-4" />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-semibold">{title}</span>
                  <span className="block truncate text-xs text-muted-foreground">
                    {detail.join(" · ")}
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

