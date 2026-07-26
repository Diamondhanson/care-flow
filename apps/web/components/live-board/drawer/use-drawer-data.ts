"use client";

import { useEffect, useState } from "react";

import {
  getAdmissionForVisit,
  getAllergiesForPatient,
  getBedById,
  getBeds,
  getCarePlanEntriesForAdmission,
  getCarePlanItemsForAdmission,
  getConsultationsForVisit,
  getDepartmentById,
  getDiagnosesForVisit,
  getMedicationAdministrationsForPrescription,
  getOrdersForVisit,
  getPatientById,
  getPatients,
  getPrescriptionsForVisit,
  getResultsForVisit,
  getTransfersForAdmission,
  getTreatmentRecordsForVisit,
  getVisitById,
  getVisitsForPatient,
  getWards,
} from "@/services/mockStorage";
import { useCacheVersion } from "@/lib/use-cache";
import type {
  Admission,
  Allergy,
  Bed,
  CarePlanEntry,
  CarePlanItem,
  Consultation,
  Diagnosis,
  MedicationAdministration,
  Order,
  Patient,
  Prescription,
  Result,
  Transfer,
  TreatmentRecord,
  Visit,
  VisitId,
  Ward,
} from "@careflow/shared";

/** Everything the drawer sections read, loaded in one snapshot per refresh. */
export interface DrawerData {
  visit: Visit;
  admission: Admission | null;
  patient: Patient | null;
  records: TreatmentRecord[];
  consultations: Consultation[];
  diagnoses: Diagnosis[];
  orders: Order[];
  results: Result[];
  prescriptions: Prescription[];
  /** MAR log per prescription id — what the nurse did with each dose. */
  medAdmins: Record<string, MedicationAdministration[]>;
  allergies: Allergy[];
  wards: Ward[];
  beds: Bed[];
  transfers: Transfer[];
  carePlanItems: CarePlanItem[];
  carePlanEntries: CarePlanEntry[];
  /** Verified (non-anonymous) patients other than this one — merge targets. */
  verified: Patient[];
  /** Every visit on this patient's record (cross-visit timeline). */
  patientVisits: Visit[];
  /** Bed label for inpatients, else the department name. */
  location: string | null;
}

/**
 * Shared data loader for the patient drawer. Reloads the full snapshot when
 * the drawer opens, the visit changes, a section reports a mutation
 * (`refresh`), or the offline cache is hydrated (`useCacheVersion`).
 *
 * `resetKey` changes on exactly those same triggers — section components pass
 * it to `useFormReset` so their local drafts reset on drawer open and after
 * every save, matching the previous monolithic behavior.
 */
export function usePatientDrawerData(
  open: boolean,
  visitId: VisitId | null,
  onMutate: () => void,
) {
  const cacheVersion = useCacheVersion();
  const [tick, setTick] = useState(0);
  const [data, setData] = useState<DrawerData | null>(null);

  useEffect(() => {
    if (!open || !visitId) return;
    const v = getVisitById(visitId);
    if (!v) return;
    const adm = getAdmissionForVisit(visitId) ?? null;
    const visitRx = getPrescriptionsForVisit(visitId);
    setData({
      visit: v,
      admission: adm,
      patient: getPatientById(v.patient_id) ?? null,
      records: getTreatmentRecordsForVisit(visitId),
      consultations: getConsultationsForVisit(visitId),
      diagnoses: getDiagnosesForVisit(visitId),
      orders: getOrdersForVisit(visitId),
      results: getResultsForVisit(visitId),
      prescriptions: visitRx,
      medAdmins: Object.fromEntries(
        visitRx.map((p) => [
          p.id,
          getMedicationAdministrationsForPrescription(p.id),
        ]),
      ),
      allergies: getAllergiesForPatient(v.patient_id),
      wards: getWards(),
      beds: getBeds(),
      transfers: adm ? getTransfersForAdmission(adm.id) : [],
      carePlanItems: adm ? getCarePlanItemsForAdmission(adm.id) : [],
      carePlanEntries: adm ? getCarePlanEntriesForAdmission(adm.id) : [],
      verified: getPatients().filter(
        (p) => !p.is_emergency_anonymous && p.id !== v.patient_id,
      ),
      patientVisits: getVisitsForPatient(v.patient_id),
      location: adm?.bed_id
        ? (getBedById(adm.bed_id)?.label ?? null)
        : v.department_id
          ? (getDepartmentById(v.department_id)?.name ?? null)
          : null,
    });
  }, [open, visitId, tick, cacheVersion]);

  function refresh() {
    setTick((t) => t + 1);
    onMutate();
  }

  return {
    data,
    refresh,
    resetKey: `${open}:${visitId ?? "none"}:${tick}:${cacheVersion}`,
  };
}

/**
 * Resets local form state whenever `key` changes, synchronously during render
 * (the React "derived state" pattern), so cleared drafts paint in the same
 * frame as the data refresh — exactly like the old monolithic load effect.
 */
export function useFormReset(key: string, reset: () => void) {
  const [prev, setPrev] = useState(key);
  if (prev !== key) {
    setPrev(key);
    reset();
  }
}
