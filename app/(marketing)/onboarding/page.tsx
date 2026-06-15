"use client";

/**
 * Hospital onboarding (`/onboarding`) — the create-hospital step that follows
 * identity verification (Phase 18.5).
 *
 * Reached only by a VERIFIED user who has no hospital yet (`needsOnboarding`).
 * Guards:
 *   - not verified  → bounce to `/signup`;
 *   - already owns a hospital → forward to `/dashboard` (one hospital per owner);
 *   - verified, no hospital → show the form.
 *
 * On submit, {@link useAuth().createHospital} calls the `create_hospital_and_admin`
 * RPC (creating the `hospitals` row + the founder admin `staff` row linked to the
 * verified auth user), then resolves the session into a fully-authenticated state
 * and we land on the dashboard.
 */

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Activity } from "lucide-react";
import { isValidPhoneNumber } from "react-phone-number-input";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { PhoneInput } from "@/components/ui/phone-input";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { useAuth } from "@/components/auth-provider";
import { useT } from "@/components/locale-provider";

function Splash() {
  return (
    <div className="flex h-svh items-center justify-center bg-background text-foreground">
      <span className="flex size-11 animate-pulse items-center justify-center rounded-md bg-primary text-primary-foreground shadow-sm">
        <Activity className="size-6" strokeWidth={2.25} />
      </span>
      <span className="sr-only">Loading</span>
    </div>
  );
}

export default function OnboardingPage() {
  const { t } = useT();
  const router = useRouter();
  const {
    mounted,
    isAuthenticated,
    needsOnboarding,
    authUser,
    createHospital,
    signOut,
  } = useAuth();

  const [hospitalName, setHospitalName] = useState("");
  const [region, setRegion] = useState("");
  const [contactEmail, setContactEmail] = useState("");
  const [contactPhone, setContactPhone] = useState("");
  const [adminName, setAdminName] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Route guards.
  useEffect(() => {
    if (!mounted) return;
    if (isAuthenticated) router.replace("/dashboard");
    else if (!needsOnboarding) router.replace("/signup");
  }, [mounted, isAuthenticated, needsOnboarding, router]);

  if (!mounted || !needsOnboarding) {
    return <Splash />;
  }

  // Contact email/phone are optional, but if the user types something it must
  // be well-formed. Email: standard address shape. Phone: valid for the
  // country selected in the rich phone input (E.164 from libphonenumber).
  const emailInvalid =
    contactEmail.trim() !== "" &&
    !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(contactEmail.trim());
  const phoneInvalid = contactPhone !== "" && !isValidPhoneNumber(contactPhone);

  const canSubmit =
    hospitalName.trim() !== "" && !emailInvalid && !phoneInvalid;

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    if (!canSubmit || submitting) return;
    setSubmitting(true);
    setError(null);
    try {
      await createHospital({
        name: hospitalName.trim(),
        region: region.trim() || null,
        contact_email: contactEmail.trim() || authUser?.email || null,
        contact_phone: contactPhone.trim() || null,
        admin_full_name: adminName.trim() || null,
      });
      router.replace("/dashboard");
    } catch (e) {
      setError(e instanceof Error ? e.message : t("auth.onboarding.error"));
      setSubmitting(false);
    }
  }

  return (
    <div className="mx-auto flex w-full max-w-lg flex-col px-4 py-12 md:py-16 lg:max-w-2xl">
      <Card>
        <CardHeader>
          <CardTitle>{t("auth.onboarding.title")}</CardTitle>
          <CardDescription>{t("auth.onboarding.subtitle")}</CardDescription>
        </CardHeader>
        <CardContent>
          {authUser?.email ? (
            <p className="mb-6 rounded-lg bg-muted/50 px-3 py-2 text-xs text-muted-foreground">
              {t("auth.onboarding.verifiedAs", { email: authUser.email })}
            </p>
          ) : null}

          <form onSubmit={handleSubmit} className="space-y-6">
            <fieldset className="space-y-4">
              <legend className="text-xs font-semibold uppercase tracking-[0.1em] text-muted-foreground">
                {t("auth.onboarding.sectionHospital")}
              </legend>
              <div className="space-y-2">
                <Label htmlFor="hospitalName">
                  {t("auth.onboarding.hospitalName")}
                </Label>
                <Input
                  id="hospitalName"
                  value={hospitalName}
                  onChange={(e) => setHospitalName(e.target.value)}
                  placeholder={t("auth.onboarding.hospitalNamePlaceholder")}
                  required
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="adminName">
                  {t("auth.onboarding.adminName")}
                </Label>
                <Input
                  id="adminName"
                  value={adminName}
                  onChange={(e) => setAdminName(e.target.value)}
                  placeholder={t("auth.onboarding.adminNamePlaceholder")}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="region">{t("auth.onboarding.region")}</Label>
                <Input
                  id="region"
                  value={region}
                  onChange={(e) => setRegion(e.target.value)}
                  placeholder={t("auth.onboarding.regionPlaceholder")}
                />
              </div>
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-2">
                  <Label htmlFor="contactEmail">
                    {t("auth.onboarding.contactEmail")}
                  </Label>
                  <Input
                    id="contactEmail"
                    type="email"
                    inputMode="email"
                    autoComplete="email"
                    value={contactEmail}
                    onChange={(e) => setContactEmail(e.target.value)}
                    aria-invalid={emailInvalid || undefined}
                    aria-describedby={
                      emailInvalid ? "contactEmail-error" : undefined
                    }
                  />
                  {emailInvalid ? (
                    <p
                      id="contactEmail-error"
                      role="alert"
                      className="text-xs text-destructive"
                    >
                      {t("auth.onboarding.invalidEmail")}
                    </p>
                  ) : null}
                </div>
                <div className="space-y-2">
                  <Label htmlFor="contactPhone">
                    {t("auth.onboarding.contactPhone")}
                  </Label>
                  <PhoneInput
                    id="contactPhone"
                    value={contactPhone}
                    onChange={(value) => setContactPhone(value ?? "")}
                    invalid={phoneInvalid}
                  />
                  {phoneInvalid ? (
                    <p
                      id="contactPhone-error"
                      role="alert"
                      className="text-xs text-destructive"
                    >
                      {t("auth.onboarding.invalidPhone")}
                    </p>
                  ) : null}
                </div>
              </div>
            </fieldset>

            {error ? (
              <p
                role="alert"
                className="rounded-lg bg-destructive/10 p-3 text-sm text-destructive"
              >
                {error}
              </p>
            ) : null}

            <Button
              type="submit"
              className="w-full"
              disabled={!canSubmit || submitting}
            >
              {submitting
                ? t("auth.onboarding.creating")
                : t("auth.onboarding.submit")}
            </Button>
          </form>

          <p className="mt-6 text-center text-sm">
            <button
              type="button"
              className="text-muted-foreground underline-offset-4 hover:underline"
              onClick={() => void signOut().then(() => router.replace("/login"))}
            >
              {t("auth.onboarding.signOut")}
            </button>
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
