/**
 * First-run seed data.
 *
 * These rows used to live at the bottom of `schema.sql`. A Clawnify deploy
 * applies that file as DDL only — a single INSERT fails the whole deploy — so
 * they are inserted by the app instead, on the first request that reaches it.
 * See `ensureSeeded` in `index.ts`.
 */

export interface SeedOperatory {
  name: string;
  color: string;
  sort_order: number;
}

export interface SeedPractitioner {
  name: string;
  role: string;
  color: string;
}

export interface SeedTreatmentType {
  code: string;
  name: string;
  duration_minutes: number;
  default_fee: number;
  color: string;
}

/**
 * Practice defaults: the day starts 07:00 and ends 19:00, in minutes from
 * midnight. These three keys drive the agenda grid, so every read of
 * `settings` falls back to them — the calendar renders correctly even on the
 * very first request, before the seed has run.
 */
export const DEFAULT_SETTINGS: Record<string, string> = {
  day_start_minute: "420",
  day_end_minute: "1140",
  slot_minutes: "15",
};

/**
 * Practice profile defaults, shown on the dashboard (greeting, avatar) and
 * editable under Settings → Profile. `doctor_name` starts empty on purpose:
 * the practice fills it in, which is what makes the dashboard greeting
 * personal (“Good Morning, Dr. Sarah 👋”).
 */
export const DEFAULT_PROFILE_SETTINGS: Record<string, string> = {
  doctor_name: "",
  doctor_specialty: "Dentist",
  clinic_name: "",
  doctor_email: "",
  doctor_phone: "",
  doctor_license: "",
  clinic_address: "",
};

/**
 * Auto-backup schedule defaults. `auto_backup_interval_minutes = 0` means the
 * timer is off; the client keeps a countdown and calls the snapshot endpoint
 * whenever it fires (works on both local dev and serverless deploys).
 */
export const DEFAULT_BACKUP_SETTINGS: Record<string, string> = {
  auto_backup_interval_minutes: "0",
  auto_backup_keep: "10",
};

export const SEED_OPERATORIES: SeedOperatory[] = [
  { name: "Op 1", color: "sky", sort_order: 0 },
  { name: "Op 2", color: "emerald", sort_order: 1 },
  { name: "Op 3", color: "amber", sort_order: 2 },
];

export const SEED_PRACTITIONERS: SeedPractitioner[] = [
  { name: "Dr. Lee", role: "dentist", color: "teal" },
  { name: "Dr. Patel", role: "dentist", color: "violet" },
  { name: "Sarah Kim", role: "hygienist", color: "rose" },
];

export interface SeedDentistNote {
  body: string;
}

export const SEED_TREATMENT_TYPES: SeedTreatmentType[] = [
  { code: "EXAM", name: "Exam & Cleaning", duration_minutes: 30, default_fee: 120, color: "sky" },
  { code: "FILL", name: "Restoration / Filling", duration_minutes: 45, default_fee: 220, color: "amber" },
  { code: "CROWN", name: "Crown", duration_minutes: 90, default_fee: 1100, color: "violet" },
  { code: "ENDO", name: "Root Canal", duration_minutes: 90, default_fee: 950, color: "rose" },
  { code: "EXT", name: "Extraction", duration_minutes: 30, default_fee: 250, color: "orange" },
  { code: "CONS", name: "Consultation", duration_minutes: 20, default_fee: 80, color: "emerald" },
];

export const SEED_DENTIST_NOTES: SeedDentistNote[] = [
  { body: "Order more composite resin (shade A2) before Friday's restorative cases." },
  { body: "Reminder: confirm the sterilization cycle log was signed off this week." },
];
