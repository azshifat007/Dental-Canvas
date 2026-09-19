import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/** Map a color token (e.g. "sky") to a set of Tailwind classes for a card surface.
 *  Each color carries dark: variants so appointment cards stay readable with
 *  the dark theme (emitted via the @source inline block in styles.css). */
export const colorPalette = {
  sky:     { bg: "bg-sky-100 dark:bg-sky-950/60",         border: "border-sky-300 dark:border-sky-800",         text: "text-sky-900 dark:text-sky-100",         ring: "ring-sky-400",     dot: "bg-sky-500" },
  emerald: { bg: "bg-emerald-100 dark:bg-emerald-950/60",     border: "border-emerald-300 dark:border-emerald-800",     text: "text-emerald-900 dark:text-emerald-100",     ring: "ring-emerald-400", dot: "bg-emerald-500" },
  amber:   { bg: "bg-amber-100 dark:bg-amber-950/60",       border: "border-amber-300 dark:border-amber-800",       text: "text-amber-900 dark:text-amber-100",       ring: "ring-amber-400",   dot: "bg-amber-500" },
  rose:    { bg: "bg-rose-100 dark:bg-rose-950/60",       border: "border-rose-300 dark:border-rose-800",       text: "text-rose-900 dark:text-rose-100",       ring: "ring-rose-400",    dot: "bg-rose-500" },
  violet:  { bg: "bg-violet-100 dark:bg-violet-950/60",   border: "border-violet-300 dark:border-violet-800",   text: "text-violet-900 dark:text-violet-100",   ring: "ring-violet-400",  dot: "bg-violet-500" },
  fuchsia: { bg: "bg-fuchsia-100 dark:bg-fuchsia-950/60", border: "border-fuchsia-300 dark:border-fuchsia-800", text: "text-fuchsia-900 dark:text-fuchsia-100", ring: "ring-fuchsia-400", dot: "bg-fuchsia-500" },
  teal:    { bg: "bg-teal-100 dark:bg-teal-950/60",       border: "border-teal-300 dark:border-teal-800",       text: "text-teal-900 dark:text-teal-100",       ring: "ring-teal-400",    dot: "bg-teal-500" },
  orange:  { bg: "bg-orange-100 dark:bg-orange-950/60",   border: "border-orange-300 dark:border-orange-800",   text: "text-orange-900 dark:text-orange-100",   ring: "ring-orange-400",  dot: "bg-orange-500" },
  slate:   { bg: "bg-slate-100 dark:bg-slate-950/60",     border: "border-slate-300 dark:border-slate-800",     text: "text-slate-900 dark:text-slate-100",     ring: "ring-slate-400",   dot: "bg-slate-500" },
} as const;

export type ColorToken = keyof typeof colorPalette;

export function colorClasses(token: string | null | undefined): typeof colorPalette[ColorToken] {
  return colorPalette[(token as ColorToken)] ?? colorPalette.sky;
}

/** Format an ISO date string 'YYYY-MM-DD' or full datetime to a short date label. */
export function formatDate(iso: string | null | undefined, opts?: Intl.DateTimeFormatOptions): string {
  if (!iso) return "";
  const d = new Date(iso.length <= 10 ? `${iso}T00:00:00` : iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString(undefined, opts ?? { year: "numeric", month: "short", day: "numeric" });
}

/** Format an ISO datetime to HH:MM. */
export function formatTime(iso: string | null | undefined): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", hour12: false });
}

/** YYYY-MM-DD for a given Date in local time. */
export function toIsoDate(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

/** Build a local-time ISO datetime 'YYYY-MM-DDTHH:MM:00' for a given date + minutes-from-midnight. */
export function localDateTime(date: string, minutesFromMidnight: number): string {
  const h = Math.floor(minutesFromMidnight / 60);
  const m = minutesFromMidnight % 60;
  return `${date}T${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:00`;
}

/** Minutes-from-midnight of a local datetime ISO string. */
export function minutesOfDay(iso: string): number {
  const d = new Date(iso);
  return d.getHours() * 60 + d.getMinutes();
}

/** Age in years from a 'YYYY-MM-DD' date of birth, e.g. "32 yrs". */
export function ageFromDob(dob: string | null | undefined): string | null {
  if (!dob) return null;
  const d = new Date(`${dob}T00:00:00`);
  if (Number.isNaN(d.getTime())) return null;
  const now = new Date();
  let age = now.getFullYear() - d.getFullYear();
  const m = now.getMonth() - d.getMonth();
  if (m < 0 || (m === 0 && now.getDate() < d.getDate())) age--;
  return `${age} yrs`;
}
