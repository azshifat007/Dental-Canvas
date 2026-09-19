/**
 * Curated dental prescribing presets for the medication autocomplete.
 *
 * Each entry is a drug commonly prescribed in dentistry with a typical adult
 * regimen. Picking one from the autocomplete fills the whole medication row;
 * every field stays editable afterwards (allergies, renal dosing, local
 * formulary rules, etc. always trump the preset).
 *
 * This is a convenience list, not a decision-support tool — the prescriber is
 * responsible for the final regimen.
 */

export type DrugGroup =
  | "Antibiotic"
  | "Analgesic"
  | "Antifungal"
  | "Antiviral"
  | "Antiseptic rinse"
  | "Other";

export interface DrugPreset {
  name: string;
  dosage: string;
  frequency: string;
  duration: string;
  instructions: string;
  group: DrugGroup;
  /** Case-insensitive brand names / alternate spellings matched while typing. */
  aliases?: string[];
}

export const DENTAL_DRUGS: DrugPreset[] = [
  // ── Antibiotics ────────────────────────────────────────────────────
  {
    name: "Amoxicillin",
    dosage: "500 mg",
    frequency: "3x daily",
    duration: "5 days",
    instructions: "after meals",
    group: "Antibiotic",
  },
  {
    name: "Co-amoxiclav (Amoxicillin + Clavulanic acid)",
    dosage: "625 mg",
    frequency: "3x daily",
    duration: "5 days",
    instructions: "after meals",
    group: "Antibiotic",
    aliases: ["augmentin", "clavulanate", "clavulanic"],
  },
  {
    name: "Metronidazole",
    dosage: "400 mg",
    frequency: "3x daily",
    duration: "3 days",
    instructions: "with food; avoid alcohol completely",
    group: "Antibiotic",
    aliases: ["flagyl"],
  },
  {
    name: "Amoxicillin + Metronidazole",
    dosage: "500 mg + 400 mg",
    frequency: "3x daily",
    duration: "5 days",
    instructions: "after meals; avoid alcohol",
    group: "Antibiotic",
    aliases: ["combination", "dual"],
  },
  {
    name: "Penicillin V (Phenoxymethylpenicillin)",
    dosage: "500 mg",
    frequency: "4x daily",
    duration: "5 days",
    instructions: "1 hour before meals",
    group: "Antibiotic",
  },
  {
    name: "Clindamycin",
    dosage: "300 mg",
    frequency: "3x daily",
    duration: "5 days",
    instructions: "with a full glass of water",
    group: "Antibiotic",
    aliases: ["dalacin"],
  },
  {
    name: "Azithromycin",
    dosage: "500 mg",
    frequency: "once daily",
    duration: "3 days",
    instructions: "1 hour before food",
    group: "Antibiotic",
    aliases: ["zithromax"],
  },
  {
    name: "Erythromycin",
    dosage: "250 mg",
    frequency: "4x daily",
    duration: "5 days",
    instructions: "with food",
    group: "Antibiotic",
  },

  // ── Analgesics ─────────────────────────────────────────────────────
  {
    name: "Ibuprofen",
    dosage: "400 mg",
    frequency: "3x daily",
    duration: "3 days",
    instructions: "with food; take the lowest effective dose",
    group: "Analgesic",
    aliases: ["advil", "brufen", "nurofen", "nsaid"],
  },
  {
    name: "Paracetamol (Acetaminophen)",
    dosage: "500 mg",
    frequency: "every 6 hours",
    duration: "3 days",
    instructions: "max 4 g in 24 hours",
    group: "Analgesic",
    aliases: ["acetaminophen", "tylenol", "panadol", "calpol"],
  },
  {
    name: "Diclofenac Potassium",
    dosage: "50 mg",
    frequency: "2x daily",
    duration: "3 days",
    instructions: "after meals",
    group: "Analgesic",
    aliases: ["cataflam", "voltaren"],
  },
  {
    name: "Naproxen",
    dosage: "250 mg",
    frequency: "2x daily",
    duration: "3 days",
    instructions: "with food",
    group: "Analgesic",
    aliases: ["naprosyn"],
  },
  {
    name: "Tramadol",
    dosage: "50 mg",
    frequency: "every 8 hours",
    duration: "2 days",
    instructions: "with food; may cause drowsiness — do not drive",
    group: "Analgesic",
  },
  {
    name: "Co-codamol (Codeine + Paracetamol)",
    dosage: "30/500 mg",
    frequency: "every 6 hours",
    duration: "2 days",
    instructions: "max 8 tablets in 24 hours; may cause constipation",
    group: "Analgesic",
    aliases: ["codeine"],
  },

  // ── Antifungals ────────────────────────────────────────────────────
  {
    name: "Nystatin oral suspension",
    dosage: "100,000 units/mL",
    frequency: "4x daily",
    duration: "7 days",
    instructions: "swish 1 mL and swallow after meals and at bedtime",
    group: "Antifungal",
    aliases: ["nystatin", "candida"],
  },
  {
    name: "Miconazole oral gel",
    dosage: "2% gel",
    frequency: "4x daily",
    duration: "7 days",
    instructions: "apply to affected areas with a clean finger; hold in mouth as long as possible",
    group: "Antifungal",
    aliases: ["daktarin", "miconazole"],
  },
  {
    name: "Fluconazole",
    dosage: "50 mg",
    frequency: "once daily",
    duration: "14 days",
    instructions: "with or without food",
    group: "Antifungal",
    aliases: ["diflucan"],
  },

  // ── Antivirals ─────────────────────────────────────────────────────
  {
    name: "Acyclovir",
    dosage: "200 mg",
    frequency: "5x daily",
    duration: "5 days",
    instructions: "start at the first tingle; drink plenty of water",
    group: "Antiviral",
    aliases: ["aciclovir", "zovirax", "herpes"],
  },

  // ── Antiseptic rinses ──────────────────────────────────────────────
  {
    name: "Chlorhexidine gluconate 0.2% mouthwash",
    dosage: "10 mL",
    frequency: "2x daily",
    duration: "14 days",
    instructions: "rinse for 1 minute and spit out; avoid eating or drinking for 30 minutes; not long-term",
    group: "Antiseptic rinse",
    aliases: ["corsodyl", "chlorhexidine", "chx"],
  },
  {
    name: "Benzydamine 0.15% oral rinse",
    dosage: "15 mL",
    frequency: "every 3 hours",
    duration: "7 days",
    instructions: "rinse for 20–30 seconds and spit out; may sting at first",
    group: "Antiseptic rinse",
    aliases: ["difflam", "benzydamine"],
  },
  {
    name: "Warm saline rinse",
    dosage: "1/2 teaspoon salt in a glass",
    frequency: "4x daily",
    duration: "7 days",
    instructions: "rinse gently and spit out",
    group: "Antiseptic rinse",
    aliases: ["saline", "salt water"],
  },

  // ── Other ──────────────────────────────────────────────────────────
  {
    name: "Fluoride 5000 ppm toothpaste",
    dosage: "pea-sized amount",
    frequency: "3x daily",
    duration: "3 months",
    instructions: "brush after meals; do not rinse afterwards",
    group: "Other",
    aliases: ["duraphat", "fluoride", "high fluoride"],
  },
  {
    name: "Doxycycline subantimicrobial dose",
    dosage: "20 mg",
    frequency: "2x daily",
    duration: "3 months",
    instructions: "with plenty of water; stay upright for 30 minutes",
    group: "Other",
    aliases: ["periostat"],
  },
];

const GROUP_ORDER: DrugGroup[] = [
  "Antibiotic",
  "Analgesic",
  "Antiseptic rinse",
  "Antifungal",
  "Antiviral",
  "Other",
];

/** Case-insensitive match on name + aliases, used by the autocomplete. */
export function searchDentalDrugs(query: string, limit = 6): DrugPreset[] {
  const q = query.trim().toLowerCase();
  if (!q) return [];
  const scored: { preset: DrugPreset; score: number; index: number }[] = [];
  for (const preset of DENTAL_DRUGS) {
    const name = preset.name.toLowerCase();
    let score: number | null = null;
    if (name.startsWith(q)) score = 0;
    else if (name.includes(q)) score = 1;
    else if (preset.aliases?.some((a) => a.startsWith(q))) score = 2;
    else if (preset.aliases?.some((a) => a.includes(q))) score = 3;
    if (score !== null) scored.push({ preset, score, index: GROUP_ORDER.indexOf(preset.group) });
  }
  scored.sort((a, b) => a.score - b.score || a.index - b.index || a.preset.name.localeCompare(b.preset.name));
  return scored.slice(0, limit).map((s) => s.preset);
}
