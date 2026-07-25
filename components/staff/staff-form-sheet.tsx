"use client";

import { useEffect, useState } from "react";
import { isValidPhoneNumber } from "react-phone-number-input";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { PhoneInput } from "@/components/ui/phone-input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
  SheetFooter,
} from "@/components/ui/sheet";
import {
  createStaff,
  deleteStaff,
  setStaffUserId,
  updateStaff,
} from "@/services/mockStorage";
import { ROLE_GROUPS } from "@/components/staff/staff-card";
import { useT } from "@/components/locale-provider";
import { useAuth } from "@/components/auth-provider";
import { getSupabaseClient } from "@/lib/supabase/client";
import { provisionStaffLogin } from "@/app/actions/auth";
import type { Department, Staff, StaffRole } from "@/types/healthcare";
import type { MessageKey } from "@/i18n";

/** Role options for the add-staff select, in directory order. */
const ROLE_OPTIONS: readonly { role: StaffRole; label: MessageKey }[] = ROLE_GROUPS.map(
  (g) => ({ role: g.role, label: g.label }),
);

export function StaffFormSheet({
  target,
  departments,
  onClose,
  onSaved,
}: {
  /** `"new"` opens the add form; a Staff row opens the same sheet in edit mode. */
  target: Staff | "new" | null;
  departments: Department[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const { t } = useT();
  const { currentHospital } = useAuth();
  const isNew = target === "new";
  const staff = target && target !== "new" ? target : null;

  const [name, setName] = useState("");
  const [role, setRole] = useState<StaffRole | null>(null);
  const [departmentId, setDepartmentId] = useState<string>("none");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  // Email/phone are optional, but anything typed must be well-formed. Phone is
  // validated for the country picked in the rich input (E.164 from libphonenumber).
  const emailInvalid =
    email.trim() !== "" && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim());
  const phoneInvalid = phone !== "" && !isValidPhoneNumber(phone);

  // Sync the form whenever the target changes (open blank / open a record).
  useEffect(() => {
    setName(staff?.full_name ?? "");
    setRole(staff?.role ?? null);
    setDepartmentId(staff?.department_id ?? "none");
    setUsername("");
    setPassword("");
    setEmail(staff?.email ?? "");
    setPhone(staff?.phone ?? "");
    setError(null);
    setSaving(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [target]);

  // Departments offered for assignment: active ones, plus the staff member's
  // current department (kept selectable even if it has been archived since).
  const departmentOptions = departments.filter(
    (d) => d.is_active || d.id === staff?.department_id,
  );

  async function handleSave() {
    setError(null);
    if (!name.trim()) {
      setError(t("staff.nameRequired"));
      return;
    }
    if (!role) {
      setError(t("staff.roleRequired"));
      return;
    }
    if (isNew && !username.trim()) {
      setError(t("staff.usernameRequired"));
      return;
    }
    if (isNew && password.length < 6) {
      setError(t("staff.passwordTooShort"));
      return;
    }
    if (emailInvalid) {
      setError(t("staff.invalidEmail"));
      return;
    }
    if (phoneInvalid) {
      setError(t("staff.invalidPhone"));
      return;
    }

    // Edit mode: patch the existing row and we're done — no auth involved.
    if (staff) {
      setSaving(true);
      try {
        updateStaff(staff.id, {
          full_name: name,
          role,
          department_id:
            departmentId === "none" ? null : (departmentId as Department["id"]),
          email: email.trim() || null,
          phone: phone.trim() || null,
        });
        onSaved();
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
      } finally {
        setSaving(false);
      }
      return;
    }

    if (!currentHospital) {
      setError(t("staff.noHospital"));
      return;
    }

    setSaving(true);
    // Create the mock staff row first so we have its id to bridge the login to,
    // then provision a real Supabase Auth login. If provisioning fails (e.g. the
    // username is taken) we roll the mock row back so retrying is clean.
    const created = createStaff({
      full_name: name,
      role,
      email: email.trim() || null,
      phone: phone.trim() || null,
      department_id: departmentId === "none" ? null : (departmentId as Department["id"]),
      hospital_id: currentHospital.id,
    });
    try {
      // The action verifies the caller is an admin of this hospital (Stage 6);
      // sessions live in localStorage, so the client passes its JWT explicitly.
      let accessToken: string | undefined;
      try {
        const { data } = await getSupabaseClient().auth.getSession();
        accessToken = data.session?.access_token;
      } catch {
        accessToken = undefined;
      }
      if (!accessToken) {
        deleteStaff(created.id);
        setError(t("staff.resetNoSession"));
        return;
      }
      const result = await provisionStaffLogin({
        username: username.trim(),
        password,
        full_name: created.full_name,
        role,
        hospital_id: currentHospital.id,
        mock_hospital_id: currentHospital.id,
        mock_staff_id: created.id,
        accessToken,
      });
      if (!result.ok) {
        deleteStaff(created.id);
        setError(result.error);
        return;
      }
      // Link the mock staff row to its new auth uid so Row-Level-Security
      // recognizes the account as its own (the write syncs via the outbox).
      setStaffUserId(created.id, result.userId);
      onSaved();
    } catch (err) {
      deleteStaff(created.id);
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  }

  return (
    <Sheet
      open={target !== null}
      onOpenChange={(next) => {
        if (!next) onClose();
      }}
    >
      <SheetContent className="flex w-full flex-col gap-0 overflow-y-auto sm:max-w-md">
        <SheetHeader className="border-b border-border">
          <SheetTitle>{isNew ? t("staff.newTitle") : t("staff.editTitle")}</SheetTitle>
          <SheetDescription>
            {isNew ? t("staff.newDesc") : t("staff.editDesc")}
          </SheetDescription>
        </SheetHeader>

        <div className="flex flex-col gap-5 p-4">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="staff_name">{t("staff.name")}</Label>
            <Input
              id="staff_name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder={t("staff.namePlaceholder")}
            />
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="staff_role">{t("staff.role")}</Label>
            <Select
              items={Object.fromEntries(
                ROLE_OPTIONS.map((o) => [o.role, t(o.label)]),
              )}
              value={role}
              onValueChange={(v) => setRole(v as StaffRole)}
            >
              <SelectTrigger id="staff_role">
                <SelectValue placeholder={t("staff.rolePlaceholder")} />
              </SelectTrigger>
              <SelectContent>
                {ROLE_OPTIONS.map((o) => (
                  <SelectItem key={o.role} value={o.role}>
                    {t(o.label)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {isNew ? (
            <>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="staff_username">{t("staff.username")}</Label>
                <Input
                  id="staff_username"
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  placeholder={t("staff.usernamePlaceholder")}
                  autoComplete="off"
                />
              </div>

              <div className="flex flex-col gap-1.5">
                <Label htmlFor="staff_password">{t("staff.password")}</Label>
                <Input
                  id="staff_password"
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder={t("staff.passwordPlaceholder")}
                  autoComplete="new-password"
                />
              </div>
            </>
          ) : null}

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="staff_department">{t("staff.department")}</Label>
            <Select
              items={{
                none: t("staff.departmentNone"),
                ...Object.fromEntries(departmentOptions.map((d) => [d.id, d.name])),
              }}
              value={departmentId}
              onValueChange={(v) => setDepartmentId(v ?? "none")}
            >
              <SelectTrigger id="staff_department">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="none">{t("staff.departmentNone")}</SelectItem>
                {departmentOptions.map((d) => (
                  <SelectItem key={d.id} value={d.id}>
                    {d.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="staff_email">{t("staff.email")}</Label>
            <Input
              id="staff_email"
              type="email"
              inputMode="email"
              autoComplete="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder={t("staff.emailPlaceholder")}
              aria-invalid={emailInvalid || undefined}
              aria-describedby={emailInvalid ? "staff_email-error" : undefined}
            />
            {emailInvalid ? (
              <p
                id="staff_email-error"
                role="alert"
                className="text-xs text-destructive"
              >
                {t("staff.invalidEmail")}
              </p>
            ) : null}
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="staff_phone">{t("staff.phone")}</Label>
            <PhoneInput
              id="staff_phone"
              value={phone}
              onChange={(value) => setPhone(value ?? "")}
              invalid={phoneInvalid}
            />
            {phoneInvalid ? (
              <p
                id="staff_phone-error"
                role="alert"
                className="text-xs text-destructive"
              >
                {t("staff.invalidPhone")}
              </p>
            ) : null}
          </div>

          {error ? <p className="text-sm text-destructive">{error}</p> : null}
        </div>

        <SheetFooter className="mt-auto flex-row justify-end gap-3 border-t border-border">
          <Button variant="ghost" onClick={onClose} disabled={saving}>
            {t("common.cancel")}
          </Button>
          <Button
            onClick={handleSave}
            disabled={saving || emailInvalid || phoneInvalid}
          >
            {saving
              ? isNew
                ? t("staff.creating")
                : t("staff.saving")
              : isNew
                ? t("staff.create")
                : t("common.saveChanges")}
          </Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}
