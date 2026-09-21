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
  {
    name: "Tinidazole",
    dosage: "500 mg",
    frequency: "2x daily",
    duration: "3 days",
    instructions: "with food; avoid alcohol completely",
    group: "Antibiotic",
    aliases: ["tinigyl", "flagyl alternative", "anaerobic"],
  },
  {
    name: "Ciprofloxacin",
    dosage: "500 mg",
    frequency: "2x daily",
    duration: "5 days",
    instructions: "with plenty of water; avoid dairy within 2 hours of a dose",
    group: "Antibiotic",
    aliases: ["ciprocin", "ciprobay", "quinolone"],
  },
  {
    name: "Cefixime",
    dosage: "200 mg",
    frequency: "2x daily",
    duration: "5 days",
    instructions: "with or without food",
    group: "Antibiotic",
    aliases: ["cexime", "cefix", "3rd gen cephalosporin"],
  },
  {
    name: "Cephalexin",
    dosage: "500 mg",
    frequency: "4x daily",
    duration: "5 days",
    instructions: "with or without food; complete the full course",
    group: "Antibiotic",
    aliases: ["keflex", "seporin", "cephalosporin"],
  },
  {
    name: "Doxycycline",
    dosage: "100 mg",
    frequency: "once daily",
    duration: "10 days",
    instructions: "with a full glass of water; stay upright for 30 minutes after",
    group: "Antibiotic",
    aliases: ["doxcin", "terramycin", "vibramycin", "tetracycline"],
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
  {
    name: "Ketorolac",
    dosage: "10 mg",
    frequency: "every 6 hours",
    duration: "2 days",
    instructions: "shortest possible course; take with food; max 5 days total",
    group: "Analgesic",
    aliases: ["ketolac", "torolac", "acular"],
  },
  {
    name: "Mefenamic acid",
    dosage: "250 mg",
    frequency: "3x daily",
    duration: "3 days",
    instructions: "take with food; best for dental pain",
    group: "Analgesic",
    aliases: ["ponstan", "ponstel", "mefamic"],
  },
  {
    name: "Nimesulide",
    dosage: "100 mg",
    frequency: "2x daily",
    duration: "3 days",
    instructions: "after meals; shortest course possible",
    group: "Analgesic",
    aliases: ["nimek", "nimacid", "nimsulide"],
  },
  {
    name: "Piroxicam",
    dosage: "20 mg",
    frequency: "once daily",
    duration: "3 days",
    instructions: "with food at the same time each day",
    group: "Analgesic",
    aliases: ["feldene", "piroxy"],
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
  {
    name: "Clotrimazole mouth paint",
    dosage: "1 mL",
    frequency: "2x daily",
    duration: "7 days",
    instructions: "apply to affected areas with a cotton swab; avoid food for 20 minutes",
    group: "Antifungal",
    aliases: ["canesten", "topiclof", "mouth paint", "oral thrush"],
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
  {
    name: "Povidone-iodine gargle",
    dosage: "15 mL",
    frequency: "3x daily",
    duration: "5 days",
    instructions: "gargle for 20 seconds and spit out; do not swallow; avoid in pregnancy/thyroid disease",
    group: "Antiseptic rinse",
    aliases: ["betadine", "povidone", "gargle"],
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
  {
    name: "Lignocaine viscous 2%",
    dosage: "10 mL",
    frequency: "as needed",
    duration: "5 days",
    instructions: "swish and spit when pain limits eating; do not swallow — risk of local anaesthesia of the throat",
    group: "Other",
    aliases: ["lidocaine", "xylocaine", "viscous gel", "topical"],
  },
  {
    name: "Triamcinolone orabase",
    dosage: "pea-sized amount",
    frequency: "2x daily",
    duration: "1 week",
    instructions: "apply a thin layer to the ulcer after meals and at bedtime; do not rub in",
    group: "Other",
    aliases: ["kenalog", "triamcinolone paste", "aphthous ulcer", "ulcer"],
  },
  {
    name: "Dexamethasone",
    dosage: "0.5 mg",
    frequency: "3x daily",
    duration: "3 days",
    instructions: "with food in the morning; do not stop suddenly",
    group: "Other",
    aliases: ["dexason", "steroid", "corticosteroid"],
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

/**
 * Case-insensitive match on name + aliases, used by the autocomplete.
 * `extraPresets` (the practice's editable medicine list) are searched first
 * and win over the built-in library when names collide.
 */
export function searchDentalDrugs(query: string, limit = 6, extraPresets: DrugPreset[] = []): DrugPreset[] {
  const q = query.trim().toLowerCase();
  if (!q) return [];
  const scored: { preset: DrugPreset; score: number; index: number }[] = [];
  const seen = new Set<string>();
  for (const preset of [...extraPresets, ...DENTAL_DRUGS]) {
    const key = preset.name.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
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
