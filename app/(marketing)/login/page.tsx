"use client";

/**
 * Mock sign-in (`/login`). The real password flow arrives with the Supabase
 * cutover (Phase 18); for now we model the session by picking a hospital and
 * then a staff account to sign in as. On success we redirect to the dashboard.
 */

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";

import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { useAuth } from "@/components/auth-provider";
import { useT } from "@/components/locale-provider";
import { getHospitals, getStaffForHospital } from "@/services/mockStorage";
import { ROLE_LABEL } from "@/components/role-provider";
import type { Hospital, Staff, StaffId, HospitalId } from "@/types/healthcare";

export default function LoginPage() {
  const { t } = useT();
  const router = useRouter();
  const { signIn } = useAuth();

  const [hospitals, setHospitals] = useState<Hospital[]>([]);
  const [hospitalId, setHospitalId] = useState<HospitalId | "">("");
  const [staffId, setStaffId] = useState<StaffId | "">("");

  // Reads hit localStorage, so load after mount (client-only).
  useEffect(() => {
    setHospitals(getHospitals());
  }, []);

  const staff = useMemo<Staff[]>(
    () => (hospitalId ? getStaffForHospital(hospitalId as HospitalId) : []),
    [hospitalId]
  );

  function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    if (!staffId) return;
    signIn(staffId as StaffId);
    router.push("/dashboard");
  }

  return (
    <div className="mx-auto flex w-full max-w-md flex-col px-4 py-12 md:py-20">
      <Card>
        <CardHeader>
          <CardTitle>{t("auth.login.title")}</CardTitle>
          <CardDescription>{t("auth.login.subtitle")}</CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="space-y-5">
            <div className="space-y-2">
              <Label htmlFor="hospital">{t("auth.login.hospitalLabel")}</Label>
              <Select
                value={hospitalId}
                onValueChange={(v) => {
                  setHospitalId(v as HospitalId);
                  setStaffId("");
                }}
              >
                <SelectTrigger id="hospital" className="w-full">
                  <SelectValue
                    placeholder={t("auth.login.hospitalPlaceholder")}
                  />
                </SelectTrigger>
                <SelectContent>
                  {hospitals.map((h) => (
                    <SelectItem key={h.id} value={h.id}>
                      {h.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label htmlFor="staff">{t("auth.login.staffLabel")}</Label>
              <Select
                value={staffId}
                onValueChange={(v) => setStaffId(v as StaffId)}
                disabled={!hospitalId || staff.length === 0}
              >
                <SelectTrigger id="staff" className="w-full">
                  <SelectValue placeholder={t("auth.login.staffPlaceholder")} />
                </SelectTrigger>
                <SelectContent>
                  {staff.map((s) => (
                    <SelectItem key={s.id} value={s.id}>
                      {s.full_name} · {t(ROLE_LABEL[s.role])}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {hospitalId && staff.length === 0 ? (
                <p className="text-xs text-muted-foreground">
                  {t("auth.login.noStaff")}
                </p>
              ) : null}
            </div>

            <Button type="submit" className="w-full" disabled={!staffId}>
              {t("auth.login.submit")}
            </Button>
          </form>

          <p className="mt-6 text-center text-sm text-muted-foreground">
            {t("auth.login.noAccount")}{" "}
            <Link href="/signup" className="font-medium text-primary underline-offset-4 hover:underline">
              {t("auth.login.signUpLink")}
            </Link>
          </p>

          <p className="mt-4 rounded-lg bg-muted/50 p-3 text-xs text-muted-foreground">
            {t("auth.login.demoHint")}
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
