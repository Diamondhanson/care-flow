"use client";

/**
 * Hospital signup (`/signup`). Creates a hospital and its founder admin in one
 * step via {@link useAuth().signUp} (mock {@link signUpHospital}), signs the
 * admin in, and lands them on the dashboard. Real auth arrives in Phase 18.
 */

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { useAuth } from "@/components/auth-provider";
import { useT } from "@/components/locale-provider";

export default function SignupPage() {
  const { t } = useT();
  const router = useRouter();
  const { signUp } = useAuth();

  const [hospitalName, setHospitalName] = useState("");
  const [region, setRegion] = useState("");
  const [contactEmail, setContactEmail] = useState("");
  const [contactPhone, setContactPhone] = useState("");
  const [adminName, setAdminName] = useState("");
  const [adminEmail, setAdminEmail] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const canSubmit = hospitalName.trim() !== "" && adminName.trim() !== "";

  function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    if (!canSubmit || submitting) return;
    setSubmitting(true);
    try {
      signUp({
        name: hospitalName.trim(),
        region: region.trim() || undefined,
        contact_email: contactEmail.trim() || undefined,
        contact_phone: contactPhone.trim() || undefined,
        admin_full_name: adminName.trim(),
        admin_email: adminEmail.trim() || null,
      });
      router.push("/dashboard");
    } catch {
      setSubmitting(false);
    }
  }

  return (
    <div className="mx-auto flex w-full max-w-lg flex-col px-4 py-12 md:py-16">
      <Card>
        <CardHeader>
          <CardTitle>{t("auth.signup.title")}</CardTitle>
          <CardDescription>{t("auth.signup.subtitle")}</CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="space-y-6">
            {/* Hospital */}
            <fieldset className="space-y-4">
              <legend className="text-xs font-semibold uppercase tracking-[0.1em] text-muted-foreground">
                {t("auth.signup.sectionHospital")}
              </legend>
              <div className="space-y-2">
                <Label htmlFor="hospitalName">
                  {t("auth.signup.hospitalName")}
                </Label>
                <Input
                  id="hospitalName"
                  value={hospitalName}
                  onChange={(e) => setHospitalName(e.target.value)}
                  placeholder={t("auth.signup.hospitalNamePlaceholder")}
                  required
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="region">{t("auth.signup.region")}</Label>
                <Input
                  id="region"
                  value={region}
                  onChange={(e) => setRegion(e.target.value)}
                  placeholder={t("auth.signup.regionPlaceholder")}
                />
              </div>
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-2">
                  <Label htmlFor="contactEmail">
                    {t("auth.signup.contactEmail")}
                  </Label>
                  <Input
                    id="contactEmail"
                    type="email"
                    value={contactEmail}
                    onChange={(e) => setContactEmail(e.target.value)}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="contactPhone">
                    {t("auth.signup.contactPhone")}
                  </Label>
                  <Input
                    id="contactPhone"
                    type="tel"
                    value={contactPhone}
                    onChange={(e) => setContactPhone(e.target.value)}
                  />
                </div>
              </div>
            </fieldset>

            {/* Admin */}
            <fieldset className="space-y-4">
              <legend className="text-xs font-semibold uppercase tracking-[0.1em] text-muted-foreground">
                {t("auth.signup.sectionAdmin")}
              </legend>
              <div className="space-y-2">
                <Label htmlFor="adminName">{t("auth.signup.adminName")}</Label>
                <Input
                  id="adminName"
                  value={adminName}
                  onChange={(e) => setAdminName(e.target.value)}
                  placeholder={t("auth.signup.adminNamePlaceholder")}
                  required
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="adminEmail">{t("auth.signup.adminEmail")}</Label>
                <Input
                  id="adminEmail"
                  type="email"
                  value={adminEmail}
                  onChange={(e) => setAdminEmail(e.target.value)}
                />
              </div>
            </fieldset>

            <Button
              type="submit"
              className="w-full"
              disabled={!canSubmit || submitting}
            >
              {submitting
                ? t("auth.signup.creating")
                : t("auth.signup.submit")}
            </Button>
          </form>

          <p className="mt-6 text-center text-sm text-muted-foreground">
            {t("auth.signup.haveAccount")}{" "}
            <Link
              href="/login"
              className="font-medium text-primary underline-offset-4 hover:underline"
            >
              {t("auth.signup.loginLink")}
            </Link>
          </p>

          <p className="mt-4 rounded-lg bg-muted/50 p-3 text-xs text-muted-foreground">
            {t("auth.signup.trialNote")}
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
