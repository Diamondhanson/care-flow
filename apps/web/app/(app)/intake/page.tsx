"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { ShieldAlert, CheckCircle2, ArrowRight } from "lucide-react";

import { isValidPhoneNumber } from "react-phone-number-input";

import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { PhoneInput } from "@/components/ui/phone-input";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Separator } from "@/components/ui/separator";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { createNewVisit, getDepartments, getStaff } from "@/services/mockStorage";
import { useT } from "@/components/locale-provider";
import type { Department, Sex, Staff, TriageLevel } from "@/types/healthcare";

interface SubmitResult {
  displayName: string;
  isAnonymous: boolean;
  mrn: string;
}

const SEX_OPTIONS: { value: Sex; labelKey: string }[] = [
  { value: "male", labelKey: "sex.male" },
  { value: "female", labelKey: "sex.female" },
  { value: "other", labelKey: "sex.other" },
  { value: "unknown", labelKey: "sex.unknown" },
];

/**
 * Turn an approximate age in years into a placeholder date of birth (Jan 1 of
 * the implied year) so a patient who doesn't know their exact birthday still
 * gets an age on file. Returns null for blank/invalid input.
 */
function approximateDob(age: string): string | null {
  const years = Number(age);
  if (!Number.isFinite(years) || years <= 0 || years > 130) return null;
  const birthYear = new Date().getFullYear() - Math.floor(years);
  return `${birthYear}-01-01`;
}

export default function IntakePage() {
  const { t } = useT();
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
  const [reason, setReason] = useState("");
  const [departmentId, setDepartmentId] = useState("");
  const [registeredById, setRegisteredById] = useState("");
  const [attendingId, setAttendingId] = useState("");
  // "" = not triaged yet; otherwise a 1–5 acuity level.
  const [triageLevel, setTriageLevel] = useState<"" | `${TriageLevel}`>("");

  useEffect(() => {
    const all = getStaff();
    setStaff(all);
    setDepartments(getDepartments());
    const clerk =
      all.find((s) => s.role === "receptionist") ??
      all.find((s) => s.role === "admin") ??
      all[0];
    if (clerk) setRegisteredById(clerk.id);
  }, []);

  const doctors = staff.filter((s) => s.role === "doctor");
  const deptName = (id: string | null) =>
    id ? (departments.find((d) => d.id === id)?.name ?? "—") : "—";

  // Phone is optional, but anything typed must be a valid number for the
  // country picked in the rich input. (Only shown for non-emergency intake.)
  const phoneInvalid = phone !== "" && !isValidPhoneNumber(phone);

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
    if (!isEmergency && phoneInvalid) {
      setError(t("intake.invalidPhone"));
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
          },
      {
        visit_type: isEmergency ? "emergency" : "outpatient",
        stage: isEmergency ? "triage" : "registration",
        department_id: departmentId || null,
        registered_by_id: registeredById,
        attending_doctor_id: attendingId || null,
        chief_complaint: reason.trim(),
        triage_level: triageLevel ? (Number(triageLevel) as TriageLevel) : null,
      },
    );

    setResult({
      displayName:
        patient.is_emergency_anonymous && patient.anonymous_identifier
          ? patient.anonymous_identifier
          : patient.full_name,
      isAnonymous: patient.is_emergency_anonymous,
      mrn: patient.mrn,
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
    setReason("");
    setDepartmentId("");
    setAttendingId("");
    setTriageLevel("");
    setIsEmergency(false);
  }

  if (result) {
    return (
      <div className="mx-auto flex max-w-2xl flex-col gap-6">
        <Card>
          <CardContent className="flex flex-col items-center gap-4 py-12 text-center">
            <CheckCircle2 className="size-10 text-[var(--status-clearance)]" />
            <div className="flex flex-col gap-1">
              <p className="text-lg font-semibold">{t("intake.visitOpened")}</p>
              <p className="text-sm text-muted-foreground">
                {t("intake.visitOpenedHint")}
              </p>
            </div>
            <div className="flex w-full flex-col gap-1 rounded-md border border-border bg-muted/40 p-4">
              <span className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                {result.isAnonymous ? t("intake.emergencyTag") : t("intake.patient")}
              </span>
              <span className="font-mono text-sm">{result.displayName}</span>
              {result.mrn ? (
                <span className="font-mono text-xs text-muted-foreground">
                  {t("intake.patientIdTag")} {result.mrn}
                </span>
              ) : null}
            </div>
            <div className="flex gap-3">
              <Button nativeButton={false} render={<Link href="/dashboard" />}>
                {t("intake.viewOnBoard")} <ArrowRight className="size-4" />
              </Button>
              <Button variant="outline" onClick={resetForm}>
                {t("intake.registerAnother")}
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>
    );
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
        {/* Emergency toggle */}
        <Card
          className={
            isEmergency ? "border-[var(--status-treatment)] bg-muted/30" : ""
          }
        >
          <CardContent className="flex items-center justify-between gap-4 py-4">
            <div className="flex items-start gap-3">
              <ShieldAlert
                className="mt-0.5 size-5 shrink-0"
                style={{ color: "var(--status-treatment)" }}
              />
              <div className="flex flex-col gap-0.5">
                <Label htmlFor="emergency" className="text-sm font-medium">
                  {t("intake.emergencyToggle")}
                </Label>
                <p className="text-xs text-muted-foreground">
                  {t("intake.emergencyToggleHint")}
                </p>
              </div>
            </div>
            <Switch
              id="emergency"
              checked={isEmergency}
              onCheckedChange={setIsEmergency}
            />
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-0">
            <span className="text-[11px] font-semibold uppercase tracking-[0.1em] text-muted-foreground">
              {isEmergency ? t("intake.emergencyRecord") : t("intake.patientDetails")}
            </span>
          </CardHeader>
          <CardContent className="flex flex-col gap-5">
            {isEmergency ? (
              <div className="rounded-md border border-dashed border-border bg-muted/30 p-4 text-sm text-muted-foreground">
                {t("intake.emergencyFieldsHidden")}{" "}
                <span className="font-mono">John Doe - Gamma - …</span>
                {t("intake.emergencyFieldsHiddenSuffix")}
              </div>
            ) : (
              <div className="grid gap-5 sm:grid-cols-2">
                <Field label={t("intake.fullName")} htmlFor="full_name" className="sm:col-span-2">
                  <Input
                    id="full_name"
                    value={fullName}
                    onChange={(e) => setFullName(e.target.value)}
                    placeholder={t("intake.fullNamePlaceholder")}
                  />
                </Field>
                <Field label={t("intake.sex")} htmlFor="sex">
                  <Select
                    items={Object.fromEntries(
                      SEX_OPTIONS.map((o) => [o.value, t(o.labelKey)]),
                    )}
                    value={sex}
                    onValueChange={(v) => setSex(v as Sex)}
                  >
                    <SelectTrigger id="sex" className="w-full">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {SEX_OPTIONS.map((o) => (
                        <SelectItem key={o.value} value={o.value}>
                          {t(o.labelKey)}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </Field>
                <Field
                  label={dobUnknown ? t("intake.approxAge") : t("intake.dob")}
                  htmlFor={dobUnknown ? "approx_age" : "dob"}
                >
                  {dobUnknown ? (
                    <Input
                      id="approx_age"
                      type="number"
                      inputMode="numeric"
                      min={0}
                      max={130}
                      value={approxAge}
                      onChange={(e) => setApproxAge(e.target.value)}
                      placeholder={t("intake.approxAgePlaceholder")}
                    />
                  ) : (
                    <Input
                      id="dob"
                      type="date"
                      value={dob}
                      onChange={(e) => setDob(e.target.value)}
                    />
                  )}
                  <button
                    type="button"
                    onClick={() => setDobUnknown((v) => !v)}
                    className="self-start text-xs font-medium text-muted-foreground underline-offset-2 hover:text-foreground hover:underline"
                  >
                    {dobUnknown ? t("intake.useExactDob") : t("intake.dobUnknown")}
                  </button>
                </Field>
                <Field label={t("intake.phone")} htmlFor="phone">
                  <PhoneInput
                    id="phone"
                    value={phone}
                    onChange={(value) => setPhone(value ?? "")}
                    invalid={phoneInvalid}
                  />
                  {phoneInvalid ? (
                    <p
                      id="phone-error"
                      role="alert"
                      className="text-xs text-destructive"
                    >
                      {t("intake.invalidPhone")}
                    </p>
                  ) : null}
                </Field>
                <Field label={t("intake.nationalId")} htmlFor="national_id">
                  <Input
                    id="national_id"
                    value={nationalId}
                    onChange={(e) => setNationalId(e.target.value)}
                    placeholder={t("intake.nationalIdPlaceholder")}
                  />
                </Field>
                <Field
                  label={t("intake.motherFirstName")}
                  htmlFor="mother_first_name"
                  className="sm:col-span-2"
                >
                  <Input
                    id="mother_first_name"
                    value={motherFirstName}
                    onChange={(e) => setMotherFirstName(e.target.value)}
                    placeholder={t("intake.motherFirstNamePlaceholder")}
                  />
                  <p className="text-xs text-muted-foreground">
                    {t("intake.motherFirstNameHint")}
                  </p>
                </Field>
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-0">
            <span className="text-[11px] font-semibold uppercase tracking-[0.1em] text-muted-foreground">
              {t("intake.visit")}
            </span>
          </CardHeader>
          <CardContent className="flex flex-col gap-5">
            <Field label={t("intake.reason")} htmlFor="reason">
              <Textarea
                id="reason"
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                placeholder={t("intake.reasonPlaceholder")}
              />
            </Field>
            <div className="grid gap-5 sm:grid-cols-2">
              <Field
                label={t("intake.triage")}
                htmlFor="triage"
                className="sm:col-span-2"
              >
                <Select
                  items={{
                    "": t("intake.triageNone"),
                    ...Object.fromEntries(
                      ([1, 2, 3, 4, 5] as const).map((n) => [
                        String(n),
                        `${t("liveBoard.triage.label", { level: String(n) })} · ${t(`liveBoard.triage.${n}`)}`,
                      ]),
                    ),
                  }}
                  value={triageLevel}
                  onValueChange={(v) => setTriageLevel(v as "" | `${TriageLevel}`)}
                >
                  <SelectTrigger id="triage" className="w-full">
                    <SelectValue placeholder={t("intake.triageNone")} />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="">{t("intake.triageNone")}</SelectItem>
                    {([1, 2, 3, 4, 5] as const).map((n) => (
                      <SelectItem key={n} value={String(n)}>
                        <span className="inline-flex items-center gap-2">
                          <span
                            aria-hidden
                            className="size-2 rounded-full"
                            style={{ backgroundColor: `var(--triage-${n})` }}
                          />
                          {t("liveBoard.triage.label", { level: String(n) })} ·{" "}
                          {t(`liveBoard.triage.${n}`)}
                        </span>
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Field>
              <Field label={t("intake.department")} htmlFor="department">
                <Select
                  items={Object.fromEntries(
                    departments.map((d) => [d.id, d.name]),
                  )}
                  value={departmentId}
                  onValueChange={(v) => setDepartmentId(v as string)}
                >
                  <SelectTrigger id="department" className="w-full">
                    <SelectValue placeholder={t("intake.selectDepartment")} />
                  </SelectTrigger>
                  <SelectContent>
                    {departments.map((d) => (
                      <SelectItem key={d.id} value={d.id}>
                        {d.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Field>
              <Field label={t("intake.registeringStaff")} htmlFor="registered_by">
                <Select
                  items={Object.fromEntries(
                    staff.map((s) => [s.id, `${s.full_name} · ${s.role}`]),
                  )}
                  value={registeredById}
                  onValueChange={(v) => setRegisteredById(v as string)}
                >
                  <SelectTrigger id="registered_by" className="w-full">
                    <SelectValue placeholder={t("intake.selectStaff")} />
                  </SelectTrigger>
                  <SelectContent>
                    {staff.map((s) => (
                      <SelectItem key={s.id} value={s.id}>
                        {s.full_name} · {s.role}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Field>
              <Field
                label={t("intake.attendingDoctor")}
                htmlFor="attending"
                className="sm:col-span-2"
              >
                <Select
                  items={Object.fromEntries(
                    doctors.map((s) => [s.id, `${s.full_name} · ${deptName(s.department_id)}`]),
                  )}
                  value={attendingId}
                  onValueChange={(v) => setAttendingId(v as string)}
                >
                  <SelectTrigger id="attending" className="w-full">
                    <SelectValue placeholder={t("intake.unassigned")} />
                  </SelectTrigger>
                  <SelectContent>
                    {doctors.map((s) => (
                      <SelectItem key={s.id} value={s.id}>
                        {s.full_name} · {deptName(s.department_id)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Field>
            </div>
          </CardContent>
        </Card>

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
          <Button type="submit" disabled={!isEmergency && phoneInvalid}>
            {isEmergency ? t("intake.registerEmergency") : t("intake.register")}
          </Button>
        </div>
      </form>
    </div>
  );
}

function Field({
  label,
  htmlFor,
  className,
  children,
}: {
  label: string;
  htmlFor: string;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <div className={`flex flex-col gap-1.5 ${className ?? ""}`}>
      <Label htmlFor={htmlFor}>{label}</Label>
      {children}
    </div>
  );
}
