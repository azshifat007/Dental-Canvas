/**
 * First-run seed data.
 *
 * These rows used to live at the bottom of `schema.sql`. A Clawnify deploy
 * applies that file as DDL only — a single INSERT fails the whole deploy — so
 * they are inserted by the app instead, on the first request that reaches it.
 * See `ensureSeeded` in `index.ts`.
 */

import { DENTAL_DRUGS } from "../client/lib/dental-drugs";

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
  // Clinic logo as a data URL (image/*;base64) — rendered on prescription
  // and invoice letterheads. Kept small client-side; empty = no logo.
  clinic_logo: "",
  // Fixed practice instructions printed in the Chamber template's footer
  // (e.g. emergency contact, "report fever after extraction"). Newline =
  // new line on the sheet; empty = footer shows only the contact row.
  chamber_footer_instructions: "",
  // Prescription email delivery (via the Resend HTTP API). Both empty =
  // emailing disabled; the print view's Email button explains the setup.
  email_api_key: "",
  email_from: "",
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

/**
 * Inventory alert defaults, stored in the shared `settings` table so they
 * survive redeploys and are editable from the Inventory page. Merged into the
 * `/api/settings` response alongside the practice/backup defaults.
 */
export const DEFAULT_INVENTORY_SETTINGS: Record<string, string> = {
  /** Products expiring within this many days raise an "expiring" alert. */
  inventory_expiry_alert_days: "30",
  /** If set (and email is configured) the daily scan emails this address. */
  inventory_alert_email: "",
};

/**
 * Image object-storage defaults (Settings → Storage). "none" = uploads
 * disabled until the practice points the app at an S3-compatible bucket
 * (AWS S3, Cloudflare R2, MinIO, …). Credentials are read server-side only
 * and masked wherever settings are returned to the browser.
 */
export const DEFAULT_STORAGE_SETTINGS: Record<string, string> = {
  /** 'db' (built-in database storage) | 'none' | 's3' | 'r2' */
  storage_provider: "db",
  /** S3-compatible endpoint origin (https), e.g. https://<acct>.r2.cloudflarestorage.com */
  storage_endpoint: "",
  storage_region: "auto",
  storage_bucket: "",
  storage_access_key_id: "",
  storage_secret_access_key: "",
  /** Optional public base URL prefix for stable display URLs, e.g. https://img.example.com */
  storage_public_base_url: "",
  /** Presigned upload/download lifetime in minutes. */
  storage_expiry_minutes: "15",
  /** Maximum single-file upload in megabytes. */
  storage_max_file_mb: "25",
};

/**
 * Bump this when the built-in medicine presets gain new entries. On first
 * run the whole list is seeded; afterwards the app only inserts presets whose
 * names aren't already in the list (so a user who deleted one keeps it
 * deleted until a new version ships).
 */
export const MEDICINES_PRESETS_VERSION = "2026-09-20";

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

export interface SeedMedicine {
  name: string;
  drug_group: string;
  dosage: string;
  frequency: string;
  duration: string;
  instructions: string;
}

/**
 * The practice's starter medicine list — the built-in dental presets. Seeded
 * into the `medicines` table the first time the app runs (only while the
 * table is empty), so removing a medicine is never undone by a redeploy.
 * One source of truth with the prescription autocomplete: the same library
 * powers both.
 */
export const SEED_MEDICINES: SeedMedicine[] = DENTAL_DRUGS.map((d) => ({
  name: d.name,
  drug_group: d.group,
  dosage: d.dosage,
  frequency: d.frequency,
  duration: d.duration,
  instructions: d.instructions,
}));

export const SEED_DENTIST_NOTES: SeedDentistNote[] = [
  { body: "Order more composite resin (shade A2) before Friday's restorative cases." },
  { body: "Reminder: confirm the sterilization cycle log was signed off this week." },
];

export interface SeedInventoryItem {
  name: string;
  category: string;
  sku: string;
  unit: string;
  current_stock: number;
  min_threshold: number;
  reorder_quantity: number;
  supplier_name: string;
  supplier_contact: string;
  batch_number: string;
  // Relative to "today": null = no expiry date set.
  expiry_offset_days: number | null;
  location: string;
  unit_cost: number;
  notes: string;
}

/**
 * Starter dental-supply stock so the Inventory page, dashboard alert panel and
 * the daily scan have real data on a fresh practice. Mirrors the medicines
 * seeding rules: inserted only while `inventory_items` is empty, so a practice
 * that deletes or reorders items is never re-seeded by a redeploy. Expiry dates
 * are computed relative to the first-run date so the expiring/low-stock alerts
 * show up immediately on a new install.
 */
export const SEED_INVENTORY: SeedInventoryItem[] = [
  {
    name: "Nitrile Exam Gloves (Medium)",
    category: "PPE",
    sku: "PPE-GLOVE-M",
    unit: "box",
    current_stock: 12,
    min_threshold: 25,
    reorder_quantity: 50,
    supplier_name: "MedAlliance Suppliers",
    supplier_contact: "orders@medalliance.example",
    batch_number: "BG-22041",
    expiry_offset_days: null,
    location: "Store room B",
    unit_cost: 9.5,
    notes: "100 gloves per box.",
  },
  {
    name: "Filtek Z250 Composite Resin (A2)",
    category: "Restorative",
    sku: "RES-FIL-Z250-A2",
    unit: "box",
    current_stock: 0,
    min_threshold: 4,
    reorder_quantity: 16,
    supplier_name: "3M Dental Direct",
    supplier_contact: "sales@3mdental.example",
    batch_number: "3M-FZ250-11942",
    expiry_offset_days: 240,
    location: "Operatory cabinets",
    unit_cost: 64.0,
    notes: "5 syringes per box; backfill shade A1 & A3 too.",
  },
  {
    name: "Lidocaine 2% with Epinephrine (1.7 ml cartridge)",
    category: "Anesthetics",
    sku: "ANE-LIDO-2",
    unit: "cartridge",
    current_stock: 96,
    min_threshold: 30,
    reorder_quantity: 100,
    supplier_name: "Dental Depot",
    supplier_contact: "info@dentaldepot.example",
    batch_number: "DD-LIDO-8A2",
    expiry_offset_days: 180,
    location: "Fridge (top shelf)",
    unit_cost: 0.65,
    notes: "Store refrigerated; warm to room temp before use.",
  },
  {
    name: "Sterilization Pouches (5.5\" x 9\")",
    category: "Sterilization",
    sku: "STE-POUCH-559",
    unit: "pack",
    current_stock: 180,
    min_threshold: 50,
    reorder_quantity: 200,
    supplier_name: "SteriTech Co.",
    supplier_contact: "support@steritech.example",
    batch_number: "ST-P559-771",
    expiry_offset_days: null,
    location: "Central sterilization room",
    unit_cost: 12.0,
    notes: "200 pouches per pack.",
  },
  {
    name: "Rubber Dam Sheets (Medium)",
    category: "Consumables",
    sku: "CON-RDAM-M",
    unit: "box",
    current_stock: 40,
    min_threshold: 12,
    reorder_quantity: 24,
    supplier_name: "Dental Depot",
    supplier_contact: "info@dentaldepot.example",
    batch_number: "DD-RDAM-441",
    expiry_offset_days: 18,
    location: "Operatory cabinets",
    unit_cost: 18.0,
    notes: "Latex-free; 36 sheets per box.",
  },
  {
    name: "Amalgam Capsules (High Copper)",
    category: "Restorative",
    sku: "RES-AMAL-HC",
    unit: "box",
    current_stock: 3,
    min_threshold: 10,
    reorder_quantity: 20,
    supplier_name: "MedAlliance Suppliers",
    supplier_contact: "orders@medalliance.example",
    batch_number: "MA-AMAL-902",
    expiry_offset_days: 320,
    location: "Store room A",
    unit_cost: 34.0,
    notes: "Pre-dosed 400 mg capsules.",
  },
  {
    name: "Endodontic Files #25 (pack of 20)",
    category: "Endodontic",
    sku: "ENDO-FILE-25",
    unit: "pack",
    current_stock: 16,
    min_threshold: 8,
    reorder_quantity: 20,
    supplier_name: "3M Dental Direct",
    supplier_contact: "sales@3mdental.example",
    batch_number: "3M-EF25-3301",
    expiry_offset_days: 420,
    location: "Operatory cabinets",
    unit_cost: 26.5,
    notes: "Stainless steel hand files.",
  },
  {
    name: "Temporary Crowns (Anterior, Assorted)",
    category: "Prosthodontic",
    sku: "PRO-TCROWN-ANT",
    unit: "box",
    current_stock: 6,
    min_threshold: 2,
    reorder_quantity: 6,
    supplier_name: "3M Dental Direct",
    supplier_contact: "sales@3mdental.example",
    batch_number: "3M-TC-A2A-118",
    expiry_offset_days: null,
    location: "Store room B",
    unit_cost: 28.0,
    notes: "",
  },
];
