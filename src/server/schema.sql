-- ── Practice settings (key/value) ───────────────────────────────
CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Defaults (day_start_minute 420, day_end_minute 1140, slot_minutes 15) are
-- inserted by the app on first run — see `ensureSeeded` in src/server/index.ts.
-- This file is applied as DDL only, so it must contain no INSERT statements.

-- ── Operatories (treatment rooms / chairs) ──────────────────────
CREATE TABLE IF NOT EXISTS operatories (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  color TEXT NOT NULL DEFAULT 'sky',
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- ── Practitioners (dentists, hygienists, assistants) ────────────
CREATE TABLE IF NOT EXISTS practitioners (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'dentist', -- 'dentist' | 'hygienist' | 'assistant'
  color TEXT NOT NULL DEFAULT 'teal',
  email TEXT,
  phone TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- ── Treatment types (procedures) ────────────────────────────────
CREATE TABLE IF NOT EXISTS treatment_types (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  code TEXT NOT NULL,                   -- e.g. 'D1110' (ADA code) or short label
  name TEXT NOT NULL,                   -- e.g. 'Adult Prophylaxis'
  duration_minutes INTEGER NOT NULL DEFAULT 30,
  default_fee REAL NOT NULL DEFAULT 0,
  color TEXT NOT NULL DEFAULT 'sky',
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- ── Patients ────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS patients (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  first_name TEXT NOT NULL,
  last_name TEXT NOT NULL,
  date_of_birth TEXT,                   -- ISO date 'YYYY-MM-DD'
  email TEXT,
  phone TEXT,
  address TEXT,
  medical_alerts TEXT,                  -- comma-separated tags: 'allergy:penicillin,heart-condition'
  notes TEXT,
  referral_source TEXT,                 -- e.g. 'Google', 'Facebook', 'Yelp', 'Friend', 'Walk-in', 'Other'
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_patients_name ON patients(last_name, first_name);

-- ── Appointments ────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS appointments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  patient_id INTEGER REFERENCES patients(id) ON DELETE SET NULL,
  practitioner_id INTEGER REFERENCES practitioners(id) ON DELETE SET NULL,
  operatory_id INTEGER NOT NULL REFERENCES operatories(id) ON DELETE CASCADE,
  treatment_type_id INTEGER REFERENCES treatment_types(id) ON DELETE SET NULL,
  start_time TEXT NOT NULL,             -- ISO datetime 'YYYY-MM-DDTHH:MM:SS'
  end_time TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'scheduled', -- 'scheduled' | 'arrived' | 'in_chair' | 'completed' | 'no_show' | 'cancelled'
  kind TEXT NOT NULL DEFAULT 'patient',     -- 'patient' | 'break' | 'lunch' | 'block'
  title TEXT,                           -- override title (used for break/lunch/block)
  notes TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_appointments_start ON appointments(start_time);
CREATE INDEX IF NOT EXISTS idx_appointments_op_start ON appointments(operatory_id, start_time);
CREATE INDEX IF NOT EXISTS idx_appointments_patient ON appointments(patient_id);

-- ── Treatment plans ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS treatment_plan_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  patient_id INTEGER NOT NULL REFERENCES patients(id) ON DELETE CASCADE,
  treatment_type_id INTEGER REFERENCES treatment_types(id) ON DELETE SET NULL,
  tooth TEXT,                           -- e.g. '14' (FDI) or '#3' (Universal)
  surface TEXT,                         -- 'M' | 'O' | 'D' | 'B' | 'L' | combinations
  fee REAL NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'planned', -- 'planned' | 'accepted' | 'completed' | 'declined'
  notes TEXT,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_plan_patient ON treatment_plan_items(patient_id);

-- ── Clinical notes ──────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS clinical_notes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  patient_id INTEGER NOT NULL REFERENCES patients(id) ON DELETE CASCADE,
  practitioner_id INTEGER REFERENCES practitioners(id) ON DELETE SET NULL,
  note_date TEXT NOT NULL DEFAULT (datetime('now')),
  body TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_notes_patient ON clinical_notes(patient_id, note_date DESC);

-- ── Tooth chart conditions ──────────────────────────────────────
CREATE TABLE IF NOT EXISTS tooth_conditions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  patient_id INTEGER NOT NULL REFERENCES patients(id) ON DELETE CASCADE,
  tooth TEXT NOT NULL,                  -- '11'..'48' (FDI) or '1'..'32' (Universal)
  surface TEXT,                         -- 'M' | 'O' | 'D' | 'B' | 'L' | NULL for whole-tooth
  condition TEXT NOT NULL,              -- 'caries' | 'restoration' | 'crown' | 'missing' | 'implant' | 'endo'
  recorded_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_tooth_patient ON tooth_conditions(patient_id);

-- ── Invoices ────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS invoices (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  patient_id INTEGER NOT NULL REFERENCES patients(id) ON DELETE CASCADE,
  appointment_id INTEGER REFERENCES appointments(id) ON DELETE SET NULL,
  issued_at TEXT NOT NULL DEFAULT (datetime('now')),
  status TEXT NOT NULL DEFAULT 'open',  -- 'open' | 'paid' | 'void'
  total REAL NOT NULL DEFAULT 0,
  amount_paid REAL NOT NULL DEFAULT 0,
  notes TEXT
);

CREATE INDEX IF NOT EXISTS idx_invoices_patient ON invoices(patient_id);

CREATE TABLE IF NOT EXISTS invoice_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  invoice_id INTEGER NOT NULL REFERENCES invoices(id) ON DELETE CASCADE,
  treatment_type_id INTEGER REFERENCES treatment_types(id) ON DELETE SET NULL,
  description TEXT NOT NULL,
  quantity INTEGER NOT NULL DEFAULT 1,
  unit_price REAL NOT NULL DEFAULT 0,
  sort_order INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_invoice_items_invoice ON invoice_items(invoice_id);

-- ── Waiting list ────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS waiting_list (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  patient_id INTEGER NOT NULL REFERENCES patients(id) ON DELETE CASCADE,
  treatment_type_id INTEGER REFERENCES treatment_types(id) ON DELETE SET NULL,
  preferred_practitioner_id INTEGER REFERENCES practitioners(id) ON DELETE SET NULL,
  duration_minutes INTEGER NOT NULL DEFAULT 30,
  notes TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- ── Insurance plans ────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS insurance_plans (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  patient_id INTEGER NOT NULL REFERENCES patients(id) ON DELETE CASCADE,
  rank TEXT NOT NULL DEFAULT 'primary', -- 'primary' | 'secondary' | 'tertiary'
  carrier TEXT NOT NULL,
  member_id TEXT,
  group_id TEXT,
  subscriber_name TEXT,
  subscriber_dob TEXT,                  -- ISO 'YYYY-MM-DD'
  effective_date TEXT,
  term_date TEXT,
  copay REAL NOT NULL DEFAULT 0,
  deductible_total REAL NOT NULL DEFAULT 0,
  deductible_used REAL NOT NULL DEFAULT 0,
  max_annual REAL NOT NULL DEFAULT 0,
  max_used REAL NOT NULL DEFAULT 0,
  notes TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_insurance_patient ON insurance_plans(patient_id);

-- ── Lab cases (outbound lab work — crowns, dentures, aligners) ──
CREATE TABLE IF NOT EXISTS lab_cases (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  patient_id INTEGER NOT NULL REFERENCES patients(id) ON DELETE CASCADE,
  practitioner_id INTEGER REFERENCES practitioners(id) ON DELETE SET NULL,
  treatment_type_id INTEGER REFERENCES treatment_types(id) ON DELETE SET NULL,
  lab_name TEXT NOT NULL,
  case_type TEXT NOT NULL,              -- e.g. 'Crown', 'Bridge', 'Denture', 'Aligner', 'Night Guard'
  tooth TEXT,                           -- e.g. '14' or 'multiple'
  shade TEXT,                           -- VITA shade, e.g. 'A2'
  fee REAL NOT NULL DEFAULT 0,
  sent_at TEXT,                         -- ISO datetime
  due_at TEXT,                          -- promised return date
  received_at TEXT,                     -- when it came back
  seated_at TEXT,                       -- when it was placed in the patient
  status TEXT NOT NULL DEFAULT 'sent',  -- 'sent' | 'in_lab' | 'received' | 'seated' | 'cancelled'
  notes TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_lab_patient ON lab_cases(patient_id);
CREATE INDEX IF NOT EXISTS idx_lab_status ON lab_cases(status);

-- ── Appointments to make (recall reminders) ────────────────────
CREATE TABLE IF NOT EXISTS appointments_to_make (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  patient_id INTEGER NOT NULL REFERENCES patients(id) ON DELETE CASCADE,
  treatment_type_id INTEGER REFERENCES treatment_types(id) ON DELETE SET NULL,
  due_after TEXT,                       -- ISO date 'YYYY-MM-DD'
  source TEXT NOT NULL DEFAULT 'reception', -- 'reception' | 'patient' | 'system'
  notes TEXT,
  status TEXT NOT NULL DEFAULT 'open',  -- 'open' | 'scheduled' | 'cancelled'
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- ── Full-text search (FTS5) ────────────────────────────────────
-- One inverted index across every searchable entity. `title` and `body` are the
-- searchable columns (snippet() reads column 4 = body); entity_type/entity_id/
-- patient_id are UNINDEXED metadata used to join back to source tables.
-- Rows are kept in sync by the triggers below; pre-existing data is backfilled
-- once by `ensureSearchIndex` in src/server/search.ts (INSERTs cannot live in
-- this file — a Clawnify deploy applies it as DDL only).
CREATE VIRTUAL TABLE IF NOT EXISTS search_index USING fts5(
  entity_type UNINDEXED,
  entity_id UNINDEXED,
  patient_id UNINDEXED,
  title,
  body,
  tokenize = 'porter unicode61'
);

CREATE TRIGGER IF NOT EXISTS search_patients_ai AFTER INSERT ON patients BEGIN
  INSERT INTO search_index (entity_type, entity_id, patient_id, title, body) VALUES ('patients', NEW.id, NEW.id, NEW.last_name || ', ' || NEW.first_name,
    TRIM(COALESCE(NEW.email,'') || ' ' || COALESCE(NEW.phone,'') || ' ' || COALESCE(NEW.address,'') || ' ' || COALESCE(NEW.medical_alerts,'') || ' ' || COALESCE(NEW.notes,'') || ' ' || COALESCE(NEW.referral_source,'')));
END;
CREATE TRIGGER IF NOT EXISTS search_patients_ad AFTER DELETE ON patients BEGIN
  DELETE FROM search_index WHERE entity_type = 'patients' AND entity_id = OLD.id;
END;
CREATE TRIGGER IF NOT EXISTS search_patients_au AFTER UPDATE ON patients BEGIN
  DELETE FROM search_index WHERE entity_type = 'patients' AND entity_id = OLD.id;
  INSERT INTO search_index (entity_type, entity_id, patient_id, title, body) VALUES ('patients', NEW.id, NEW.id, NEW.last_name || ', ' || NEW.first_name,
    TRIM(COALESCE(NEW.email,'') || ' ' || COALESCE(NEW.phone,'') || ' ' || COALESCE(NEW.address,'') || ' ' || COALESCE(NEW.medical_alerts,'') || ' ' || COALESCE(NEW.notes,'') || ' ' || COALESCE(NEW.referral_source,'')));
END;

CREATE TRIGGER IF NOT EXISTS search_appointments_ai AFTER INSERT ON appointments BEGIN
  INSERT INTO search_index (entity_type, entity_id, patient_id, title, body) VALUES ('appointments', NEW.id, NEW.patient_id,
    COALESCE(NULLIF(NEW.title,''), (SELECT tt.name FROM treatment_types tt WHERE tt.id = NEW.treatment_type_id), 'Appointment'),
    TRIM(COALESCE(NEW.notes,'') || ' ' || COALESCE((SELECT p.first_name || ' ' || p.last_name FROM patients p WHERE p.id = NEW.patient_id), '')));
END;
CREATE TRIGGER IF NOT EXISTS search_appointments_ad AFTER DELETE ON appointments BEGIN
  DELETE FROM search_index WHERE entity_type = 'appointments' AND entity_id = OLD.id;
END;
CREATE TRIGGER IF NOT EXISTS search_appointments_au AFTER UPDATE ON appointments BEGIN
  DELETE FROM search_index WHERE entity_type = 'appointments' AND entity_id = OLD.id;
  INSERT INTO search_index (entity_type, entity_id, patient_id, title, body) VALUES ('appointments', NEW.id, NEW.patient_id,
    COALESCE(NULLIF(NEW.title,''), (SELECT tt.name FROM treatment_types tt WHERE tt.id = NEW.treatment_type_id), 'Appointment'),
    TRIM(COALESCE(NEW.notes,'') || ' ' || COALESCE((SELECT p.first_name || ' ' || p.last_name FROM patients p WHERE p.id = NEW.patient_id), '')));
END;

CREATE TRIGGER IF NOT EXISTS search_treatment_plan_items_ai AFTER INSERT ON treatment_plan_items BEGIN
  INSERT INTO search_index (entity_type, entity_id, patient_id, title, body) VALUES ('treatment_plan_items', NEW.id, NEW.patient_id,
    COALESCE((SELECT tt.name FROM treatment_types tt WHERE tt.id = NEW.treatment_type_id), 'Treatment') || CASE WHEN NEW.tooth IS NOT NULL THEN ' - tooth ' || NEW.tooth ELSE '' END,
    COALESCE(NEW.notes,''));
END;
CREATE TRIGGER IF NOT EXISTS search_treatment_plan_items_ad AFTER DELETE ON treatment_plan_items BEGIN
  DELETE FROM search_index WHERE entity_type = 'treatment_plan_items' AND entity_id = OLD.id;
END;
CREATE TRIGGER IF NOT EXISTS search_treatment_plan_items_au AFTER UPDATE ON treatment_plan_items BEGIN
  DELETE FROM search_index WHERE entity_type = 'treatment_plan_items' AND entity_id = OLD.id;
  INSERT INTO search_index (entity_type, entity_id, patient_id, title, body) VALUES ('treatment_plan_items', NEW.id, NEW.patient_id,
    COALESCE((SELECT tt.name FROM treatment_types tt WHERE tt.id = NEW.treatment_type_id), 'Treatment') || CASE WHEN NEW.tooth IS NOT NULL THEN ' - tooth ' || NEW.tooth ELSE '' END,
    COALESCE(NEW.notes,''));
END;

CREATE TRIGGER IF NOT EXISTS search_clinical_notes_ai AFTER INSERT ON clinical_notes BEGIN
  INSERT INTO search_index (entity_type, entity_id, patient_id, title, body) VALUES ('clinical_notes', NEW.id, NEW.patient_id, NEW.note_date,
    TRIM(NEW.body || ' ' || COALESCE((SELECT p.first_name || ' ' || p.last_name FROM patients p WHERE p.id = NEW.patient_id), '')));
END;
CREATE TRIGGER IF NOT EXISTS search_clinical_notes_ad AFTER DELETE ON clinical_notes BEGIN
  DELETE FROM search_index WHERE entity_type = 'clinical_notes' AND entity_id = OLD.id;
END;
CREATE TRIGGER IF NOT EXISTS search_clinical_notes_au AFTER UPDATE ON clinical_notes BEGIN
  DELETE FROM search_index WHERE entity_type = 'clinical_notes' AND entity_id = OLD.id;
  INSERT INTO search_index (entity_type, entity_id, patient_id, title, body) VALUES ('clinical_notes', NEW.id, NEW.patient_id, NEW.note_date,
    TRIM(NEW.body || ' ' || COALESCE((SELECT p.first_name || ' ' || p.last_name FROM patients p WHERE p.id = NEW.patient_id), '')));
END;

CREATE TRIGGER IF NOT EXISTS search_invoices_ai AFTER INSERT ON invoices BEGIN
  INSERT INTO search_index (entity_type, entity_id, patient_id, title, body) VALUES ('invoices', NEW.id, NEW.patient_id, 'Invoice #' || NEW.id, COALESCE(NEW.notes,''));
END;
CREATE TRIGGER IF NOT EXISTS search_invoices_ad AFTER DELETE ON invoices BEGIN
  DELETE FROM search_index WHERE entity_type = 'invoices' AND entity_id = OLD.id;
END;
CREATE TRIGGER IF NOT EXISTS search_invoices_au AFTER UPDATE ON invoices BEGIN
  DELETE FROM search_index WHERE entity_type = 'invoices' AND entity_id = OLD.id;
  INSERT INTO search_index (entity_type, entity_id, patient_id, title, body) VALUES ('invoices', NEW.id, NEW.patient_id, 'Invoice #' || NEW.id, COALESCE(NEW.notes,''));
END;

CREATE TRIGGER IF NOT EXISTS search_invoice_items_ai AFTER INSERT ON invoice_items BEGIN
  INSERT INTO search_index (entity_type, entity_id, patient_id, title, body) VALUES ('invoice_items', NEW.id,
    (SELECT patient_id FROM invoices WHERE id = NEW.invoice_id), NEW.description, '');
END;
CREATE TRIGGER IF NOT EXISTS search_invoice_items_ad AFTER DELETE ON invoice_items BEGIN
  DELETE FROM search_index WHERE entity_type = 'invoice_items' AND entity_id = OLD.id;
END;
CREATE TRIGGER IF NOT EXISTS search_invoice_items_au AFTER UPDATE ON invoice_items BEGIN
  DELETE FROM search_index WHERE entity_type = 'invoice_items' AND entity_id = OLD.id;
  INSERT INTO search_index (entity_type, entity_id, patient_id, title, body) VALUES ('invoice_items', NEW.id,
    (SELECT patient_id FROM invoices WHERE id = NEW.invoice_id), NEW.description, '');
END;

CREATE TRIGGER IF NOT EXISTS search_insurance_plans_ai AFTER INSERT ON insurance_plans BEGIN
  INSERT INTO search_index (entity_type, entity_id, patient_id, title, body) VALUES ('insurance_plans', NEW.id, NEW.patient_id, NEW.carrier,
    TRIM(COALESCE(NEW.member_id,'') || ' ' || COALESCE(NEW.group_id,'') || ' ' || COALESCE(NEW.subscriber_name,'') || ' ' || COALESCE(NEW.notes,'')));
END;
CREATE TRIGGER IF NOT EXISTS search_insurance_plans_ad AFTER DELETE ON insurance_plans BEGIN
  DELETE FROM search_index WHERE entity_type = 'insurance_plans' AND entity_id = OLD.id;
END;
CREATE TRIGGER IF NOT EXISTS search_insurance_plans_au AFTER UPDATE ON insurance_plans BEGIN
  DELETE FROM search_index WHERE entity_type = 'insurance_plans' AND entity_id = OLD.id;
  INSERT INTO search_index (entity_type, entity_id, patient_id, title, body) VALUES ('insurance_plans', NEW.id, NEW.patient_id, NEW.carrier,
    TRIM(COALESCE(NEW.member_id,'') || ' ' || COALESCE(NEW.group_id,'') || ' ' || COALESCE(NEW.subscriber_name,'') || ' ' || COALESCE(NEW.notes,'')));
END;

CREATE TRIGGER IF NOT EXISTS search_lab_cases_ai AFTER INSERT ON lab_cases BEGIN
  INSERT INTO search_index (entity_type, entity_id, patient_id, title, body) VALUES ('lab_cases', NEW.id, NEW.patient_id, NEW.case_type || ' - ' || NEW.lab_name,
    TRIM(COALESCE(NEW.tooth,'') || ' ' || COALESCE(NEW.shade,'') || ' ' || COALESCE(NEW.notes,'')));
END;
CREATE TRIGGER IF NOT EXISTS search_lab_cases_ad AFTER DELETE ON lab_cases BEGIN
  DELETE FROM search_index WHERE entity_type = 'lab_cases' AND entity_id = OLD.id;
END;
CREATE TRIGGER IF NOT EXISTS search_lab_cases_au AFTER UPDATE ON lab_cases BEGIN
  DELETE FROM search_index WHERE entity_type = 'lab_cases' AND entity_id = OLD.id;
  INSERT INTO search_index (entity_type, entity_id, patient_id, title, body) VALUES ('lab_cases', NEW.id, NEW.patient_id, NEW.case_type || ' - ' || NEW.lab_name,
    TRIM(COALESCE(NEW.tooth,'') || ' ' || COALESCE(NEW.shade,'') || ' ' || COALESCE(NEW.notes,'')));
END;

CREATE TRIGGER IF NOT EXISTS search_waiting_list_ai AFTER INSERT ON waiting_list BEGIN
  INSERT INTO search_index (entity_type, entity_id, patient_id, title, body) VALUES ('waiting_list', NEW.id, NEW.patient_id,
    COALESCE((SELECT tt.name FROM treatment_types tt WHERE tt.id = NEW.treatment_type_id), 'Waiting list'), COALESCE(NEW.notes,''));
END;
CREATE TRIGGER IF NOT EXISTS search_waiting_list_ad AFTER DELETE ON waiting_list BEGIN
  DELETE FROM search_index WHERE entity_type = 'waiting_list' AND entity_id = OLD.id;
END;
CREATE TRIGGER IF NOT EXISTS search_waiting_list_au AFTER UPDATE ON waiting_list BEGIN
  DELETE FROM search_index WHERE entity_type = 'waiting_list' AND entity_id = OLD.id;
  INSERT INTO search_index (entity_type, entity_id, patient_id, title, body) VALUES ('waiting_list', NEW.id, NEW.patient_id,
    COALESCE((SELECT tt.name FROM treatment_types tt WHERE tt.id = NEW.treatment_type_id), 'Waiting list'), COALESCE(NEW.notes,''));
END;

CREATE TRIGGER IF NOT EXISTS search_appointments_to_make_ai AFTER INSERT ON appointments_to_make BEGIN
  INSERT INTO search_index (entity_type, entity_id, patient_id, title, body) VALUES ('appointments_to_make', NEW.id, NEW.patient_id,
    COALESCE((SELECT tt.name FROM treatment_types tt WHERE tt.id = NEW.treatment_type_id), 'Appointment to make'), COALESCE(NEW.notes,''));
END;
CREATE TRIGGER IF NOT EXISTS search_appointments_to_make_ad AFTER DELETE ON appointments_to_make BEGIN
  DELETE FROM search_index WHERE entity_type = 'appointments_to_make' AND entity_id = OLD.id;
END;
CREATE TRIGGER IF NOT EXISTS search_appointments_to_make_au AFTER UPDATE ON appointments_to_make BEGIN
  DELETE FROM search_index WHERE entity_type = 'appointments_to_make' AND entity_id = OLD.id;
  INSERT INTO search_index (entity_type, entity_id, patient_id, title, body) VALUES ('appointments_to_make', NEW.id, NEW.patient_id,
    COALESCE((SELECT tt.name FROM treatment_types tt WHERE tt.id = NEW.treatment_type_id), 'Appointment to make'), COALESCE(NEW.notes,''));
END;

CREATE TRIGGER IF NOT EXISTS search_tooth_conditions_ai AFTER INSERT ON tooth_conditions BEGIN
  INSERT INTO search_index (entity_type, entity_id, patient_id, title, body) VALUES ('tooth_conditions', NEW.id, NEW.patient_id, 'Tooth ' || NEW.tooth, NEW.condition);
END;
CREATE TRIGGER IF NOT EXISTS search_tooth_conditions_ad AFTER DELETE ON tooth_conditions BEGIN
  DELETE FROM search_index WHERE entity_type = 'tooth_conditions' AND entity_id = OLD.id;
END;
CREATE TRIGGER IF NOT EXISTS search_tooth_conditions_au AFTER UPDATE ON tooth_conditions BEGIN
  DELETE FROM search_index WHERE entity_type = 'tooth_conditions' AND entity_id = OLD.id;
  INSERT INTO search_index (entity_type, entity_id, patient_id, title, body) VALUES ('tooth_conditions', NEW.id, NEW.patient_id, 'Tooth ' || NEW.tooth, NEW.condition);
END;

CREATE TRIGGER IF NOT EXISTS search_operatories_ai AFTER INSERT ON operatories BEGIN
  INSERT INTO search_index (entity_type, entity_id, patient_id, title, body) VALUES ('operatories', NEW.id, NULL, NEW.name, '');
END;
CREATE TRIGGER IF NOT EXISTS search_operatories_ad AFTER DELETE ON operatories BEGIN
  DELETE FROM search_index WHERE entity_type = 'operatories' AND entity_id = OLD.id;
END;
CREATE TRIGGER IF NOT EXISTS search_operatories_au AFTER UPDATE ON operatories BEGIN
  DELETE FROM search_index WHERE entity_type = 'operatories' AND entity_id = OLD.id;
  INSERT INTO search_index (entity_type, entity_id, patient_id, title, body) VALUES ('operatories', NEW.id, NULL, NEW.name, '');
END;

CREATE TRIGGER IF NOT EXISTS search_practitioners_ai AFTER INSERT ON practitioners BEGIN
  INSERT INTO search_index (entity_type, entity_id, patient_id, title, body) VALUES ('practitioners', NEW.id, NULL, NEW.name,
    TRIM(COALESCE(NEW.email,'') || ' ' || COALESCE(NEW.phone,'')));
END;
CREATE TRIGGER IF NOT EXISTS search_practitioners_ad AFTER DELETE ON practitioners BEGIN
  DELETE FROM search_index WHERE entity_type = 'practitioners' AND entity_id = OLD.id;
END;
CREATE TRIGGER IF NOT EXISTS search_practitioners_au AFTER UPDATE ON practitioners BEGIN
  DELETE FROM search_index WHERE entity_type = 'practitioners' AND entity_id = OLD.id;
  INSERT INTO search_index (entity_type, entity_id, patient_id, title, body) VALUES ('practitioners', NEW.id, NULL, NEW.name,
    TRIM(COALESCE(NEW.email,'') || ' ' || COALESCE(NEW.phone,'')));
END;

CREATE TRIGGER IF NOT EXISTS search_treatment_types_ai AFTER INSERT ON treatment_types BEGIN
  INSERT INTO search_index (entity_type, entity_id, patient_id, title, body) VALUES ('treatment_types', NEW.id, NULL, NEW.code || ' ' || NEW.name, '');
END;
CREATE TRIGGER IF NOT EXISTS search_treatment_types_ad AFTER DELETE ON treatment_types BEGIN
  DELETE FROM search_index WHERE entity_type = 'treatment_types' AND entity_id = OLD.id;
END;
CREATE TRIGGER IF NOT EXISTS search_treatment_types_au AFTER UPDATE ON treatment_types BEGIN
  DELETE FROM search_index WHERE entity_type = 'treatment_types' AND entity_id = OLD.id;
  INSERT INTO search_index (entity_type, entity_id, patient_id, title, body) VALUES ('treatment_types', NEW.id, NULL, NEW.code || ' ' || NEW.name, '');
END;

-- ── Seed data ──────────────────────────────────────────────────
-- The sample operatories, practitioners and treatment types moved into the app
-- (src/server/seed.ts, applied by `ensureSeeded` in src/server/index.ts).
-- A Clawnify deploy applies this file as DDL only: a single INSERT here fails
-- the entire deploy, so no non-DDL statement may be added back.
