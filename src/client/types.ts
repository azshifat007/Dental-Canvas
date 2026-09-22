// ── Patient images & X-rays ───────────────────────────────────────

export type PatientImageKind = "xray" | "intraoral" | "panoramic" | "photo";

/**
 * A stored image/x-ray for a patient. `url` is either the stable public/CDN
 * URL or a short-lived presigned URL returned when the image list is loaded —
 * it expires after `storage_expiry_minutes`; reload the list to refresh.
 * `file_key` only ever leaves the server as an opaque reference.
 */
export interface PatientImage {
  id: number;
  patient_id: number;
  appointment_id: number | null;
  file_key?: string;
  file_name?: string | null;
  mime_type?: string;
  size_bytes?: number;
  kind: PatientImageKind;
  label?: string | null;
  compare_group?: string | null;
  uploaded_at: string;
  url: string | null;
}

export interface StorageStatus {
  provider: "none" | "db" | "s3" | "r2";
  enabled: boolean;
  endpoint: string;
  region: string;
  bucket: string;
  public_base_url: string;
  expiry_minutes: number;
  max_file_mb: number;
  access_key_id: string;
  has_secret: boolean;
}

// ── Core entities ──────────────────────────────────────────────────

export type PrescriptionTemplate =
  | "chamber"
  | "classic"
  | "modern"
  | "compact"
  | "elegant"
  | "minimal"
  | "bold"
  | "watermark";

export interface PrescriptionItem {
  id?: number;
  drug_name: string;
  dosage?: string | null;
  frequency?: string | null;
  duration?: string | null;
  instructions?: string | null;
  sort_order?: number;
}

export interface Prescription {
  id: number;
  patient_id: number;
  practitioner_id: number | null;
  issued_date: string;
  template: PrescriptionTemplate;
  /** Enlarged type for visually impaired patients — flows to every render surface. */
  large_print: number;
  /** Tooth this prescription relates to, e.g. '14' (FDI). */
  tooth: string | null;
  /** Linked treatment-plan procedure (informational — SET NULL on plan deletion). */
  plan_item_id: number | null;
  plan_treatment_name?: string | null;
  plan_treatment_code?: string | null;
  /** patient_images rows attached to the printed sheet (stored as JSON ids). */
  image_ids?: number[] | null;
  images?: PatientImage[];
  diagnosis: string | null;
  advice: string | null;
  follow_up: string | null;
  created_at: string;
  practitioner_name?: string | null;
  item_count?: number;
  items?: PrescriptionItem[];
  patient_first_name?: string | null;
  patient_last_name?: string | null;
  patient_date_of_birth?: string | null;
  patient_medical_alerts?: string | null;
  patient_email?: string | null;
  patient_phone?: string | null;
}

/** A medicine in the practice's editable formulary (Medicines). */
export interface Medicine {
  id: number;
  name: string;
  drug_group?: string | null;
  dosage?: string | null;
  frequency?: string | null;
  duration?: string | null;
  instructions?: string | null;
  created_at?: string;
}

export interface Operatory {
  id: number;
  name: string;
  color: string;
  sort_order: number;
  created_at: string;
}

export type PractitionerRole = "dentist" | "hygienist" | "assistant";

export interface Practitioner {
  id: number;
  name: string;
  role: PractitionerRole;
  color: string;
  email: string | null;
  phone: string | null;
  created_at: string;
}

export interface TreatmentType {
  id: number;
  code: string;
  name: string;
  duration_minutes: number;
  default_fee: number;
  color: string;
  created_at: string;
}

export interface Patient {
  id: number;
  first_name: string;
  last_name: string;
  date_of_birth: string | null;
  email: string | null;
  phone: string | null;
  address: string | null;
  medical_alerts: string | null;
  notes: string | null;
  referral_source: string | null;
  created_at: string;
}

export type AppointmentStatus =
  | "scheduled"
  | "confirmed"
  | "arrived"
  | "in_chair"
  | "completed"
  | "no_show"
  | "cancelled";

export type AppointmentKind = "patient" | "break" | "lunch" | "block";

export interface Appointment {
  id: number;
  patient_id: number | null;
  practitioner_id: number | null;
  operatory_id: number;
  treatment_type_id: number | null;
  start_time: string;
  end_time: string;
  status: AppointmentStatus;
  kind: AppointmentKind;
  title: string | null;
  notes: string | null;
  created_at: string;
  checked_in_at?: string | null;
  review_requested_at?: string | null;
  // Joined fields
  patient_first_name?: string | null;
  patient_last_name?: string | null;
  patient_date_of_birth?: string | null;
  practitioner_name?: string | null;
  practitioner_color?: string | null;
  operatory_name?: string | null;
  treatment_code?: string | null;
  treatment_name?: string | null;
  treatment_color?: string | null;
}

export interface NewAppointment {
  patient_id?: number | null;
  practitioner_id?: number | null;
  operatory_id: number;
  treatment_type_id?: number | null;
  start_time: string;
  end_time: string;
  status?: AppointmentStatus;
  kind?: AppointmentKind;
  title?: string | null;
  notes?: string | null;
}

export type TreatmentPlanStatus = "planned" | "accepted" | "completed" | "declined";

export interface TreatmentPlanItem {
  id: number;
  patient_id: number;
  treatment_type_id: number | null;
  tooth: string | null;
  surface: string | null;
  fee: number;
  status: TreatmentPlanStatus;
  notes: string | null;
  sort_order: number;
  created_at: string;
  treatment_code?: string | null;
  treatment_name?: string | null;
  treatment_color?: string | null;
}

export interface ClinicalNote {
  id: number;
  patient_id: number;
  practitioner_id: number | null;
  note_date: string;
  body: string;
  created_at: string;
  practitioner_name?: string | null;
}

export type ToothCondition =
  | "caries"
  | "restoration"
  | "crown"
  | "missing"
  | "implant"
  | "endo";

export interface ToothConditionRow {
  id: number;
  patient_id: number;
  tooth: string;
  surface: string | null;
  condition: ToothCondition;
  recorded_at: string;
}

export interface Invoice {
  id: number;
  patient_id: number;
  appointment_id: number | null;
  issued_at: string;
  status: "open" | "paid" | "void";
  total: number;
  amount_paid: number;
  notes: string | null;
  /** Computed by the API: total - amount_paid. */
  balance?: number;
}

export type PaymentMethod = "cash" | "card" | "transfer" | "insurance" | "other";

export interface InvoiceItem {
  id?: number;
  invoice_id?: number;
  treatment_type_id?: number | null;
  description: string;
  quantity: number;
  unit_price: number;
  sort_order?: number;
}

export interface InvoicePayment {
  id: number;
  invoice_id: number;
  amount: number;
  method: PaymentMethod;
  paid_at: string;
  note: string | null;
}

export interface WaitingListEntry {
  id: number;
  patient_id: number;
  treatment_type_id: number | null;
  preferred_practitioner_id: number | null;
  duration_minutes: number;
  notes: string | null;
  created_at: string;
  first_name?: string | null;
  last_name?: string | null;
  date_of_birth?: string | null;
  treatment_name?: string | null;
  treatment_color?: string | null;
  practitioner_name?: string | null;
}

export type InsuranceRank = "primary" | "secondary" | "tertiary";

// ── In-house membership plans ─────────────────────────────────

export interface MembershipPlan {
  id: number;
  name: string;
  monthly_fee: number;
  annual_fee: number | null;
  discount_percent: number;
  benefits: string | null;
  active: number | boolean;
  member_count?: number;
  created_at: string;
}

export interface PatientMembership {
  id: number;
  patient_id: number;
  plan_id: number;
  start_date: string;
  end_date: string | null;
  status: "active" | "cancelled" | "expired";
  last_billed_at: string | null;
  notes: string | null;
  created_at: string;
  plan_name?: string;
  monthly_fee?: number;
  annual_fee?: number | null;
  discount_percent?: number;
  benefits?: string | null;
}

// ── Digital consent forms ─────────────────────────────────────

export interface ConsentTemplate {
  id: number;
  title: string;
  body: string;
  requires_guardian: number | boolean;
  active: number | boolean;
  created_at: string;
}

export interface ConsentSignature {
  id: number;
  template_id: number;
  patient_id: number;
  appointment_id: number | null;
  signer_name: string;
  signer_role: "patient" | "guardian";
  signature_data: string;
  signed_at: string;
  template_title?: string;
}

export interface InsurancePlan {
  id: number;
  patient_id: number;
  rank: InsuranceRank;
  carrier: string;
  member_id: string | null;
  group_id: string | null;
  subscriber_name: string | null;
  subscriber_dob: string | null;
  effective_date: string | null;
  term_date: string | null;
  copay: number;
  deductible_total: number;
  deductible_used: number;
  max_annual: number;
  max_used: number;
  notes: string | null;
  created_at: string;
}

export type LabStatus = "sent" | "in_lab" | "received" | "seated" | "cancelled";

export interface LabCase {
  id: number;
  patient_id: number;
  practitioner_id: number | null;
  treatment_type_id: number | null;
  lab_name: string;
  case_type: string;
  tooth: string | null;
  shade: string | null;
  fee: number;
  sent_at: string | null;
  due_at: string | null;
  received_at: string | null;
  seated_at: string | null;
  status: LabStatus;
  notes: string | null;
  created_at: string;
  first_name?: string | null;
  last_name?: string | null;
  practitioner_name?: string | null;
  treatment_code?: string | null;
  treatment_name?: string | null;
}

export interface ReportsSummary {
  today_appointments: number;
  week_appointments: number;
  month_appointments: number;
  month_completed: number;
  month_no_shows: number;
  month_cancelled: number;
  month_production: number;
  month_collections: number;
  by_treatment: { name: string; n: number; total: number }[];
  by_source: { source: string; n: number }[];
  aged_receivables: Record<"0-30" | "31-60" | "61-90" | "90+", number>;
  overdue_lab_cases: number;
  waiting_list_count: number;
  case_acceptance: {
    presented: number;
    accepted: number;
    completed: number;
    declined: number;
    rate: number | null;
  };
  by_provider: { name: string; production: number; collections: number; visits: number }[];
}

/** A patient with accepted treatment but no upcoming appointment. */
export interface UnscheduledTreatmentRow {
  item_id: number;
  patient_id: number;
  tooth: string | null;
  fee: number;
  status: string;
  created_at: string;
  first_name: string | null;
  last_name: string | null;
  phone: string | null;
  email: string | null;
  treatment_name: string | null;
  next_appt: string | null;
}

/** A patient who hasn't visited in the dormant window. */
export interface DormantPatientRow {
  id: number;
  first_name: string | null;
  last_name: string | null;
  phone: string | null;
  email: string | null;
  last_visit: string | null;
  total_spent: number;
}

export interface FollowUpsResponse {
  unscheduled_treatment: UnscheduledTreatmentRow[];
  dormant_patients: DormantPatientRow[];
  dormant_months: number;
}

/** A scheduled appointment upcoming within the reminder window. */
export interface ReminderRow {
  id: number;
  patient_id: number | null;
  start_time: string;
  status: string;
  first_name: string | null;
  last_name: string | null;
  phone: string | null;
  email: string | null;
  treatment_name: string | null;
  operatory_name: string | null;
  practitioner_name: string | null;
  reminded_at: string | null;
}

/** An unpaid installment due now or within the reminder window. */
export interface PaymentReminderRow {
  plan_id: number;
  invoice_id: number;
  patient_id: number;
  installment_n: number;
  due_date: string;
  amount: number;
  days_until_due: number;
  overdue: boolean;
  balance: number;
  patient_name: string;
  phone: string | null;
  payment_plan_reminded_at: string | null;
}

/** A completed appointment whose patient hasn't been asked for a review yet. */
export interface ReviewRequestRow {
  id: number;
  patient_id: number | null;
  end_time: string;
  first_name: string | null;
  last_name: string | null;
  phone: string | null;
  treatment_name: string | null;
  practitioner_name: string | null;
  review_requested_at: string | null;
}

export type ToMakeSource = "reception" | "patient" | "system";

// ── Search ─────────────────────────────────────────────────────────

export type SearchEntityType =
  | "patients"
  | "appointments"
  | "treatment_plan_items"
  | "clinical_notes"
  | "invoices"
  | "invoice_items"
  | "insurance_plans"
  | "lab_cases"
  | "waiting_list"
  | "appointments_to_make"
  | "tooth_conditions"
  | "operatories"
  | "practitioners"
  | "treatment_types"
  | "inventory_items";

/** One result from GET /api/search; [bracketed] terms are highlights. */
export interface SearchHit {
  entity_type: SearchEntityType;
  id: number;
  patient_id: number | null;
  title: string;
  snippet: string;
  rank: number | null;
}

export interface SearchResponse {
  hits: SearchHit[];
  via: "fts5" | "like";
}

export interface AppointmentToMake {
  id: number;
  patient_id: number;
  treatment_type_id: number | null;
  due_after: string | null;
  source: ToMakeSource;
  notes: string | null;
  status: "open" | "scheduled" | "cancelled";
  created_at: string;
  first_name?: string | null;
  last_name?: string | null;
  date_of_birth?: string | null;
  treatment_name?: string | null;
  treatment_color?: string | null;
}

// ── Inventory ───────────────────────────────────────────────────

export type InventoryAlertKind = "out_of_stock" | "low_stock" | "expiring" | "expired";
export type InventoryAlertSeverity = "critical" | "warning" | "info";

export interface InventoryItem {
  id: number;
  name: string;
  category: string | null;
  sku: string | null;
  unit: string;
  current_stock: number;
  min_threshold: number;
  reorder_quantity: number | null;
  supplier_name: string | null;
  supplier_contact: string | null;
  batch_number: string | null;
  expiry_date: string | null;
  location: string | null;
  unit_cost: number;
  notes: string | null;
  active: number;
  created_at: string;
  updated_at: string;
}

export interface InventoryMovement {
  id: number;
  item_id: number;
  type: "in" | "out" | "adjust";
  quantity: number;
  balance_after: number;
  unit_cost: number | null;
  reference: string | null;
  reason: string | null;
  notes: string | null;
  performed_at: string;
  created_at: string;
}

export interface InventoryAlert {
  id: number;
  item_id: number;
  kind: InventoryAlertKind;
  severity: InventoryAlertSeverity;
  message: string;
  resolved: number;
  resolved_at: string | null;
  created_at: string;
  item_name?: string | null;
}

export interface InventoryScanResult {
  scanned_at: string;
  created: { item_id: number; kind: InventoryAlertKind; severity: InventoryAlertSeverity; message: string }[];
  resolved: number;
  open: number;
  by_kind: Record<InventoryAlertKind, number>;
  emailed: boolean;
  email_recipient: string | null;
}
