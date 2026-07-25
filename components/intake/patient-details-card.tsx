"use client";

import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { PhoneInput } from "@/components/ui/phone-input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Field } from "@/components/intake/field";
import { useT } from "@/components/locale-provider";
import type { Sex } from "@/types/healthcare";
import type { MessageKey } from "@/i18n";

const SEX_OPTIONS: { value: Sex; labelKey: MessageKey }[] = [
  { value: "male", labelKey: "sex.male" },
  { value: "female", labelKey: "sex.female" },
  { value: "other", labelKey: "sex.other" },
  { value: "unknown", labelKey: "sex.unknown" },
];

/** Identity fields — hidden behind a notice for anonymous emergency intake. */
export function PatientDetailsCard({
  isEmergency,
  fullName,
  setFullName,
  sex,
  setSex,
  dob,
  setDob,
  dobUnknown,
  setDobUnknown,
  approxAge,
  setApproxAge,
  maxDob,
  phone,
  setPhone,
  phoneInvalid,
  nationalId,
  setNationalId,
  motherFirstName,
  setMotherFirstName,
}: {
  isEmergency: boolean;
  fullName: string;
  setFullName: (v: string) => void;
  sex: Sex;
  setSex: (v: Sex) => void;
  dob: string;
  setDob: (v: string) => void;
  dobUnknown: boolean;
  setDobUnknown: (update: (v: boolean) => boolean) => void;
  approxAge: string;
  setApproxAge: (v: string) => void;
  /** Upper bound for the DOB picker (client-only, see the page). */
  maxDob: string | undefined;
  phone: string;
  setPhone: (v: string) => void;
  phoneInvalid: boolean;
  nationalId: string;
  setNationalId: (v: string) => void;
  motherFirstName: string;
  setMotherFirstName: (v: string) => void;
}) {
  const { t } = useT();
  return (
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
                  max={maxDob}
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
  );
}
