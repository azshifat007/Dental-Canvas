// ── Core entities ──────────────────────────────────────────────────

export type PrescriptionTemplate = "classic" | "modern" | "compact" | "elegant" | "minimal" | "bold" | "watermark";

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
  diagnosis: string | null;
  advice: string | null;
  follow_up: string | null;
  share_token: string | null;
  share_revoked: number;
  created_at: string;
  practitioner_name?: string | null;
  item_count?: number;
  items?: PrescriptionItem[];
  patient_first_name?: string | null;
  patient_last_name?: string | null;
  patient_date_of_birth?: string | null;
  patient_medical_alerts?: string | null;
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
  | "treatment_types";

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
