"use client";

import { useEffect, useMemo, useState } from "react";
import { Link2, Merge, ShieldAlert, UserCheck, X } from "lucide-react";

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  completeAnonymousProfile,
  reconcileAnonymousProfile,
} from "@/services/mockStorage";
import { useT } from "@/components/locale-provider";
import type { Patient, Sex } from "@/types/healthcare";

const SEX_OPTIONS: { value: Sex; labelKey: string }[] = [
  { value: "male", labelKey: "sex.male" },
  { value: "female", labelKey: "sex.female" },
  { value: "other", labelKey: "sex.other" },
  { value: "unknown", labelKey: "sex.unknown" },
];

/** Approximate age (years) → a Jan-1 placeholder DOB, or null when blank. */
function approximateDob(age: string): string | null {
  const years = Number(age);
  if (!Number.isFinite(years) || years <= 0 || years > 130) return null;
  return `${new Date().getFullYear() - Math.floor(years)}-01-01`;
}

export interface ReconcileTarget {
  patientId: string;
  identifier: string;
}

export function ReconcileDialog({
  target,
  verified,
  onClose,
  onDone,
}: {
  /** The anonymous record being reconciled, or null when the dialog is closed. */
  target: ReconcileTarget | null;
  /** Verified patients available as merge targets. */
  verified: Patient[];
  onClose: () => void;
  onDone: (message: string) => void;
}) {
  const { t } = useT();

  // New-identity form fields.
  const [fullName, setFullName] = useState("");
  const [sex, setSex] = useState<Sex>("unknown");
  const [dob, setDob] = useState("");
  const [dobUnknown, setDobUnknown] = useState(false);
  const [approxAge, setApproxAge] = useState("");
  const [phone, setPhone] = useState("");
  const [nationalId, setNationalId] = useState("");
  const [motherFirstName, setMotherFirstName] = useState("");

  // Optional "merge into existing patient" path.
  const [existingQuery, setExistingQuery] = useState("");
  const [linkedId, setLinkedId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Reset every field whenever a new record is opened.
  useEffect(() => {
    if (!target) return;
    setFullName("");
    setSex("unknown");
    setDob("");
    setDobUnknown(false);
    setApproxAge("");
    setPhone("");
    setNationalId("");
    setMotherFirstName("");
    setExistingQuery("");
    setLinkedId(null);
    setError(null);
  }, [target]);

  const linkedPatient = useMemo(
    () => verified.find((p) => p.id === linkedId) ?? null,
    [verified, linkedId],
  );

  const matches = useMemo(() => {
    const q = existingQuery.trim().toLowerCase();
    if (!q) return [];
    return verified
      .filter((p) =>
        [p.full_name, p.mrn, p.phone ?? "", p.national_id ?? ""].some((h) =>
          h.toLowerCase().includes(q),
        ),
      )
      .slice(0, 6);
  }, [verified, existingQuery]);

  function handleSubmit() {
    if (!target) return;
    setError(null);

    // Merge path: an existing patient was linked.
    if (linkedPatient) {
      reconcileAnonymousProfile(target.patientId, linkedPatient.id);
      onDone(t("reconciliation.successMerged", { name: linkedPatient.full_name }));
      return;
    }

    // New-identity path.
    if (!fullName.trim()) {
      setError(t("intake.nameRequired"));
      return;
    }
    const patient = completeAnonymousProfile(target.patientId, {
      full_name: fullName.trim(),
      sex,
      date_of_birth: dobUnknown ? approximateDob(approxAge) : dob || null,
      phone: phone.trim() || null,
      national_id: nationalId.trim() || null,
      mother_first_name: motherFirstName.trim() || null,
    });
    onDone(
      t("reconciliation.successReconciled", {
        name: patient.full_name,
        id: patient.mrn,
      }),
    );
  }

  return (
    <Dialog open={target !== null} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-xl">
        <DialogHeader>
          <DialogTitle>{t("reconciliation.dialogTitle")}</DialogTitle>
          <DialogDescription>
            {t("reconciliation.dialogSubtitle")}
          </DialogDescription>
        </DialogHeader>

        {target ? (
          <div className="flex items-center gap-2 rounded-md border border-border bg-muted/40 px-3 py-2">
            <span
              aria-hidden
              className="flex size-6 items-center justify-center rounded-md"
              style={{
                backgroundColor:
                  "color-mix(in oklab, var(--status-treatment) 18%, transparent)",
                color: "var(--status-treatment)",
              }}
            >
              <ShieldAlert className="size-3.5" />
            </span>
            <span className="truncate font-mono text-sm">
              {target.identifier}
            </span>
          </div>
        ) : null}

        {/* Optional: link an already-registered patient (merge path). */}
        <section className="flex flex-col gap-2">
          <div className="flex flex-col gap-0.5">
            <span className="text-[11px] font-semibold uppercase tracking-[0.1em] text-muted-foreground">
              {t("reconciliation.existingHeading")}
            </span>
            <p className="text-xs text-muted-foreground">
              {t("reconciliation.existingHint")}
            </p>
          </div>

          {linkedPatient ? (
            <div className="flex items-center justify-between gap-2 rounded-md border border-[var(--status-clearance)] bg-[color-mix(in_oklab,var(--status-clearance)_10%,transparent)] px-3 py-2">
              <span className="inline-flex min-w-0 items-center gap-2">
                <Link2 className="size-4 shrink-0 text-[var(--status-clearance)]" />
                <span className="flex min-w-0 flex-col leading-tight">
                  <span className="truncate text-sm font-medium">
                    {t("reconciliation.linkedTo")}: {linkedPatient.full_name}
                  </span>
                  <span className="truncate font-mono text-xs text-muted-foreground">
                    {linkedPatient.mrn || "—"}
                  </span>
                </span>
              </span>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => {
                  setLinkedId(null);
                  setExistingQuery("");
                }}
              >
                <X className="size-3.5" />
                {t("reconciliation.unlink")}
              </Button>
            </div>
          ) : (
            <>
              <Input
                value={existingQuery}
                onChange={(e) => setExistingQuery(e.target.value)}
                placeholder={t("reconciliation.searchExisting")}
              />
              {existingQuery.trim() ? (
                matches.length > 0 ? (
                  <ul className="flex flex-col gap-1 rounded-md border border-border p-1">
                    {matches.map((p) => (
                      <li key={p.id}>
                        <button
                          type="button"
                          onClick={() => setLinkedId(p.id)}
                          className="flex w-full items-center justify-between gap-2 rounded-sm px-2 py-1.5 text-left hover:bg-accent"
                        >
                          <span className="flex min-w-0 flex-col leading-tight">
                            <span className="truncate text-sm">
                              {p.full_name}
                            </span>
                            <span className="truncate font-mono text-xs text-muted-foreground">
                              {p.mrn || "—"}
                              {p.phone ? ` · ${p.phone}` : ""}
                            </span>
                          </span>
                          <Link2 className="size-4 shrink-0 text-muted-foreground" />
                        </button>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="px-1 text-xs text-muted-foreground">
                    {t("reconciliation.noExistingMatches")}
                  </p>
                )
              ) : null}
            </>
          )}
        </section>

        {/* New-identity registration form — hidden once a merge target is linked. */}
        {linkedPatient ? (
          <p className="rounded-md border border-border bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
            {t("reconciliation.mergeWarning")}
          </p>
        ) : (
          <section className="flex flex-col gap-4 border-t border-border pt-4">
            <span className="text-[11px] font-semibold uppercase tracking-[0.1em] text-muted-foreground">
              {t("reconciliation.detailsHeading")}
            </span>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field
                label={t("intake.fullName")}
                htmlFor="rec_full_name"
                className="sm:col-span-2"
              >
                <Input
                  id="rec_full_name"
                  value={fullName}
                  onChange={(e) => setFullName(e.target.value)}
                  placeholder={t("intake.fullNamePlaceholder")}
                />
              </Field>
              <Field label={t("intake.sex")} htmlFor="rec_sex">
                <Select
                  items={Object.fromEntries(
                    SEX_OPTIONS.map((o) => [o.value, t(o.labelKey)]),
                  )}
                  value={sex}
                  onValueChange={(v) => setSex(v as Sex)}
                >
                  <SelectTrigger id="rec_sex" className="w-full">
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
                htmlFor={dobUnknown ? "rec_approx_age" : "rec_dob"}
              >
                {dobUnknown ? (
                  <Input
                    id="rec_approx_age"
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
                    id="rec_dob"
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
              <Field label={t("intake.phone")} htmlFor="rec_phone">
                <Input
                  id="rec_phone"
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                  placeholder={t("intake.phonePlaceholder")}
                />
              </Field>
              <Field label={t("intake.nationalId")} htmlFor="rec_national_id">
                <Input
                  id="rec_national_id"
                  value={nationalId}
                  onChange={(e) => setNationalId(e.target.value)}
                  placeholder={t("intake.nationalIdPlaceholder")}
                />
              </Field>
              <Field
                label={t("intake.motherFirstName")}
                htmlFor="rec_mother_first_name"
                className="sm:col-span-2"
              >
                <Input
                  id="rec_mother_first_name"
                  value={motherFirstName}
                  onChange={(e) => setMotherFirstName(e.target.value)}
                  placeholder={t("intake.motherFirstNamePlaceholder")}
                />
              </Field>
            </div>
          </section>
        )}

        {error ? <p className="text-sm text-destructive">{error}</p> : null}

        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>
            {t("reconciliation.cancel")}
          </Button>
          <Button onClick={handleSubmit}>
            {linkedPatient ? (
              <>
                <Merge className="size-4" />
                {t("reconciliation.confirmMerge")}
              </>
            ) : (
              <>
                <UserCheck className="size-4" />
                {t("reconciliation.confirmReconcile")}
              </>
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
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
