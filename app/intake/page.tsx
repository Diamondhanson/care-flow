"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { ShieldAlert, CheckCircle2, ArrowRight } from "lucide-react";

import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
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
import { createNewAdmission, getStaff } from "@/services/mockStorage";
import type { Sex, Staff } from "@/types/healthcare";

interface SubmitResult {
  displayName: string;
  isAnonymous: boolean;
  location: string | null;
}

const SEX_OPTIONS: { value: Sex; label: string }[] = [
  { value: "male", label: "Male" },
  { value: "female", label: "Female" },
  { value: "other", label: "Other" },
  { value: "unknown", label: "Unknown" },
];

export default function IntakePage() {
  const [staff, setStaff] = useState<Staff[]>([]);
  const [isEmergency, setIsEmergency] = useState(false);
  const [result, setResult] = useState<SubmitResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Form fields
  const [fullName, setFullName] = useState("");
  const [sex, setSex] = useState<Sex>("unknown");
  const [dob, setDob] = useState("");
  const [phone, setPhone] = useState("");
  const [nationalId, setNationalId] = useState("");
  const [reason, setReason] = useState("");
  const [location, setLocation] = useState("");
  const [admittedById, setAdmittedById] = useState("");
  const [attendingId, setAttendingId] = useState("");

  useEffect(() => {
    const all = getStaff();
    setStaff(all);
    const clerk = all.find((s) => s.role === "admin") ?? all[0];
    if (clerk) setAdmittedById(clerk.id);
  }, []);

  const doctors = staff.filter((s) => s.role === "doctor");

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    if (!admittedById) {
      setError("Select the admitting staff member.");
      return;
    }
    if (!reason.trim()) {
      setError("A presenting reason is required.");
      return;
    }
    if (!isEmergency && !fullName.trim()) {
      setError("Patient name is required for a standard intake.");
      return;
    }

    const { patient } = createNewAdmission(
      isEmergency
        ? { full_name: "Unidentified", is_emergency_anonymous: true }
        : {
            full_name: fullName.trim(),
            sex,
            date_of_birth: dob || null,
            phone: phone.trim() || null,
            national_id: nationalId.trim() || null,
          },
      {
        admitted_by_id: admittedById,
        attending_doctor_id: attendingId || null,
        reason: reason.trim(),
        location: location.trim() || null,
        stage: "boarding",
      },
    );

    setResult({
      displayName:
        patient.is_emergency_anonymous && patient.anonymous_identifier
          ? patient.anonymous_identifier
          : patient.full_name,
      isAnonymous: patient.is_emergency_anonymous,
      location: location.trim() || null,
    });
  }

  function resetForm() {
    setResult(null);
    setError(null);
    setFullName("");
    setSex("unknown");
    setDob("");
    setPhone("");
    setNationalId("");
    setReason("");
    setLocation("");
    setAttendingId("");
    setIsEmergency(false);
  }

  if (result) {
    return (
      <div className="mx-auto flex max-w-2xl flex-col gap-6">
        <Card>
          <CardContent className="flex flex-col items-center gap-4 py-12 text-center">
            <CheckCircle2 className="size-10 text-[var(--status-clearance)]" />
            <div className="flex flex-col gap-1">
              <p className="text-lg font-semibold">Patient boarded</p>
              <p className="text-sm text-muted-foreground">
                Added to the Live Board in the Boarding stage.
              </p>
            </div>
            <div className="flex w-full flex-col gap-1 rounded-md border border-border bg-muted/40 p-4">
              <span className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                {result.isAnonymous ? "Emergency tracking tag" : "Patient"}
              </span>
              <span className="font-mono text-sm">{result.displayName}</span>
              {result.location ? (
                <span className="font-mono text-xs text-muted-foreground">
                  {result.location}
                </span>
              ) : null}
            </div>
            <div className="flex gap-3">
              <Button nativeButton={false} render={<Link href="/" />}>
                View on board <ArrowRight className="size-4" />
              </Button>
              <Button variant="outline" onClick={resetForm}>
                Board another
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-6">
      <header className="flex flex-col gap-1">
        <h1 className="text-2xl font-semibold tracking-tight">Patient Intake</h1>
        <p className="text-sm text-muted-foreground">
          Board a new patient onto the Live Status Board.
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
                  Emergency Unconscious Intake
                </Label>
                <p className="text-xs text-muted-foreground">
                  Skip identity paperwork and assign an anonymous tracking tag.
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
              {isEmergency ? "Emergency record" : "Patient details"}
            </span>
          </CardHeader>
          <CardContent className="flex flex-col gap-5">
            {isEmergency ? (
              <div className="rounded-md border border-dashed border-border bg-muted/30 p-4 text-sm text-muted-foreground">
                Personal fields are hidden. A tracking tag (e.g.{" "}
                <span className="font-mono">John Doe - Gamma - …</span>) will be
                generated automatically on submit.
              </div>
            ) : (
              <div className="grid gap-5 sm:grid-cols-2">
                <Field label="Full name" htmlFor="full_name" className="sm:col-span-2">
                  <Input
                    id="full_name"
                    value={fullName}
                    onChange={(e) => setFullName(e.target.value)}
                    placeholder="e.g. Ada Mensah"
                  />
                </Field>
                <Field label="Sex" htmlFor="sex">
                  <Select
                    items={Object.fromEntries(
                      SEX_OPTIONS.map((o) => [o.value, o.label]),
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
                          {o.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </Field>
                <Field label="Date of birth" htmlFor="dob">
                  <Input
                    id="dob"
                    type="date"
                    value={dob}
                    onChange={(e) => setDob(e.target.value)}
                  />
                </Field>
                <Field label="Phone" htmlFor="phone">
                  <Input
                    id="phone"
                    value={phone}
                    onChange={(e) => setPhone(e.target.value)}
                    placeholder="Optional"
                  />
                </Field>
                <Field label="National ID / MRN" htmlFor="national_id">
                  <Input
                    id="national_id"
                    value={nationalId}
                    onChange={(e) => setNationalId(e.target.value)}
                    placeholder="Optional"
                  />
                </Field>
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-0">
            <span className="text-[11px] font-semibold uppercase tracking-[0.1em] text-muted-foreground">
              Admission
            </span>
          </CardHeader>
          <CardContent className="flex flex-col gap-5">
            <Field label="Presenting reason" htmlFor="reason">
              <Textarea
                id="reason"
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                placeholder="e.g. Head trauma following road traffic accident"
              />
            </Field>
            <div className="grid gap-5 sm:grid-cols-2">
              <Field label="Location" htmlFor="location">
                <Input
                  id="location"
                  value={location}
                  onChange={(e) => setLocation(e.target.value)}
                  placeholder="e.g. ER-Bay-2"
                />
              </Field>
              <Field label="Admitting staff" htmlFor="admitted_by">
                <Select
                  items={Object.fromEntries(
                    staff.map((s) => [s.id, `${s.full_name} · ${s.role}`]),
                  )}
                  value={admittedById}
                  onValueChange={(v) => setAdmittedById(v as string)}
                >
                  <SelectTrigger id="admitted_by" className="w-full">
                    <SelectValue placeholder="Select staff" />
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
                label="Attending doctor"
                htmlFor="attending"
                className="sm:col-span-2"
              >
                <Select
                  items={Object.fromEntries(
                    doctors.map((s) => [s.id, `${s.full_name} · ${s.department}`]),
                  )}
                  value={attendingId}
                  onValueChange={(v) => setAttendingId(v as string)}
                >
                  <SelectTrigger id="attending" className="w-full">
                    <SelectValue placeholder="Unassigned" />
                  </SelectTrigger>
                  <SelectContent>
                    {doctors.map((s) => (
                      <SelectItem key={s.id} value={s.id}>
                        {s.full_name} · {s.department}
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
            render={<Link href="/" />}
          >
            Cancel
          </Button>
          <Button type="submit">
            {isEmergency ? "Board emergency patient" : "Board patient"}
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
