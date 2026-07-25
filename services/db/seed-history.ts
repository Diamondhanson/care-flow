/**
 * Historical caseload generator (demo data only) — appends a deterministic
 * 60-day back-catalogue of closed visits so the reporting dashboard has
 * rich history to chart. Split from `./seed` purely for file size; it is
 * NOT re-exported through the `services/mockStorage` barrel.
 */

import type {
  Admission,
  Allergy,
  Consultation,
  Diagnosis,
  MedicationAdministration,
  Order,
  Patient,
  Prescription,
  Result,
  TreatmentRecord,
  TriageLevel,
  Unbranded,
  Visit,
  VisitType,
} from "@/types/healthcare";
import { generatePatientId, uniquePatientId } from "./shared";

/**
 * A seed/input row before its owning `hospital_id` is stamped on. Branded id
 * fields are widened to plain `string` (`Unbranded`) so seed literals
 * ("dept_emergency") type-check without hundreds of per-field casts; the
 * caller's single `stamp(...) as T` cast at the end of `seedDatabaseObject`
 * re-brands them.
 */
export type Seed<T> = Unbranded<Omit<T, "hospital_id">>;

// ---------------------------------------------------------------------------
// Historical caseload generator (demo data only)
// ---------------------------------------------------------------------------

export interface HistoricalSeedCtx {
  day: (offsetHours: number) => string;
  // Rows are stamped with `hospital_id` by the caller after generation, so the
  // generator builds them tenantless (`Seed<T>`).
  patients: Seed<Patient>[];
  allergies: Seed<Allergy>[];
  visits: Seed<Visit>[];
  consultations: Seed<Consultation>[];
  diagnoses: Seed<Diagnosis>[];
  orders: Seed<Order>[];
  results: Seed<Result>[];
  prescriptions: Seed<Prescription>[];
  medicationAdministrations: Seed<MedicationAdministration>[];
  treatmentRecords: Seed<TreatmentRecord>[];
  admissions: Seed<Admission>[];
}

/**
 * Append a deterministic 60-day back-catalogue of *closed* visits with full
 * clinical records, so the reporting dashboard has rich, varied history to
 * chart. Deterministic (seeded PRNG) so the dataset is stable across reloads.
 * Everything generated here is terminal/closed and therefore invisible to the
 * live board, MAR worklist and floor map — it only feeds reports.
 */
export function seedHistoricalCaseload(ctx: HistoricalSeedCtx): void {
  const { day } = ctx;

  // mulberry32 — deterministic so the demo set never drifts between loads.
  let s = 0x20260531 >>> 0;
  const rng = () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const pick = <T,>(arr: readonly T[]): T => arr[Math.floor(rng() * arr.length)];
  const randint = (a: number, b: number) => a + Math.floor(rng() * (b - a + 1));
  const chance = (p: number) => rng() < p;
  const weighted = <T,>(items: readonly (readonly [T, number])[]): T => {
    const total = items.reduce((sum, [, w]) => sum + w, 0);
    let r = rng() * total;
    for (const [value, w] of items) {
      r -= w;
      if (r <= 0) return value;
    }
    return items[items.length - 1][0];
  };

  const firstNames = [
    "Kwame", "Ama", "Kofi", "Akua", "Yaw", "Abena", "Kojo", "Esi", "Kwesi",
    "Adwoa", "Chinedu", "Ngozi", "Emeka", "Folake", "Tunde", "Bisi", "Femi",
    "Zainab", "Musa", "Halima", "Ibrahim", "Fatima", "Joseph", "Mary", "Isaac",
    "Beatrice", "Michael", "Patience", "Eric", "Vivian", "Prince", "Gifty",
  ];
  const lastNames = [
    "Asante", "Boateng", "Addo", "Appiah", "Darko", "Frimpong", "Gyamfi",
    "Acheampong", "Okeke", "Nwankwo", "Adeyemi", "Balogun", "Danso", "Quaye",
    "Lartey", "Annan", "Kanu", "Sarpong", "Amankwah", "Mahama",
  ];
  const complaints = [
    "Fever and chills", "Persistent headache", "Abdominal pain", "Productive cough",
    "Shortness of breath", "Vomiting and diarrhoea", "Chest pain", "Dizziness",
    "Painful urination", "Generalized body weakness", "Joint pain", "Lower back pain",
    "Difficulty breathing", "Fainting episode", "Swelling of the legs",
  ];

  const doctorByDept: Record<string, string[]> = {
    dept_medicine: ["staff_okafor", "staff_adeyemi"],
    dept_surgery: ["staff_chen", "staff_nwosu"],
    dept_emergency: ["staff_asante", "staff_romero"],
    dept_icu: ["staff_okonkwo", "staff_okafor"],
  };
  const clinicalDepts: readonly (readonly [string, number])[] = [
    ["dept_medicine", 10],
    ["dept_emergency", 7],
    ["dept_surgery", 5],
    ["dept_icu", 3],
  ];
  const nurseIds = ["staff_patel", "staff_romero", "staff_tetteh", "staff_yeboah"];
  const wardByDept: Record<string, string> = {
    dept_icu: "ward_icu",
    dept_medicine: "ward_medb",
    dept_emergency: "ward_er",
    dept_surgery: "ward_medb",
  };
  const bedByWard: Record<string, string[]> = {
    ward_icu: ["bed_icu_01", "bed_icu_02", "bed_icu_04"],
    ward_medb: ["bed_medb_09", "bed_medb_10", "bed_medb_11"],
    ward_er: ["bed_er_1", "bed_er_2"],
  };

  const dxPool: readonly (readonly [readonly [string, string], number])[] = [
    [["B54", "Malaria, unspecified"], 18],
    [["I10", "Essential (primary) hypertension"], 15],
    [["E11.9", "Type 2 diabetes mellitus without complications"], 10],
    [["A09", "Infectious gastroenteritis & colitis"], 9],
    [["A01.0", "Typhoid fever"], 8],
    [["J18.9", "Pneumonia, unspecified organism"], 8],
    [["N39.0", "Urinary tract infection, site not specified"], 7],
    [["D64.9", "Anaemia, unspecified"], 6],
    [["K29.70", "Gastritis, unspecified"], 5],
    [["J45.909", "Asthma, unspecified"], 5],
    [["D57.00", "Sickle-cell crisis"], 4],
    [["I50.9", "Heart failure, unspecified"], 4],
    [["S52.501A", "Fracture of lower end of right radius"], 4],
    [["O80", "Full-term uncomplicated delivery"], 4],
    [["K35.80", "Acute appendicitis"], 3],
    [["I63.9", "Cerebral infarction, unspecified"], 3],
    [["A41.9", "Sepsis, unspecified organism"], 3],
    [["J44.9", "Chronic obstructive pulmonary disease"], 3],
  ];

  const drugPool = [
    ["Artemether-lumefantrine", "20/120 mg", "oral", "twice daily"],
    ["Amoxicillin", "500 mg", "oral", "every 8 hours"],
    ["Paracetamol", "1 g", "oral", "every 6 hours"],
    ["Metformin", "1 g", "oral", "twice daily"],
    ["Amlodipine", "10 mg", "oral", "once daily"],
    ["Ceftriaxone", "1 g", "IV", "once daily"],
    ["Ibuprofen", "400 mg", "oral", "every 8 hours"],
    ["Omeprazole", "20 mg", "oral", "once daily"],
    ["Lisinopril", "10 mg", "oral", "once daily"],
    ["Azithromycin", "500 mg", "oral", "once daily"],
    ["Salbutamol", "2.5 mg", "nebulized", "every 6 hours"],
    ["Ferrous sulfate", "200 mg", "oral", "twice daily"],
    ["Metronidazole", "500 mg", "IV", "every 8 hours"],
  ] as const;

  const labTests = [
    "Full Blood Count", "Malaria RDT", "Random blood glucose", "Urea & electrolytes",
    "Liver function test", "Blood culture", "Urinalysis", "Widal test", "Lipid panel",
  ];
  const imagingTests = [
    "Chest X-ray (PA)", "Abdominal ultrasound", "CT head (non-contrast)",
    "Pelvic ultrasound", "Wrist X-ray",
  ];

  const allergenPool = [
    ["Penicillin", "drug", "severe", "Rash and facial swelling"],
    ["Sulfa drugs", "drug", "moderate", "Hives"],
    ["Peanuts", "food", "mild", "Itching"],
    ["Shellfish", "food", "moderate", "Lip swelling"],
    ["House dust", "environmental", "mild", "Sneezing and congestion"],
    ["Aspirin", "drug", "moderate", "Gastric upset"],
  ] as const;

  const N = 46;
  for (let i = 0; i < N; i++) {
    const tag = `h${i + 1}`;
    const patientId = `pat_${tag}`;
    const visitId = `vis_${tag}`;

    const sex = chance(0.5) ? ("female" as const) : ("male" as const);
    const age = randint(1, 88);
    const dob = `${2026 - age}-${String(randint(1, 12)).padStart(2, "0")}-${String(randint(1, 28)).padStart(2, "0")}`;

    const daysAgo = randint(1, 60);
    const arrivedH = daysAgo * 24 + randint(0, 23);

    const visitType = weighted<VisitType>([
      ["outpatient", 55],
      ["inpatient", 22],
      ["emergency", 23],
    ]);
    const dept = weighted(clinicalDepts);
    const doctorId = pick(doctorByDept[dept] ?? ["staff_okafor"]);
    const [icd, desc] = weighted(dxPool);
    const stage = chance(0.25) ? ("followed_up" as const) : ("discharged" as const);

    let admittedH: number | null = null;
    let dischargedH: number | null = null;
    let closedH: number;
    if (visitType === "inpatient") {
      const maxLos = Math.max(1, Math.floor((arrivedH - 12) / 24));
      const los = randint(1, Math.min(14, maxLos));
      admittedH = arrivedH;
      dischargedH = arrivedH - los * 24;
      closedH = dischargedH;
    } else {
      closedH = Math.max(1, arrivedH - randint(1, 8));
    }

    const hasAllergy = chance(0.28);
    const noKnown = !hasAllergy && chance(0.5);

    const fullName = `${pick(firstNames)} ${pick(lastNames)}`;
    const motherFirstName = pick(firstNames);

    ctx.patients.push({
      id: patientId,
      mrn: uniquePatientId(
        generatePatientId(dob, fullName, motherFirstName),
        ctx.patients.map((p) => p.mrn),
      ),
      full_name: fullName,
      date_of_birth: dob,
      sex,
      phone: `+233 24 555 ${String(2000 + i).slice(-4)}`,
      address: null,
      national_id: null,
      mother_first_name: motherFirstName,
      is_emergency_anonymous: false,
      anonymous_identifier: null,
      no_known_allergies: noKnown,
      created_at: day(arrivedH),
      updated_at: day(closedH),
    });

    if (hasAllergy) {
      const [sub, cat, sev, react] = pick(allergenPool);
      ctx.allergies.push({
        id: `alg_${tag}`,
        patient_id: patientId,
        substance: sub,
        category: cat,
        severity: sev,
        reaction: react,
        noted_by_id: doctorId,
        created_at: day(arrivedH),
        updated_at: day(arrivedH),
      });
    }

    ctx.visits.push({
      id: visitId,
      patient_id: patientId,
      visit_type: visitType,
      status: "closed",
      stage,
      department_id: dept,
      attending_doctor_id: doctorId,
      registered_by_id: "staff_adebayo",
      chief_complaint: pick(complaints),
      triage_notes: null,
      triage_level: (visitType === "emergency"
        ? randint(1, 3)
        : visitType === "inpatient"
          ? randint(2, 4)
          : randint(4, 5)) as TriageLevel,
      arrived_at: day(arrivedH),
      closed_at: day(closedH),
      created_at: day(arrivedH),
      updated_at: day(closedH),
    });

    const hasConsult = chance(0.85);
    const consultId = `con_${tag}`;
    if (hasConsult) {
      ctx.consultations.push({
        id: consultId,
        visit_id: visitId,
        doctor_id: doctorId,
        subjective: `${pick(complaints)}.`,
        examination: "Examined; vitals and systems reviewed.",
        assessment: `${desc}.`,
        plan: "Commenced treatment; advised review.",
        created_at: day(Math.max(1, arrivedH - 1)),
        updated_at: day(Math.max(1, arrivedH - 1)),
      });
    }

    ctx.diagnoses.push({
      id: `dx_${tag}`,
      visit_id: visitId,
      consultation_id: hasConsult ? consultId : null,
      diagnosed_by_id: doctorId,
      icd10_code: icd,
      description: desc,
      is_primary: true,
      created_at: day(Math.max(1, arrivedH - 1)),
    });

    const nOrders = randint(0, 2);
    for (let o = 0; o < nOrders; o++) {
      const isLab = chance(0.7);
      const orderId = `ord_${tag}_${o}`;
      const completed = chance(0.85);
      const compH = Math.max(1, arrivedH - randint(2, 12));
      ctx.orders.push({
        id: orderId,
        visit_id: visitId,
        ordered_by_id: doctorId,
        order_type: isLab ? "lab" : "imaging",
        description: isLab ? pick(labTests) : pick(imagingTests),
        status: completed ? "completed" : "cancelled",
        created_at: day(arrivedH),
        completed_at: completed ? day(compH) : null,
        updated_at: day(completed ? compH : arrivedH),
      });
      if (completed && chance(0.9)) {
        const abnormal = chance(0.3);
        ctx.results.push({
          id: `res_${tag}_${o}`,
          order_id: orderId,
          recorded_by_id: "staff_boateng",
          summary: abnormal ? "Result outside reference range." : "Within normal limits.",
          value: abnormal ? "Abnormal" : "Normal",
          reference_range: null,
          is_abnormal: abnormal,
          attachment_path: null,
          recorded_at: day(compH),
        });
      }
    }

    const nRx = randint(0, 2);
    for (let r = 0; r < nRx; r++) {
      const [drug, dose, route, freq] = pick(drugPool);
      const rxId = `rx_${tag}_${r}`;
      ctx.prescriptions.push({
        id: rxId,
        visit_id: visitId,
        prescribed_by_id: doctorId,
        drug_name: drug,
        dose,
        route,
        frequency: freq,
        duration: `${randint(3, 7)} days`,
        instructions: null,
        status: "completed",
        created_at: day(arrivedH),
        updated_at: day(closedH),
      });
      const nDoses = visitType === "inpatient" ? randint(2, 6) : chance(0.4) ? 1 : 0;
      for (let d = 0; d < nDoses; d++) {
        const doseH = randint(closedH, arrivedH);
        ctx.medicationAdministrations.push({
          id: `mar_${tag}_${r}_${d}`,
          prescription_id: rxId,
          administered_by_id: pick(nurseIds),
          scheduled_for: day(doseH),
          administered_at: day(doseH),
          status: chance(0.92) ? "given" : chance(0.5) ? "held" : "refused",
          notes: null,
          created_at: day(doseH),
        });
      }
    }

    const nVitals = visitType === "inpatient" ? randint(1, 3) : chance(0.5) ? 1 : 0;
    for (let v = 0; v < nVitals; v++) {
      const vH = randint(closedH, arrivedH);
      ctx.treatmentRecords.push({
        id: `trec_${tag}_${v}`,
        visit_id: visitId,
        recorded_by_id: pick(nurseIds),
        spo2: randint(92, 100),
        pulse: randint(60, 120),
        bp_systolic: randint(100, 165),
        bp_diastolic: randint(60, 100),
        temperature_c: Math.round((36 + rng() * 2.5) * 10) / 10,
        weight_kg: Math.round((55 + rng() * 45) * 10) / 10,
        gcs_score: 15,
        notes: null,
        recorded_at: day(vH),
      });
    }

    if (visitType === "inpatient") {
      const ward = wardByDept[dept] ?? "ward_medb";
      ctx.admissions.push({
        id: `adm_${tag}`,
        visit_id: visitId,
        patient_id: patientId,
        attending_doctor_id: doctorId,
        ward_id: ward,
        bed_id: pick(bedByWard[ward] ?? ["bed_medb_09"]),
        status: "discharged",
        stage: "discharged",
        reason: desc,
        is_medical_cleared: true,
        is_financial_cleared: true,
        is_pharmacy_ready: true,
        admitted_at: day(admittedH ?? arrivedH),
        discharged_at: day(dischargedH ?? closedH),
        updated_at: day(dischargedH ?? closedH),
      });
    }
  }
}
