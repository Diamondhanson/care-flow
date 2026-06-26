/**
 * Full-scale role-by-role journey test (QA audit).
 *
 * Unlike the rest of the unit suite — which runs in the `node` env where
 * `loadDatabase()` re-seeds on every call and `persist` is a no-op (so each
 * mutator is hermetic) — this file installs an in-memory `localStorage`
 * polyfill in `beforeAll`. That flips `isBrowser()` to `true`, so mutations
 * persist and CHAIN across calls exactly as they do in the running app. We
 * `resetDatabase()` before each test for isolation.
 *
 * The goal: drive every clinically meaningful action across all six roles —
 * admin, receptionist, nurse, doctor, lab_tech, pharmacist — through the same
 * service-layer contract the UI binds to, and assert the data flows end to end.
 */

import { beforeAll, beforeEach, describe, expect, it } from "vitest";

import {
  addAllergy,
  addCarePlanEntry,
  addCarePlanItem,
  addConsultation,
  addDiagnosis,
  addDiscount,
  addManualCharge,
  addOrder,
  addPrescription,
  addResult,
  addBedsToWard,
  addTreatmentLog,
  assignBedToAdmission,
  completeAnonymousProfile,
  computeWardOccupancy,
  createDepartment,
  createHospital,
  createNewVisit,
  createStaff,
  createWard,
  deleteStaff,
  evaluateDischargeReadiness,
  getActiveVisits,
  getAdmissionForVisit,
  getAllergiesForPatient,
  getBedById,
  getBeds,
  getBillableItems,
  getCarePlanEntriesForAdmission,
  getCarePlanItemsForAdmission,
  getConsultationsForVisit,
  getDiagnosesForVisit,
  getChargesForVisit,
  getOrdersForVisit,
  getPatientById,
  getPrescriptionsForVisit,
  getResultsForVisit,
  recalculateAutoCharges,
  settleBill,
  getStaffForHospital,
  getVisitById,
  getVisits,
  getWards,
  markNoKnownAllergies,
  recordDeath,
  recordDisposition,
  recordMedicationAdministration,
  reconcileAnonymousProfile,
  removeAllergy,
  resetDatabase,
  setActiveHospitalId,
  setDepartmentActive,
  setWardActive,
  transferAdmission,
  updateAdmissionClearances,
  updateBed,
  updateDepartment,
  updateOrderStatus,
  updateVisitStage,
  updateWard,
} from "@/services/mockStorage";
import { computeKpis, outcomeDistribution, presetRange } from "@/components/reports/reports";
import { summarizeBill } from "@/components/billing/billing";

// ---------------------------------------------------------------------------
// In-memory localStorage polyfill — makes isBrowser() true so writes persist.
// ---------------------------------------------------------------------------

beforeAll(() => {
  const store = new Map<string, string>();
  const localStorage = {
    getItem: (k: string) => (store.has(k) ? store.get(k)! : null),
    setItem: (k: string, v: string) => void store.set(k, String(v)),
    removeItem: (k: string) => void store.delete(k),
    clear: () => store.clear(),
    key: (i: number) => Array.from(store.keys())[i] ?? null,
    get length() {
      return store.size;
    },
  };
  // @ts-expect-error — minimal Window shim for the persistence layer.
  globalThis.window = { localStorage };
});

beforeEach(() => {
  resetDatabase();
  setActiveHospitalId("hosp_demo");
});

const FULL_RANGE = () => presetRange("all", Date.now());

// ===========================================================================
// ADMIN — stand up a hospital: tenant, staff across all roles, departments,
// wards, beds, and the lifecycle edits an admin performs.
// ===========================================================================

describe("ADMIN — hospital, staff, departments, wards, beds", () => {
  it("creates a hospital tenant on trial and stamps its id", () => {
    const h = createHospital({
      name: "Bamenda Regional Hospital",
      region: "North-West — Bamenda",
      contact_email: "admin@brh.cm",
    });
    expect(h.id).toBeTruthy();
    expect(h.subscription_status).toBe("trial");
    expect(h.name).toBe("Bamenda Regional Hospital");
  });

  it("provisions staff across all six roles into a hospital", () => {
    const h = createHospital({ name: "Buea Clinic" });
    const roles = [
      "admin",
      "doctor",
      "nurse",
      "lab_tech",
      "pharmacist",
      "receptionist",
    ] as const;
    const created = roles.map((role) =>
      createStaff({
        full_name: `${role} person`,
        role,
        hospital_id: h.id,
      }),
    );
    expect(created).toHaveLength(6);
    const roster = getStaffForHospital(h.id);
    expect(roster.map((s) => s.role).sort()).toEqual([...roles].sort());
    for (const s of roster) {
      expect(s.hospital_id).toBe(h.id);
      expect(s.is_active).toBe(true);
    }
  });

  it("deactivates a staff member (deleteStaff)", () => {
    const h = createHospital({ name: "Limbe Clinic" });
    const s = createStaff({ full_name: "Temp Nurse", role: "nurse", hospital_id: h.id });
    deleteStaff(s.id);
    // Roster no longer lists the deleted member.
    expect(getStaffForHospital(h.id).some((x) => x.id === s.id)).toBe(false);
  });

  it("creates a department and toggles its active flag", () => {
    const dept = createDepartment({ name: "Cardiology", code: "CARD" });
    expect(dept.is_active).toBe(true);
    const renamed = updateDepartment(dept.id, { name: "Cardiology & Vascular" });
    expect(renamed.name).toBe("Cardiology & Vascular");
    const off = setDepartmentActive(dept.id, false);
    expect(off.is_active).toBe(false);
  });

  it("creates a ward with seeded beds, adds more, edits and frees them", () => {
    const ward = createWard({ name: "Recovery Ward", bed_count: 3 });
    expect(getWards().some((w) => w.id === ward.id)).toBe(true);
    let wardBeds = getBeds().filter((b) => b.ward_id === ward.id);
    expect(wardBeds).toHaveLength(3);

    const more = addBedsToWard(ward.id, 2);
    expect(more).toHaveLength(2);
    wardBeds = getBeds().filter((b) => b.ward_id === ward.id);
    expect(wardBeds).toHaveLength(5);

    const renamed = updateBed(wardBeds[0].id, { label: "R-01", status: "maintenance" });
    expect(renamed.label).toBe("R-01");
    expect(renamed.status).toBe("maintenance");

    const renamedWard = updateWard(ward.id, { floor_label: "2nd floor" });
    expect(renamedWard.floor_label).toBe("2nd floor");
    const closed = setWardActive(ward.id, false);
    expect(closed.is_active).toBe(false);

    // Occupancy math holds for the new ward (no occupied beds yet).
    const occ = computeWardOccupancy(getWards(), getBeds()).find(
      (o) => o.ward.id === ward.id,
    )!;
    expect(occ.total).toBe(5);
    expect(occ.occupied).toBe(0);
  });
});

// ===========================================================================
// OUTPATIENT JOURNEY — reception → nurse → doctor → lab → pharmacy → discharge,
// one patient, chained end to end.
// ===========================================================================

describe("OUTPATIENT JOURNEY — registration through discharge", () => {
  it("walks a full outpatient encounter and persists every artefact", () => {
    // RECEPTIONIST — register a new patient + open an outpatient visit.
    const { patient, visit } = createNewVisit(
      {
        full_name: "Awa Tabi",
        date_of_birth: "1991-07-02",
        sex: "female",
        mother_first_name: "Bih",
        phone: "+237 6 70 00 00 00",
      },
      {
        visit_type: "outpatient",
        chief_complaint: "Fever and headache for 3 days",
        registered_by_id: "staff_reception",
      },
    );
    expect(patient.mrn).toMatch(/910702AT - B/);
    expect(visit.stage).toBe("registration");
    expect(visit.status).toBe("open");

    // NURSE — record vitals, then triage and route to the doctor.
    const vitals = addTreatmentLog(visit.id, {
      recorded_by_id: "staff_nurse",
      temperature_c: 39.1,
      pulse: 104,
      spo2: 97,
      bp_systolic: 118,
      bp_diastolic: 76,
    });
    expect(vitals.temperature_c).toBe(39.1);
    updateVisitStage(visit.id, "triage");
    updateVisitStage(visit.id, "consultation");
    expect(getVisitById(visit.id)?.stage).toBe("consultation");

    // DOCTOR — consultation note + diagnosis.
    const consult = addConsultation(visit.id, {
      doctor_id: "staff_chen",
      subjective: "3-day fever, frontal headache",
      examination: "T 39.1, mild neck stiffness absent",
      assessment: "Suspected malaria",
      plan: "MRDT + FBC; start antimalarial if positive",
    });
    expect(getConsultationsForVisit(visit.id).map((c) => c.id)).toContain(consult.id);
    const dx = addDiagnosis(visit.id, {
      consultation_id: consult.id,
      diagnosed_by_id: "staff_chen",
      description: "Uncomplicated malaria",
      icd10_code: "B54",
      is_primary: true,
    });
    expect(getDiagnosesForVisit(visit.id).map((d) => d.id)).toContain(dx.id);

    // DOCTOR — order a lab test. Ordering nudges the visit into diagnostics.
    const order = addOrder(visit.id, {
      ordered_by_id: "staff_chen",
      order_type: "lab",
      description: "Malaria rapid diagnostic test (MRDT)",
    });
    expect(order.status).toBe("requested");
    expect(getVisitById(visit.id)?.stage).toBe("diagnostics");

    // LAB TECH — pick up the order, record an abnormal result, close the loop.
    updateOrderStatus(order.id, "in_progress");
    const result = addResult(order.id, {
      recorded_by_id: "staff_lab",
      summary: "MRDT positive for P. falciparum",
      value: "Positive",
      is_abnormal: true,
    });
    expect(result.is_abnormal).toBe(true);
    expect(getResultsForVisit(visit.id).map((r) => r.id)).toContain(result.id);
    // Recording a result completes the order.
    expect(getOrdersForVisit(visit.id).find((o) => o.id === order.id)?.status).toBe(
      "completed",
    );

    // DOCTOR — prescribe.
    const rx = addPrescription(visit.id, {
      prescribed_by_id: "staff_chen",
      drug_name: "Artemether/Lumefantrine",
      dose: "80/480 mg",
      route: "PO",
      frequency: "BID",
      duration: "3 days",
    });
    expect(getPrescriptionsForVisit(visit.id).map((p) => p.id)).toContain(rx.id);

    // PHARMACIST / NURSE — administer the first dose (MAR).
    const mar = recordMedicationAdministration(rx.id, {
      administered_by_id: "staff_pharm",
      status: "given",
    });
    expect(mar.status).toBe("given");

    // DOCTOR — disposition: discharge home (outpatient, no admission).
    recordDisposition(visit.id, "discharge_home", "staff_chen");
    expect(getVisitById(visit.id)?.stage).toBe("discharge_planning");

    // No admission was created for an outpatient → discharge is ungated.
    const discharged = updateVisitStage(visit.id, "discharged");
    expect(discharged.status).toBe("closed");
    expect(discharged.closed_at).not.toBeNull();
    // Visit drops off the live board.
    expect(getActiveVisits().some((v) => v.id === visit.id)).toBe(false);
  });
});

// ===========================================================================
// INPATIENT JOURNEY — admit, bed, care plan, transfer, clearance gate, discharge.
// ===========================================================================

describe("INPATIENT JOURNEY — admission, clearances, discharge gate", () => {
  it("admits, manages on the floor, and gates discharge on clearances", () => {
    const { visit } = createNewVisit(
      { full_name: "Kofi Mensah", date_of_birth: "1975-03-10", sex: "male" },
      { visit_type: "inpatient", chief_complaint: "Chest pain", attending_doctor_id: "staff_chen" },
    );

    // DOCTOR — admit. recordDisposition("admit") creates the admission.
    recordDisposition(visit.id, "admit", "staff_chen");
    const admission = getAdmissionForVisit(visit.id)!;
    expect(admission).toBeTruthy();
    expect(admission.status).toBe("active");
    expect(getVisitById(visit.id)?.visit_type).toBe("inpatient");

    // NURSE/ADMIN — assign a free bed; it becomes occupied.
    const targetBed = getBeds().find((b) => b.status === "free")!;
    const withBed = assignBedToAdmission(admission.id, targetBed.id);
    expect(withBed.bed_id).toBe(targetBed.id);
    expect(getBedById(targetBed.id)?.status).toBe("occupied");

    // NURSE — build a care plan + log a handover entry.
    const item = addCarePlanItem(admission.id, {
      category: "mobility_positioning",
      description: "Assist to chair BID",
      created_by_id: "staff_nurse",
    });
    expect(getCarePlanItemsForAdmission(admission.id).map((i) => i.id)).toContain(item.id);
    const entry = addCarePlanEntry(admission.id, {
      note: "Tolerated sitting; vitals stable",
      care_plan_item_id: item.id,
      is_handover: true,
      recorded_by_id: "staff_nurse",
    });
    expect(getCarePlanEntriesForAdmission(admission.id).map((e) => e.id)).toContain(entry.id);

    // ADMIN — transfer to another free bed.
    const otherBed = getBeds().find((b) => b.status === "free" && b.id !== targetBed.id)!;
    const { admission: moved } = transferAdmission(admission.id, {
      to_bed_id: otherBed.id,
      reason: "Step-down",
      transferred_by_id: "staff_nurse",
    });
    expect(moved.bed_id).toBe(otherBed.id);
    expect(getBedById(targetBed.id)?.status).toBe("free"); // old bed released

    // DISCHARGE GATE — clearances pending → discharge must throw.
    updateVisitStage(visit.id, "discharge_planning");
    expect(() => updateVisitStage(visit.id, "discharged")).toThrow(/Cannot discharge/i);

    // Grant all three clearances, then discharge succeeds and frees the bed.
    updateAdmissionClearances(moved.id, {
      is_medical_cleared: true,
      is_financial_cleared: true,
      is_pharmacy_ready: true,
    });
    const ready = evaluateDischargeReadiness(
      getAdmissionForVisit(visit.id)!,
      getPatientById(visit.patient_id ?? "")!,
    );
    expect(ready.ready).toBe(true);

    const discharged = updateVisitStage(visit.id, "discharged");
    expect(discharged.status).toBe("closed");
    expect(getBedById(otherBed.id)?.status).toBe("free");
    expect(getAdmissionForVisit(visit.id)?.status).toBe("discharged");
  });
});

// ===========================================================================
// EMERGENCY + RECONCILIATION — anonymous intake then identify.
// ===========================================================================

describe("EMERGENCY — anonymous intake and reconciliation", () => {
  it("registers an anonymous emergency with no MRN, then completes identity in place", () => {
    const { patient, visit } = createNewVisit(
      { full_name: "Unidentified", is_emergency_anonymous: true },
      { visit_type: "emergency", chief_complaint: "Unconscious, RTA" },
    );
    expect(patient.is_emergency_anonymous).toBe(true);
    expect(patient.mrn).toBe(""); // no booklet ID until identified
    expect(patient.anonymous_identifier).toBeTruthy();

    const identified = completeAnonymousProfile(patient.id, {
      full_name: "Samuel Eto",
      date_of_birth: "1987-05-15",
      sex: "male",
      mother_first_name: "Rose",
    });
    expect(identified.is_emergency_anonymous).toBe(false);
    expect(identified.mrn).toMatch(/870515SE - R/);
    // Same patient row → the visit stays attached.
    expect(getVisitById(visit.id)?.patient_id).toBe(identified.id);
  });

  it("folds an anonymous record into an already-registered patient", () => {
    // Create a known patient + an anonymous emergency for the same person.
    const known = createNewVisit(
      { full_name: "Grace Bih", date_of_birth: "1990-01-01", sex: "female" },
      { visit_type: "outpatient" },
    );
    const anon = createNewVisit(
      { full_name: "Unidentified", is_emergency_anonymous: true },
      { visit_type: "emergency" },
    );

    const { patient, reassignedVisits } = reconcileAnonymousProfile(
      anon.patient.id,
      known.patient.id,
    );
    expect(patient.id).toBe(known.patient.id);
    expect(reassignedVisits.map((v) => v.id)).toContain(anon.visit.id);
    // The anonymous emergency visit now belongs to the known patient.
    expect(getVisitById(anon.visit.id)?.patient_id).toBe(known.patient.id);
  });
});

// ===========================================================================
// ALLERGIES — the safety record nurses/doctors maintain.
// ===========================================================================

describe("ALLERGIES — record, mark NKA, remove", () => {
  it("adds, lists and removes an allergy", () => {
    const { patient } = createNewVisit(
      { full_name: "Ada Obi", date_of_birth: "2000-02-02" },
      { visit_type: "outpatient" },
    );
    const allergy = addAllergy(patient.id, {
      substance: "Penicillin",
      category: "drug",
      severity: "severe",
      reaction: "Anaphylaxis",
      noted_by_id: "staff_nurse",
    });
    expect(getAllergiesForPatient(patient.id).map((a) => a.id)).toContain(allergy.id);
    removeAllergy(allergy.id);
    expect(getAllergiesForPatient(patient.id).some((a) => a.id === allergy.id)).toBe(false);
  });

  it("marks no-known-allergies on a patient", () => {
    const { patient } = createNewVisit(
      { full_name: "Eli Cho", date_of_birth: "1999-09-09" },
      { visit_type: "outpatient" },
    );
    const updated = markNoKnownAllergies(patient.id, true);
    expect(updated.no_known_allergies).toBe(true);
  });
});

// ===========================================================================
// DEATH — terminal outcome, never gated by clearances.
// ===========================================================================

describe("DEATH — recorded at any stage, bypasses clearance gate", () => {
  it("records a death on an open inpatient and closes the visit", () => {
    const { visit } = createNewVisit(
      { full_name: "Pierre Nkomo", date_of_birth: "1950-12-01" },
      { visit_type: "inpatient" },
    );
    recordDisposition(visit.id, "admit", "staff_chen");
    // Admission clearances are pending — a discharge would be blocked, a death is not.
    const dead = recordDeath(visit.id, "staff_chen", "Cardiac arrest");
    expect(dead.stage).toBe("deceased");
    expect(dead.status).toBe("closed");
    expect(dead.closed_at).not.toBeNull();
  });

  it("records a death as a consultation disposition (brought in deceased)", () => {
    const { visit } = createNewVisit(
      { full_name: "Marie Eyong", date_of_birth: "1948-06-06" },
      { visit_type: "emergency" },
    );
    const dead = recordDisposition(visit.id, "deceased", "staff_chen");
    expect(dead.stage).toBe("deceased");
    expect(dead.status).toBe("closed");
  });
});

// ===========================================================================
// REPORTING — KPIs and outcomes reflect a day's worth of activity.
// ===========================================================================

describe("REPORTING — KPIs aggregate the journey data", () => {
  it("counts discharges and deaths separately after a mixed day", () => {
    // One discharged outpatient.
    const out = createNewVisit(
      { full_name: "Disc Outpatient", date_of_birth: "1990-01-01" },
      { visit_type: "outpatient" },
    );
    updateVisitStage(out.visit.id, "discharged");

    // One death.
    const dead = createNewVisit(
      { full_name: "Dead Patient", date_of_birth: "1960-01-01" },
      { visit_type: "emergency" },
    );
    recordDeath(dead.visit.id, "staff_chen");

    const range = FULL_RANGE();
    const kpis = computeKpis(getVisits(), [], getBeds(), range);
    // Both new visits are counted in the total.
    expect(kpis.totalVisits).toBeGreaterThanOrEqual(2);
    expect(kpis.deaths).toBeGreaterThanOrEqual(1);

    const outcomes = outcomeDistribution(getVisits(), range);
    const labels = outcomes.map((o) => o.key);
    // Deceased is reported as a distinct outcome bucket.
    expect(labels).toContain("deceased");
  });
});

// ===========================================================================
// BILLING — auto-charges from the clinical record, manual line, discount, settle.
// ===========================================================================

describe("BILLING — itemized bill from a visit, then settlement", () => {
  it("derives charges, adds a manual line + discount, and settles the bill", () => {
    // RECEPTIONIST — register an outpatient visit.
    const { visit } = createNewVisit(
      { full_name: "Bilan Ngo", date_of_birth: "1988-04-12", sex: "female" },
      { visit_type: "outpatient", chief_complaint: "Cough", registered_by_id: "staff_reception" },
    );

    // DOCTOR — consultation, a completed lab order, and a prescription drive the
    // three core auto-charge sources.
    addConsultation(visit.id, { doctor_id: "staff_chen", assessment: "URTI" });
    const order = addOrder(visit.id, {
      ordered_by_id: "staff_chen",
      order_type: "lab",
      description: "Full Blood Count",
    });
    updateOrderStatus(order.id, "completed");
    addPrescription(visit.id, {
      prescribed_by_id: "staff_chen",
      drug_name: "Paracetamol",
      dose: "1 g",
      route: "PO",
      frequency: "TID",
      duration: "5 days",
    });

    // BILLING — derive the auto-charges from the clinical record.
    const auto = recalculateAutoCharges(visit.id);
    const sources = auto.map((c) => c.source);
    expect(sources).toContain("consultation");
    expect(sources).toContain("order");
    expect(sources).toContain("prescription");
    // Outpatient → no bed / nursing lines.
    expect(sources).not.toContain("bed");
    expect(sources).not.toContain("nursing");

    const catalog = getBillableItems();
    const afterAuto = summarizeBill(getChargesForVisit(visit.id), catalog);
    const autoSubtotal = afterAuto.itemsSubtotal;
    expect(autoSubtotal).toBeGreaterThan(0);

    // Reconciliation is idempotent — running it again doesn't duplicate lines.
    recalculateAutoCharges(visit.id);
    expect(getChargesForVisit(visit.id).filter((c) => c.source !== "manual" && c.source !== "discount"))
      .toHaveLength(auto.length);

    // RECEPTIONIST — add a manual line and a discount; both survive a recalc.
    addManualCharge(visit.id, {
      description: "Wound dressing pack",
      quantity: 2,
      unit_price: 1_500,
      created_by_id: "staff_reception",
    });
    addDiscount(visit.id, {
      description: "Goodwill discount",
      amount: 1_000,
      created_by_id: "staff_reception",
    });
    recalculateAutoCharges(visit.id);

    const billed = summarizeBill(getChargesForVisit(visit.id), catalog);
    expect(billed.itemsSubtotal).toBe(autoSubtotal + 3_000); // 2 × 1,500 manual
    expect(billed.discountTotal).toBe(1_000);
    expect(billed.grandTotal).toBe(autoSubtotal + 3_000 - 1_000);
    expect(billed.isFullySettled).toBe(false);

    // SETTLE — every pending line flips to paid; the bill reads fully settled.
    settleBill(visit.id, "staff_reception");
    const settled = summarizeBill(getChargesForVisit(visit.id), catalog);
    expect(settled.isFullySettled).toBe(true);
    expect(getChargesForVisit(visit.id).every((c) => c.status === "paid")).toBe(true);
  });
});
