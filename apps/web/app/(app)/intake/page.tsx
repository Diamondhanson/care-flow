"use client";

import { useEffect, useState } from "react";
import Link from "next/link";

import { isValidPhoneNumber } from "react-phone-number-input";

import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { EmergencyToggleCard } from "@/components/intake/emergency-toggle-card";
import { PatientDetailsCard } from "@/components/intake/patient-details-card";
import {
  BackgroundQuickAddCard,
  type BackgroundEntry,
} from "@/components/intake/background-quick-add";
import { VisitDetailsCard } from "@/components/intake/visit-details-card";
import {
  IntakeSuccessCard,
  type SubmitResult,
} from "@/components/intake/success-card";
import {
  addPatientHistory,
  createNewVisit,
  getDepartments,
  getStaff,
} from "@/services/mockStorage";
import { useT } from "@/components/locale-provider";
import { useCacheVersion } from "@/lib/use-cache";
import type {
  Department,
  DepartmentId,
  MaritalStatus,
  PatientHistoryType,
  Sex,
  Staff,
  StaffId,
  TriageLevel,
} from "@careflow/shared";

/**
 * Turn an approximate age in years into a placeholder date of birth (Jan 1 of
 * the implied year) so a patient who doesn't know their exact birthday still
 * gets an age on file. Returns null for blank/invalid input.
 */
/** Today's date as a local-timezone `YYYY-MM-DD` string (for the DOB `max`). */
function todayISODate(): string {
  const now = new Date();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  return `${now.getFullYear()}-${month}-${day}`;
}

function approximateDob(age: string): string | null {
  const years = Number(age);
  if (!Number.isFinite(years) || years <= 0 || years > 130) return null;
  const birthYear = new Date().getFullYear() - Math.floor(years);
  return `${birthYear}-01-01`;
}

export default function IntakePage() {
  const { t } = useT();
  const cacheVersion = useCacheVersion();
  const [staff, setStaff] = useState<Staff[]>([]);
  const [departments, setDepartments] = useState<Department[]>([]);
  const [isEmergency, setIsEmergency] = useState(false);
  const [result, setResult] = useState<SubmitResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Form fields
  const [fullName, setFullName] = useState("");
  const [sex, setSex] = useState<Sex>("unknown");
  const [dob, setDob] = useState("");
  // When the exact birth date is unknown (common when patients have no records),
  // staff can enter an approximate age in years instead.
  const [dobUnknown, setDobUnknown] = useState(false);
  const [approxAge, setApproxAge] = useState("");
  const [phone, setPhone] = useState("");
  const [nationalId, setNationalId] = useState("");
  const [motherFirstName, setMotherFirstName] = useState("");
  // Demographics (Phase 21) — all optional, intake stays fast.
  const [occupation, setOccupation] = useState("");
  const [maritalStatus, setMaritalStatus] = useState<MaritalStatus>("unknown");
  const [ecName, setEcName] = useState("");
  const [ecPhone, setEcPhone] = useState("");
  // Optional background quick-add (Phase 21): entries are buffered locally and
  // written as patient_history rows once the patient exists on submit.
  const [showBackground, setShowBackground] = useState(false);
  const [bgType, setBgType] = useState<PatientHistoryType>("past_medical");
  const [bgDescription, setBgDescription] = useState("");
  const [bgEntries, setBgEntries] = useState<BackgroundEntry[]>([]);
  const [reason, setReason] = useState("");
  const [departmentId, setDepartmentId] = useState("");
  const [registeredById, setRegisteredById] = useState("");
  const [attendingId, setAttendingId] = useState("");
  // "" = not triaged yet; otherwise a 1–5 acuity level.
  const [triageLevel, setTriageLevel] = useState<"" | `${TriageLevel}`>("");
  // Upper bound for the DOB picker — today, computed on the client after mount
  // so server/first-paint markup never disagrees (AGENTS.md hydration rule).
  const [maxDob, setMaxDob] = useState<string | undefined>(undefined);
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setMaxDob(todayISODate());
  }, []);

  useEffect(() => {
    const all = getStaff();
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setStaff(all);
    setDepartments(getDepartments());
    const clerk =
      all.find((s) => s.role === "receptionist") ??
      all.find((s) => s.role === "admin") ??
      all[0];
    if (clerk) setRegisteredById(clerk.id);
  }, [cacheVersion]);

  // Only active departments are selectable for a new registration; the full list
  // is kept for name lookups (e.g. a doctor still attached to an archived one).
  const activeDepartments = departments.filter((d) => d.is_active);

  // Phone is optional, but anything typed must be a valid number for the
  // country picked in the rich input. (Only shown for non-emergency intake.)
  const phoneInvalid = phone !== "" && !isValidPhoneNumber(phone);
  const ecPhoneInvalid = ecPhone !== "" && !isValidPhoneNumber(ecPhone);

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    if (!registeredById) {
      setError(t("intake.selectStaffError"));
      return;
    }
    if (!reason.trim()) {
      setError(t("intake.reasonRequired"));
      return;
    }
    if (!isEmergency && !fullName.trim()) {
      setError(t("intake.nameRequired"));
      return;
    }
    if (!isEmergency && (phoneInvalid || ecPhoneInvalid)) {
      setError(t("intake.invalidPhone"));
      return;
    }
    // A birth date can never be in the future; recompute "today" at submit time
    // so a form left open overnight still validates against the current date.
    if (!isEmergency && !dobUnknown && dob && dob > todayISODate()) {
      setError(t("intake.dobFutureError"));
      return;
    }

    const { patient } = createNewVisit(
      isEmergency
        ? { full_name: "Unidentified Patient", sex: "unknown", is_emergency_anonymous: true }
        : {
            full_name: fullName.trim(),
            sex,
            date_of_birth: dobUnknown
              ? approximateDob(approxAge)
              : dob || null,
            phone: phone.trim() || null,
            national_id: nationalId.trim() || null,
            mother_first_name: motherFirstName.trim() || null,
            occupation: occupation.trim() || null,
            marital_status: maritalStatus,
            emergency_contact_name: ecName.trim() || null,
            emergency_contact_phone: ecPhone.trim() || null,
          },
      {
        visit_type: isEmergency ? "emergency" : "outpatient",
        stage: isEmergency ? "triage" : "registration",
        // Select values round-trip through the DOM as raw strings; brand the
        // staff/department ids here at the form boundary.
        department_id: (departmentId || null) as DepartmentId | null,
        registered_by_id: registeredById as StaffId,
        attending_doctor_id: (attendingId || null) as StaffId | null,
        chief_complaint: reason.trim(),
        triage_level: triageLevel ? (Number(triageLevel) as TriageLevel) : null,
      },
    );

    // Write the buffered background entries now that the patient exists.
    if (!isEmergency) {
      for (const entry of bgEntries) {
        addPatientHistory(patient.id, {
          type: entry.type,
          description: entry.description,
          // The select's value is a raw DOM string; brand it at this boundary.
          noted_by_id: (registeredById || null) as StaffId | null,
        });
      }
    }

    setResult({
      displayName:
        patient.is_emergency_anonymous && patient.anonymous_identifier
          ? patient.anonymous_identifier
          : patient.full_name,
      isAnonymous: patient.is_emergency_anonymous,
      mrn: patient.mrn ?? "",
    });
  }

  function resetForm() {
    setResult(null);
    setError(null);
    setFullName("");
    setSex("unknown");
    setDob("");
    setDobUnknown(false);
    setApproxAge("");
    setPhone("");
    setNationalId("");
    setMotherFirstName("");
    setOccupation("");
    setMaritalStatus("unknown");
    setEcName("");
    setEcPhone("");
    setShowBackground(false);
    setBgType("past_medical");
    setBgDescription("");
    setBgEntries([]);
    setReason("");
    setDepartmentId("");
    setAttendingId("");
    setTriageLevel("");
    setIsEmergency(false);
  }

  if (result) {
    return <IntakeSuccessCard result={result} onRegisterAnother={resetForm} />;
  }

  return (
    <div className="mx-auto flex max-w-4xl flex-col gap-8">
      <header className="flex flex-col gap-2">
        <h1 className="text-3xl font-semibold tracking-tight lg:text-4xl">
          {t("intake.title")}
        </h1>
        <p className="text-base text-muted-foreground">
          {t("intake.subtitle")}
        </p>
      </header>

      <form onSubmit={handleSubmit} className="flex flex-col gap-6">
        <EmergencyToggleCard
          checked={isEmergency}
          onCheckedChange={setIsEmergency}
        />

        <PatientDetailsCard
          isEmergency={isEmergency}
          fullName={fullName}
          setFullName={setFullName}
          sex={sex}
          setSex={setSex}
          dob={dob}
          setDob={setDob}
          dobUnknown={dobUnknown}
          setDobUnknown={setDobUnknown}
          approxAge={approxAge}
          setApproxAge={setApproxAge}
          maxDob={maxDob}
          phone={phone}
          setPhone={setPhone}
          phoneInvalid={phoneInvalid}
          nationalId={nationalId}
          setNationalId={setNationalId}
          motherFirstName={motherFirstName}
          setMotherFirstName={setMotherFirstName}
          occupation={occupation}
          setOccupation={setOccupation}
          maritalStatus={maritalStatus}
          setMaritalStatus={setMaritalStatus}
          ecName={ecName}
          setEcName={setEcName}
          ecPhone={ecPhone}
          setEcPhone={setEcPhone}
          ecPhoneInvalid={ecPhoneInvalid}
        />

        {/* Optional background quick-add (Phase 21) — collapsed by default so
            intake stays fast; the doctor can complete it in consult. */}
        {!isEmergency ? (
          <BackgroundQuickAddCard
            show={showBackground}
            onToggle={() => setShowBackground((v) => !v)}
            bgType={bgType}
            setBgType={setBgType}
            bgDescription={bgDescription}
            setBgDescription={setBgDescription}
            entries={bgEntries}
            setEntries={setBgEntries}
          />
        ) : null}

        <VisitDetailsCard
          reason={reason}
          setReason={setReason}
          triageLevel={triageLevel}
          setTriageLevel={setTriageLevel}
          departments={activeDepartments}
          departmentId={departmentId}
          setDepartmentId={setDepartmentId}
          staff={staff}
          registeredById={registeredById}
          setRegisteredById={setRegisteredById}
          attendingId={attendingId}
          setAttendingId={setAttendingId}
        />

        {error ? (
          <p className="text-sm text-destructive">{error}</p>
        ) : null}

        <Separator />

        <div className="flex items-center justify-end gap-3">
          <Button
            type="button"
            variant="ghost"
            nativeButton={false}
            render={<Link href="/dashboard" />}
          >
            {t("common.cancel")}
          </Button>
          <Button
            type="submit"
            disabled={!isEmergency && (phoneInvalid || ecPhoneInvalid)}
          >
            {isEmergency ? t("intake.registerEmergency") : t("intake.register")}
          </Button>
        </div>
      </form>
    </div>
  );
}
