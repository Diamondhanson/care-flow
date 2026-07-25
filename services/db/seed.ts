/**
 * Seed data — a small but complete demo hospital (see `seedDatabaseObject`),
 * plus `resetDatabase`. The deterministic 60-day historical caseload
 * generator lives in `./seed-history`.
 *
 * Deliberately imports from `./shared`, `./engine` and `./seed-history`
 * ONLY (never from the domain modules), so the engine → seed fallback
 * import cannot grow a wider cycle.
 */

import type {
  Admission,
  Allergy,
  Bed,
  BillableItem,
  CarePlanEntry,
  CarePlanItem,
  Charge,
  Consultation,
  Department,
  Diagnosis,
  Hospital,
  MedicationAdministration,
  Order,
  Patient,
  Prescription,
  Result,
  Staff,
  Transfer,
  TreatmentRecord,
  Visit,
  Ward,
} from "@/types/healthcare";
import { clearOutbox } from "@/services/syncQueue";
import {
  BILLING_CATALOG_SEED,
  computeAutoChargeLines,
} from "@/components/billing/billing";
import {
  DEMO_HOSPITAL_ID,
  generatePatientId,
  uniquePatientId,
  type Database,
} from "./shared";
import { persist } from "./engine";
import { seedHistoricalCaseload, type Seed } from "./seed-history";

// ---------------------------------------------------------------------------
// Lifecycle
// ---------------------------------------------------------------------------

/** Wipe and re-seed the store. Useful during testing/demoing. */
export function resetDatabase(): Database {
  const seeded = seedDatabaseObject();
  // A fresh seed is not a set of user mutations and there is nothing to upload
  // for it, so don't track it — and discard any changes still queued from the
  // store we just threw away.
  clearOutbox();
  persist(seeded, { track: false });
  return seeded;
}

// ---------------------------------------------------------------------------
// Seed data — a small but complete hospital: departments, wards/beds, staff
// across all six roles, patients with MRNs, and realistic outpatient, inpatient
// and emergency visits carrying consultations, diagnoses, orders/results,
// prescriptions, MAR entries and vitals — one visit per active board column,
// including an unconscious anonymous ICU patient.
// ---------------------------------------------------------------------------

export function seedDatabaseObject(): Database {
  // Anchor seed timestamps around the current clinical day.
  const day = (offsetHours: number) =>
    new Date(Date.now() - offsetHours * 3600_000).toISOString();

  const hospitals: Hospital[] = [
    {
      id: DEMO_HOSPITAL_ID,
      name: "Douala General Hospital",
      region: "Littoral — Douala",
      contact_email: "contact@dgh.cm",
      contact_phone: "+237 6 55 00 00 00",
      subscription_tier: "standard",
      subscription_status: "active",
      created_at: day(8760),
      updated_at: day(8760),
    },
  ];

  const departments: Seed<Department>[] = [
    { id: "dept_emergency", name: "Emergency", code: "EMG", description: "Emergency & trauma", is_active: true, created_at: day(8760), updated_at: day(8760) },
    { id: "dept_medicine", name: "Internal Medicine", code: "MED", description: "General internal medicine", is_active: true, created_at: day(8760), updated_at: day(8760) },
    { id: "dept_surgery", name: "Surgery", code: "SUR", description: "General & specialist surgery", is_active: true, created_at: day(8760), updated_at: day(8760) },
    { id: "dept_icu", name: "Intensive Care", code: "ICU", description: "Critical care unit", is_active: true, created_at: day(8760), updated_at: day(8760) },
    { id: "dept_lab", name: "Laboratory", code: "LAB", description: "Pathology & diagnostics", is_active: true, created_at: day(8760), updated_at: day(8760) },
    { id: "dept_pharmacy", name: "Pharmacy", code: "PHA", description: "Dispensary", is_active: true, created_at: day(8760), updated_at: day(8760) },
    { id: "dept_admin", name: "Administration", code: "ADM", description: "Front desk & records", is_active: true, created_at: day(8760), updated_at: day(8760) },
  ];

  const wards: Seed<Ward>[] = [
    { id: "ward_icu", department_id: "dept_icu", name: "ICU", block: "Block A", floor_label: "3rd Floor", is_active: true, created_at: day(8760), updated_at: day(8760) },
    { id: "ward_medb", department_id: "dept_medicine", name: "Medical Ward B", block: "Block A", floor_label: "2nd Floor", is_active: true, created_at: day(8760), updated_at: day(8760) },
    { id: "ward_er", department_id: "dept_emergency", name: "Emergency Bays", block: "Block B", floor_label: "Ground Floor", is_active: true, created_at: day(8760), updated_at: day(8760) },
  ];

  const beds: Seed<Bed>[] = [
    { id: "bed_icu_02", ward_id: "ward_icu", label: "ICU-02", status: "occupied", current_admission_id: "adm_anon_gamma", created_at: day(8760), updated_at: day(5) },
    { id: "bed_icu_04", ward_id: "ward_icu", label: "ICU-04", status: "occupied", current_admission_id: "adm_idris", created_at: day(8760), updated_at: day(28) },
    { id: "bed_icu_01", ward_id: "ward_icu", label: "ICU-01", status: "free", current_admission_id: null, created_at: day(8760), updated_at: day(8760) },
    { id: "bed_medb_11", ward_id: "ward_medb", label: "B-11", status: "occupied", current_admission_id: "adm_bello", created_at: day(8760), updated_at: day(96) },
    { id: "bed_medb_09", ward_id: "ward_medb", label: "B-09", status: "free", current_admission_id: null, created_at: day(8760), updated_at: day(8760) },
    { id: "bed_medb_10", ward_id: "ward_medb", label: "B-10", status: "cleaning", current_admission_id: null, created_at: day(8760), updated_at: day(30) },
    { id: "bed_er_1", ward_id: "ward_er", label: "ER-Bay-1", status: "free", current_admission_id: null, created_at: day(8760), updated_at: day(8760) },
    { id: "bed_er_2", ward_id: "ward_er", label: "ER-Bay-2", status: "free", current_admission_id: null, created_at: day(8760), updated_at: day(8760) },
  ];

  const staff: Seed<Staff>[] = [
    { id: "staff_okafor", user_id: null, full_name: "Dr. A. Okafor", role: "doctor", department_id: "dept_medicine", email: "a.okafor@generalhospital.med", phone: "+233 20 555 0010", is_active: true, created_at: day(8760), updated_at: day(8760) },
    { id: "staff_chen", user_id: null, full_name: "Dr. M. Chen", role: "doctor", department_id: "dept_surgery", email: "m.chen@generalhospital.med", phone: "+233 20 555 0011", is_active: true, created_at: day(8760), updated_at: day(8760) },
    { id: "staff_patel", user_id: null, full_name: "Nurse J. Patel", role: "nurse", department_id: "dept_icu", email: "j.patel@generalhospital.med", phone: "+233 20 555 0012", is_active: true, created_at: day(8760), updated_at: day(8760) },
    { id: "staff_romero", user_id: null, full_name: "Nurse L. Romero", role: "nurse", department_id: "dept_emergency", email: "l.romero@generalhospital.med", phone: "+233 20 555 0013", is_active: true, created_at: day(8760), updated_at: day(8760) },
    { id: "staff_boateng", user_id: null, full_name: "K. Boateng", role: "lab_tech", department_id: "dept_lab", email: "k.boateng@generalhospital.med", phone: "+233 20 555 0014", is_active: true, created_at: day(8760), updated_at: day(8760) },
    { id: "staff_eze", user_id: null, full_name: "T. Eze", role: "pharmacist", department_id: "dept_pharmacy", email: "t.eze@generalhospital.med", phone: "+233 20 555 0015", is_active: true, created_at: day(8760), updated_at: day(8760) },
    { id: "staff_adebayo", user_id: null, full_name: "R. Adebayo", role: "receptionist", department_id: "dept_admin", email: "r.adebayo@generalhospital.med", phone: "+233 20 555 0016", is_active: true, created_at: day(8760), updated_at: day(8760) },
    { id: "staff_quartey", user_id: null, full_name: "S. Quartey", role: "admin", department_id: "dept_admin", email: "s.quartey@generalhospital.med", phone: "+233 20 555 0017", is_active: true, created_at: day(8760), updated_at: day(8760) },
    // Additional clinicians — give the workload / throughput reports real spread.
    { id: "staff_adeyemi", user_id: null, full_name: "Dr. F. Adeyemi", role: "doctor", department_id: "dept_medicine", email: "f.adeyemi@generalhospital.med", phone: "+233 20 555 0018", is_active: true, created_at: day(8760), updated_at: day(8760) },
    { id: "staff_nwosu", user_id: null, full_name: "Dr. P. Nwosu", role: "doctor", department_id: "dept_surgery", email: "p.nwosu@generalhospital.med", phone: "+233 20 555 0019", is_active: true, created_at: day(8760), updated_at: day(8760) },
    { id: "staff_asante", user_id: null, full_name: "Dr. C. Asante", role: "doctor", department_id: "dept_emergency", email: "c.asante@generalhospital.med", phone: "+233 20 555 0020", is_active: true, created_at: day(8760), updated_at: day(8760) },
    { id: "staff_okonkwo", user_id: null, full_name: "Dr. R. Okonkwo", role: "doctor", department_id: "dept_icu", email: "r.okonkwo@generalhospital.med", phone: "+233 20 555 0021", is_active: true, created_at: day(8760), updated_at: day(8760) },
    { id: "staff_tetteh", user_id: null, full_name: "Nurse G. Tetteh", role: "nurse", department_id: "dept_medicine", email: "g.tetteh@generalhospital.med", phone: "+233 20 555 0022", is_active: true, created_at: day(8760), updated_at: day(8760) },
    { id: "staff_yeboah", user_id: null, full_name: "Nurse H. Yeboah", role: "nurse", department_id: "dept_surgery", email: "h.yeboah@generalhospital.med", phone: "+233 20 555 0023", is_active: true, created_at: day(8760), updated_at: day(8760) },
  ];

  const patients: Seed<Patient>[] = [
    { id: "pat_mensah", mrn: "890314GM - A", full_name: "Grace Mensah", date_of_birth: "1989-03-14", sex: "female", phone: "+233 20 555 0142", address: "12 Ring Rd, Accra", national_id: "GHA-8841203", mother_first_name: "Akosua", is_emergency_anonymous: false, anonymous_identifier: null, no_known_allergies: false, created_at: day(3), updated_at: day(3) },
    { id: "pat_idris", mrn: "721102SI - F", full_name: "Samuel Idris", date_of_birth: "1972-11-02", sex: "male", phone: "+234 80 555 0199", address: "5 Awolowo St, Lagos", national_id: "NGA-5520117", mother_first_name: "Fatima", is_emergency_anonymous: false, anonymous_identifier: null, no_known_allergies: false, created_at: day(28), updated_at: day(6) },
    { id: "pat_anon_gamma", mrn: "", full_name: "Unidentified Patient", date_of_birth: null, sex: "unknown", phone: null, address: null, national_id: null, mother_first_name: null, is_emergency_anonymous: true, anonymous_identifier: "John Doe - Gamma - 20260531", no_known_allergies: false, created_at: day(5), updated_at: day(1) },
    { id: "pat_bello", mrn: "950721AB - H", full_name: "Aisha Bello", date_of_birth: "1995-07-21", sex: "female", phone: "+234 70 555 0173", address: "8 Marina Rd, Lagos", national_id: "NGA-7790455", mother_first_name: "Hauwa", is_emergency_anonymous: false, anonymous_identifier: null, no_known_allergies: true, created_at: day(96), updated_at: day(12) },
    { id: "pat_owusu", mrn: "600109DO - A", full_name: "Daniel Owusu", date_of_birth: "1960-01-09", sex: "male", phone: "+233 24 555 0166", address: "30 Cantonments, Accra", national_id: "GHA-3310928", mother_first_name: "Abena", is_emergency_anonymous: false, anonymous_identifier: null, no_known_allergies: false, created_at: day(720), updated_at: day(2) },
  ];

  // Mensah & Idris carry documented allergies; Bello is confirmed no-known
  // (flag above); Owusu and the anonymous ICU patient are not yet assessed.
  const allergies: Seed<Allergy>[] = [
    { id: "alg_mensah_pen", patient_id: "pat_mensah", substance: "Penicillin", category: "drug", severity: "severe", reaction: "Widespread rash and facial swelling", noted_by_id: "staff_romero", created_at: day(3), updated_at: day(3) },
    { id: "alg_idris_asa", patient_id: "pat_idris", substance: "Aspirin", category: "drug", severity: "moderate", reaction: "Gastric bleeding", noted_by_id: "staff_chen", created_at: day(28), updated_at: day(28) },
    { id: "alg_idris_peanut", patient_id: "pat_idris", substance: "Peanuts", category: "food", severity: "mild", reaction: "Hives", noted_by_id: "staff_patel", created_at: day(28), updated_at: day(28) },
  ];

  const visits: Seed<Visit>[] = [
    // Intake column (registration/triage) — emergency, just arrived.
    { id: "vis_mensah", patient_id: "pat_mensah", visit_type: "emergency", status: "open", stage: "triage", department_id: "dept_emergency", attending_doctor_id: "staff_okafor", registered_by_id: "staff_romero", chief_complaint: "Acute chest pain", triage_notes: "Diaphoretic, BP elevated. ECG ordered. Awaiting cardiac workup.", triage_level: 2, arrived_at: day(3), closed_at: null, created_at: day(3), updated_at: day(3) },
    // Consultation column (consultation/diagnostics) — outpatient diabetes follow-up.
    { id: "vis_owusu", patient_id: "pat_owusu", visit_type: "outpatient", status: "open", stage: "diagnostics", department_id: "dept_medicine", attending_doctor_id: "staff_okafor", registered_by_id: "staff_adebayo", chief_complaint: "Routine diabetes review", triage_notes: "Stable, ambulatory. HbA1c sample taken.", triage_level: 5, arrived_at: day(2), closed_at: null, created_at: day(2), updated_at: day(2) },
    // Treatment column — inpatient post-op recovery.
    { id: "vis_idris", patient_id: "pat_idris", visit_type: "inpatient", status: "open", stage: "treatment", department_id: "dept_surgery", attending_doctor_id: "staff_chen", registered_by_id: "staff_adebayo", chief_complaint: "Post-operative recovery, laparotomy", triage_notes: null, triage_level: 3, arrived_at: day(28), closed_at: null, created_at: day(28), updated_at: day(6) },
    // Treatment column — anonymous emergency, head trauma in ICU.
    { id: "vis_anon", patient_id: "pat_anon_gamma", visit_type: "emergency", status: "open", stage: "treatment", department_id: "dept_icu", attending_doctor_id: "staff_okafor", registered_by_id: "staff_romero", chief_complaint: "Unconscious on arrival, head trauma — RTA", triage_notes: "Unidentified. GCS 7 on arrival. Neuro protocol initiated.", triage_level: 1, arrived_at: day(5), closed_at: null, created_at: day(5), updated_at: day(1) },
    // Discharge column — inpatient pneumonia, awaiting financial clearance.
    { id: "vis_bello", patient_id: "pat_bello", visit_type: "inpatient", status: "open", stage: "discharge_planning", department_id: "dept_medicine", attending_doctor_id: "staff_okafor", registered_by_id: "staff_adebayo", chief_complaint: "Community-acquired pneumonia", triage_notes: null, triage_level: 3, arrived_at: day(96), closed_at: null, created_at: day(96), updated_at: day(12) },
  ];

  const consultations: Seed<Consultation>[] = [
    { id: "con_owusu", visit_id: "vis_owusu", doctor_id: "staff_okafor", subjective: "Reports good adherence to metformin. Occasional polyuria. No hypoglycaemic episodes.", examination: "Well, afebrile. Feet examined — no ulcers. BMI 28.", assessment: "Type 2 diabetes mellitus, fair control.", plan: "Check HbA1c. Continue metformin. Dietary reinforcement. Review in 3 months.", created_at: day(2), updated_at: day(2) },
    { id: "con_idris", visit_id: "vis_idris", doctor_id: "staff_chen", subjective: "Mild incisional pain, controlled. Passing flatus.", examination: "Wound clean and dry. Abdomen soft. Bowel sounds present.", assessment: "Day-2 post laparotomy, recovering well.", plan: "Continue analgesia & DVT prophylaxis. Mobilize. Monitor wound.", created_at: day(26), updated_at: day(26) },
    { id: "con_bello", visit_id: "vis_bello", doctor_id: "staff_okafor", subjective: "Cough improving. No fever for 48h. Appetite returning.", examination: "Chest clear on auscultation. SpO₂ 98% on air.", assessment: "Community-acquired pneumonia, resolving.", plan: "Complete oral antibiotics. Plan discharge once finance cleared.", created_at: day(24), updated_at: day(24) },
    { id: "con_anon", visit_id: "vis_anon", doctor_id: "staff_okafor", subjective: "Unable to obtain — patient unresponsive.", examination: "GCS 7 on arrival. Pupils equal & reactive. Localizes to pain.", assessment: "Traumatic brain injury, RTA. Awaiting CT head.", plan: "Neuro protocol, mannitol, close monitoring. CT head urgent.", created_at: day(5), updated_at: day(5) },
  ];

  const diagnoses: Seed<Diagnosis>[] = [
    { id: "dx_owusu", visit_id: "vis_owusu", consultation_id: "con_owusu", diagnosed_by_id: "staff_okafor", icd10_code: "E11.9", description: "Type 2 diabetes mellitus without complications", is_primary: true, created_at: day(2) },
    { id: "dx_bello", visit_id: "vis_bello", consultation_id: "con_bello", diagnosed_by_id: "staff_okafor", icd10_code: "J18.9", description: "Pneumonia, unspecified organism", is_primary: true, created_at: day(24) },
    { id: "dx_anon", visit_id: "vis_anon", consultation_id: "con_anon", diagnosed_by_id: "staff_okafor", icd10_code: "S06.9", description: "Intracranial injury, unspecified", is_primary: true, created_at: day(5) },
  ];

  const orders: Seed<Order>[] = [
    { id: "ord_owusu_hba1c", visit_id: "vis_owusu", ordered_by_id: "staff_okafor", order_type: "lab", description: "HbA1c", status: "completed", created_at: day(2), completed_at: day(1), updated_at: day(1) },
    { id: "ord_bello_cxr", visit_id: "vis_bello", ordered_by_id: "staff_okafor", order_type: "imaging", description: "Chest X-ray (PA)", status: "completed", created_at: day(90), completed_at: day(88), updated_at: day(88) },
    { id: "ord_anon_ct", visit_id: "vis_anon", ordered_by_id: "staff_okafor", order_type: "imaging", description: "CT head (non-contrast)", status: "in_progress", created_at: day(5), completed_at: null, updated_at: day(4) },
    // Fresh, unactioned orders — populate the diagnostics queue on first load.
    { id: "ord_mensah_trop", visit_id: "vis_mensah", ordered_by_id: "staff_okafor", order_type: "lab", description: "Troponin I", status: "requested", created_at: day(3), completed_at: null, updated_at: day(3) },
    { id: "ord_owusu_lipids", visit_id: "vis_owusu", ordered_by_id: "staff_okafor", order_type: "lab", description: "Fasting lipid panel", status: "requested", created_at: day(2), completed_at: null, updated_at: day(2) },
  ];

  const results: Seed<Result>[] = [
    { id: "res_owusu_hba1c", order_id: "ord_owusu_hba1c", recorded_by_id: "staff_boateng", summary: "Moderately elevated — reinforce adherence.", value: "7.8%", reference_range: "< 7.0%", is_abnormal: true, attachment_path: null, recorded_at: day(1) },
    { id: "res_bello_cxr", order_id: "ord_bello_cxr", recorded_by_id: "staff_boateng", summary: "Right lower lobe consolidation, consistent with pneumonia.", value: "Abnormal", reference_range: null, is_abnormal: true, attachment_path: "bello-cxr-pa.jpg", recorded_at: day(88) },
  ];

  const prescriptions: Seed<Prescription>[] = [
    { id: "rx_idris_para", visit_id: "vis_idris", prescribed_by_id: "staff_chen", drug_name: "Paracetamol", dose: "1 g", route: "IV", frequency: "every 6 hours", duration: "3 days", instructions: "For post-op analgesia.", status: "active", created_at: day(28), updated_at: day(6) },
    { id: "rx_idris_enox", visit_id: "vis_idris", prescribed_by_id: "staff_chen", drug_name: "Enoxaparin", dose: "40 mg", route: "SC", frequency: "once daily", duration: "while inpatient", instructions: "DVT prophylaxis.", status: "active", created_at: day(28), updated_at: day(6) },
    { id: "rx_bello_amox", visit_id: "vis_bello", prescribed_by_id: "staff_okafor", drug_name: "Amoxicillin-clavulanate", dose: "625 mg", route: "oral", frequency: "every 8 hours", duration: "7 days", instructions: "Complete full course.", status: "active", created_at: day(90), updated_at: day(12) },
    { id: "rx_owusu_metf", visit_id: "vis_owusu", prescribed_by_id: "staff_okafor", drug_name: "Metformin", dose: "1 g", route: "oral", frequency: "twice daily", duration: "ongoing", instructions: "Take with meals.", status: "active", created_at: day(2), updated_at: day(2) },
  ];

  const medicationAdministrations: Seed<MedicationAdministration>[] = [
    { id: "mar_idris_para_1", prescription_id: "rx_idris_para", administered_by_id: "staff_patel", scheduled_for: day(12), administered_at: day(12), status: "given", notes: "Tolerated well.", created_at: day(12) },
    { id: "mar_idris_para_2", prescription_id: "rx_idris_para", administered_by_id: "staff_patel", scheduled_for: day(6), administered_at: day(6), status: "given", notes: null, created_at: day(6) },
    { id: "mar_idris_enox_1", prescription_id: "rx_idris_enox", administered_by_id: "staff_patel", scheduled_for: day(24), administered_at: day(24), status: "given", notes: null, created_at: day(24) },
    { id: "mar_bello_amox_1", prescription_id: "rx_bello_amox", administered_by_id: "staff_patel", scheduled_for: day(16), administered_at: day(16), status: "given", notes: null, created_at: day(16) },
    { id: "mar_bello_amox_2", prescription_id: "rx_bello_amox", administered_by_id: "staff_patel", scheduled_for: day(8), administered_at: null, status: "missed", notes: "Patient off ward for imaging.", created_at: day(8) },
  ];

  const treatmentRecords: Seed<TreatmentRecord>[] = [
    { id: "trec_mensah_1", visit_id: "vis_mensah", recorded_by_id: "staff_romero", spo2: 96, pulse: 102, bp_systolic: 158, bp_diastolic: 96, temperature_c: 37.0, weight_kg: 78.5, gcs_score: 15, notes: "Chest pain 7/10. ECG taken, troponin sent.", recorded_at: day(3) },
    { id: "trec_idris_1", visit_id: "vis_idris", recorded_by_id: "staff_patel", spo2: 97, pulse: 88, bp_systolic: 128, bp_diastolic: 82, temperature_c: 37.4, weight_kg: 71.0, gcs_score: 15, notes: "Stable post-op. Pain controlled. Mobilizing with assistance.", recorded_at: day(6) },
    { id: "trec_anon_1", visit_id: "vis_anon", recorded_by_id: "staff_patel", spo2: 94, pulse: 104, bp_systolic: 148, bp_diastolic: 95, temperature_c: 37.9, weight_kg: 82.0, gcs_score: 7, notes: "Unresponsive to voice, localizes to pain. Pupils equal/reactive. CT head pending.", recorded_at: day(4) },
    { id: "trec_anon_2", visit_id: "vis_anon", recorded_by_id: "staff_okafor", spo2: 96, pulse: 92, bp_systolic: 138, bp_diastolic: 88, temperature_c: 37.5, weight_kg: 82.0, gcs_score: 9, notes: "Slight improvement in responsiveness. Continue close monitoring.", recorded_at: day(1) },
    { id: "trec_bello_1", visit_id: "vis_bello", recorded_by_id: "staff_patel", spo2: 98, pulse: 74, bp_systolic: 118, bp_diastolic: 76, temperature_c: 36.9, weight_kg: 64.5, gcs_score: 15, notes: "Afebrile 48h. Chest clear on auscultation. Fit for discharge planning.", recorded_at: day(12) },
  ];

  const admissions: Seed<Admission>[] = [
    { id: "adm_idris", visit_id: "vis_idris", patient_id: "pat_idris", attending_doctor_id: "staff_chen", ward_id: "ward_icu", bed_id: "bed_icu_04", status: "active", stage: "treatment", reason: "Post-operative recovery, laparotomy", is_medical_cleared: false, is_financial_cleared: true, is_pharmacy_ready: false, admitted_at: day(28), discharged_at: null, updated_at: day(6) },
    { id: "adm_anon_gamma", visit_id: "vis_anon", patient_id: "pat_anon_gamma", attending_doctor_id: "staff_okafor", ward_id: "ward_icu", bed_id: "bed_icu_02", status: "active", stage: "treatment", reason: "Unconscious on arrival, head trauma — RTA", is_medical_cleared: false, is_financial_cleared: false, is_pharmacy_ready: false, admitted_at: day(5), discharged_at: null, updated_at: day(1) },
    { id: "adm_bello", visit_id: "vis_bello", patient_id: "pat_bello", attending_doctor_id: "staff_okafor", ward_id: "ward_medb", bed_id: "bed_medb_11", status: "active", stage: "discharge_planning", reason: "Community-acquired pneumonia, responding to treatment", is_medical_cleared: true, is_financial_cleared: false, is_pharmacy_ready: true, admitted_at: day(96), discharged_at: null, updated_at: day(12) },
  ];

  // History: Idris deteriorated post-op and was escalated from Medical Ward B
  // to ICU, with his attending changing from the medic to the surgeon.
  const transfers: Seed<Transfer>[] = [
    { id: "trf_idris_icu", admission_id: "adm_idris", patient_id: "pat_idris", from_ward_id: "ward_medb", to_ward_id: "ward_icu", from_bed_id: "bed_medb_09", to_bed_id: "bed_icu_04", from_doctor_id: "staff_okafor", to_doctor_id: "staff_chen", reason: "Post-op deterioration — escalated to critical care", transferred_by_id: "staff_patel", created_at: day(20) },
  ];

  // Nursing care plans for the three admitted patients — the individualized,
  // non-medication care (hygiene, positioning, nutrition…) that fills a shift,
  // plus an append-only care log with shift-handover notes for the next nurse.
  const carePlanItems: Seed<CarePlanItem>[] = [
    // Samuel Idris — ICU-04, post-op laparotomy.
    { id: "cpi_idris_hyg", admission_id: "adm_idris", patient_id: "pat_idris", category: "hygiene", description: "Assist with bed bath, keep skin dry", frequency: "Daily", goal: "Skin remains intact", status: "active", created_by_id: "staff_patel", created_at: day(18), updated_at: day(18) },
    { id: "cpi_idris_pos", admission_id: "adm_idris", patient_id: "pat_idris", category: "mobility_positioning", description: "Turn every 2h to prevent pressure sores", frequency: "Every 2h", goal: "No pressure injury", status: "active", created_by_id: "staff_patel", created_at: day(18), updated_at: day(18) },
    { id: "cpi_idris_temp", admission_id: "adm_idris", patient_id: "pat_idris", category: "temperature", description: "Tepid sponge and review if temp > 38.5°C", frequency: "As needed", goal: null, status: "active", created_by_id: "staff_patel", created_at: day(18), updated_at: day(18) },
    { id: "cpi_idris_nut", admission_id: "adm_idris", patient_id: "pat_idris", category: "nutrition", description: "Soft diet, assist feeding, encourage fluids", frequency: "Each meal", goal: null, status: "active", created_by_id: "staff_patel", created_at: day(18), updated_at: day(18) },
    // Aisha Bello — B-11, pneumonia recovering.
    { id: "cpi_bello_brt", admission_id: "adm_bello", patient_id: "pat_bello", category: "breathing", description: "Sit upright, encourage deep breathing / chest physio", frequency: "Every 4h", goal: "Clear chest, good air entry", status: "active", created_by_id: "staff_patel", created_at: day(90), updated_at: day(90) },
    { id: "cpi_bello_hyg", admission_id: "adm_bello", patient_id: "pat_bello", category: "hygiene", description: "Assist shower", frequency: "Daily", goal: null, status: "active", created_by_id: "staff_patel", created_at: day(90), updated_at: day(90) },
    { id: "cpi_bello_mob", admission_id: "adm_bello", patient_id: "pat_bello", category: "mobility_positioning", description: "Encourage short walks on the ward", frequency: "Twice daily", goal: "Mobilizing independently", status: "active", created_by_id: "staff_patel", created_at: day(90), updated_at: day(90) },
    // John Doe · Gamma — ICU-02, unconscious head trauma, GCS improving.
    { id: "cpi_anon_hyg", admission_id: "adm_anon_gamma", patient_id: "pat_anon_gamma", category: "hygiene", description: "Full bed bath + mouth care", frequency: "Daily", goal: null, status: "active", created_by_id: "staff_patel", created_at: day(4), updated_at: day(4) },
    { id: "cpi_anon_pos", admission_id: "adm_anon_gamma", patient_id: "pat_anon_gamma", category: "mobility_positioning", description: "Turn every 2h", frequency: "Every 2h", goal: "No pressure injury", status: "active", created_by_id: "staff_patel", created_at: day(4), updated_at: day(4) },
    { id: "cpi_anon_elim", admission_id: "adm_anon_gamma", patient_id: "pat_anon_gamma", category: "elimination", description: "Catheter care, monitor output", frequency: "Each shift", goal: null, status: "active", created_by_id: "staff_patel", created_at: day(4), updated_at: day(4) },
    { id: "cpi_anon_eye", admission_id: "adm_anon_gamma", patient_id: "pat_anon_gamma", category: "other", description: "Eye care: clean and protect eyes to prevent dryness", frequency: "Every 4h", goal: null, status: "active", created_by_id: "staff_patel", created_at: day(4), updated_at: day(4) },
    { id: "cpi_anon_safe", admission_id: "adm_anon_gamma", patient_id: "pat_anon_gamma", category: "safety", description: "Cot sides up, neuro observations", frequency: "Each shift", goal: null, status: "active", created_by_id: "staff_patel", created_at: day(4), updated_at: day(4) },
  ];

  const carePlanEntries: Seed<CarePlanEntry>[] = [
    // Samuel Idris — care log + a fresh handover for the evening shift.
    { id: "cpe_idris_1", admission_id: "adm_idris", care_plan_item_id: "cpi_idris_pos", note: "Turned to left side. Temp 37.8°C, settling.", is_handover: false, recorded_by_id: "staff_romero", recorded_at: day(9) },
    { id: "cpe_idris_2", admission_id: "adm_idris", care_plan_item_id: "cpi_idris_hyg", note: "Bed bath given, skin intact. Ate half of lunch.", is_handover: false, recorded_by_id: "staff_patel", recorded_at: day(7) },
    { id: "cpe_idris_ho", admission_id: "adm_idris", care_plan_item_id: null, note: "Anxious about surgery tomorrow — needs reassurance. Watch temperature this evening.", is_handover: true, recorded_by_id: "staff_patel", recorded_at: day(5) },
    // Aisha Bello — care log + handover.
    { id: "cpe_bello_1", admission_id: "adm_bello", care_plan_item_id: "cpi_bello_mob", note: "Walked to end of ward and back, tolerated well.", is_handover: false, recorded_by_id: "staff_patel", recorded_at: day(11) },
    { id: "cpe_bello_ho", admission_id: "adm_bello", care_plan_item_id: null, note: "Chest clearer, coughing productively. Keep prompting deep breathing.", is_handover: true, recorded_by_id: "staff_patel", recorded_at: day(9) },
    // John Doe · Gamma — care log + handover.
    { id: "cpe_anon_1", admission_id: "adm_anon_gamma", care_plan_item_id: "cpi_anon_hyg", note: "Full bed bath and mouth care done. Repositioned. Output adequate.", is_handover: false, recorded_by_id: "staff_patel", recorded_at: day(3) },
    { id: "cpe_anon_ho", admission_id: "adm_anon_gamma", care_plan_item_id: null, note: "GCS improving (7→9). Continue 2-hourly turns and eye care. Family visited.", is_handover: true, recorded_by_id: "staff_patel", recorded_at: day(2) },
  ];

  // -------------------------------------------------------------------------
  // Historical caseload — a deterministically generated 60-day back-catalogue of
  // *closed* visits so the reporting dashboard has rich, varied data to chart
  // (throughput over time, top diagnoses, LOS, demographics, meds dispensed…).
  // These are appended to the live snapshot above; being `closed`/terminal they
  // never appear on the live board, MAR or floor map.
  // -------------------------------------------------------------------------
  seedHistoricalCaseload({
    day,
    patients,
    allergies,
    visits,
    consultations,
    diagnoses,
    orders,
    results,
    prescriptions,
    medicationAdministrations,
    treatmentRecords,
    admissions,
  });

  // -------------------------------------------------------------------------
  // Billing (Phase 16.9) — the price catalog + sample charges for EVERY visit
  // (live + historical) so the bill screen has rich, viewable data on first
  // load. Charges are derived with the same pure engine the live recalc uses
  // (`computeAutoChargeLines`), so seeded data matches what reconciliation would
  // produce. Closed visits are marked settled (`paid`); open visits stay
  // `pending` so they can be settled during testing. Two live visits also carry
  // a showcase manual line and a discount.
  // -------------------------------------------------------------------------
  const billableItems: Seed<BillableItem>[] = BILLING_CATALOG_SEED.map((it) => ({
    id: it.id,
    category: it.category,
    name: it.name,
    unit: it.unit,
    unit_price: it.unit_price,
    ref_code: it.ref_code,
    is_active: it.is_active,
    created_at: day(8760),
    updated_at: day(8760),
  }));

  const charges: Seed<Charge>[] = [];
  {
    const catalog = billableItems as unknown as BillableItem[];
    const wardsForCalc = wards as unknown as Ward[];
    const nowMs = Date.now();
    for (const v of visits) {
      const adm = admissions.find((a) => a.visit_id === v.id) ?? null;
      const trs = adm ? transfers.filter((t) => t.admission_id === adm.id) : [];
      const lines = computeAutoChargeLines({
        visit: v as unknown as Visit,
        consultations: consultations.filter((c) => c.visit_id === v.id) as unknown as Consultation[],
        orders: orders.filter((o) => o.visit_id === v.id) as unknown as Order[],
        prescriptions: prescriptions.filter((p) => p.visit_id === v.id) as unknown as Prescription[],
        admission: adm as unknown as Admission | null,
        transfers: trs as unknown as Transfer[],
        wards: wardsForCalc,
        catalog,
        nowMs,
      });
      const settled = v.status === "closed";
      const baseTs = v.closed_at ?? v.updated_at ?? v.created_at;
      lines.forEach((line, idx) => {
        charges.push({
          id: `chg_${v.id}_${idx}`,
          visit_id: v.id,
          billable_item_id: line.billable_item_id,
          source: line.source,
          source_ref_id: line.source_ref_id,
          description: line.description,
          quantity: line.quantity,
          unit_price: line.unit_price,
          amount: line.amount,
          status: settled ? "paid" : "pending",
          created_by_id: "staff_adebayo",
          created_at: baseTs,
          updated_at: baseTs,
        });
      });
    }
    // Showcase a manual line and a discount on two live (open) visits.
    charges.push({
      id: "chg_idris_manual", visit_id: "vis_idris", billable_item_id: null, source: "manual", source_ref_id: null,
      description: "Wound dressing pack", quantity: 2, unit_price: 1_500, amount: 3_000, status: "pending",
      created_by_id: "staff_adebayo", created_at: day(6), updated_at: day(6),
    });
    charges.push({
      id: "chg_bello_discount", visit_id: "vis_bello", billable_item_id: null, source: "discount", source_ref_id: null,
      description: "Goodwill discount", quantity: 1, unit_price: -2_000, amount: -2_000, status: "pending",
      created_by_id: "staff_quartey", created_at: day(11), updated_at: day(11),
    });
  }

  // Stamp the demo tenant onto every domain row. The seed is built tenantless
  // (`Seed<T>`) so the literals stay terse; ownership is applied in one place.
  const stamp = <T,>(rows: Seed<T>[]): T[] =>
    rows.map((r) => ({ ...r, hospital_id: DEMO_HOSPITAL_ID }) as T);

  return {
    hospitals,
    departments: stamp<Department>(departments),
    wards: stamp<Ward>(wards),
    beds: stamp<Bed>(beds),
    staff: stamp<Staff>(staff),
    patients: stamp<Patient>(patients),
    allergies: stamp<Allergy>(allergies),
    visits: stamp<Visit>(visits),
    consultations: stamp<Consultation>(consultations),
    diagnoses: stamp<Diagnosis>(diagnoses),
    orders: stamp<Order>(orders),
    results: stamp<Result>(results),
    prescriptions: stamp<Prescription>(prescriptions),
    medicationAdministrations: stamp<MedicationAdministration>(medicationAdministrations),
    treatmentRecords: stamp<TreatmentRecord>(treatmentRecords),
    admissions: stamp<Admission>(admissions),
    transfers: stamp<Transfer>(transfers),
    carePlanItems: stamp<CarePlanItem>(carePlanItems),
    carePlanEntries: stamp<CarePlanEntry>(carePlanEntries),
    billableItems: stamp<BillableItem>(billableItems),
    charges: stamp<Charge>(charges),
    // Learned clinical terms grow at runtime (custom terms + usage); no seed.
    clinicalTermRows: [],
    // Follow-up tasks are scheduled at discharge time; no seed.
    followUpTasks: [],
  };
}
