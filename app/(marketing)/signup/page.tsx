"use client";

/**
 * Hospital signup (`/signup`) — verified-onboarding entry point (Phase 18.5).
 *
 * Identity is verified FIRST: the founding admin continues with Google or an
 * email OTP via {@link OwnerAuth}. Only after a verified session exists do they
 * reach `/onboarding` to enter the hospital details (and the
 * `create_hospital_and_admin` RPC mints the tenant). A founder who already owns
 * a hospital is forwarded straight into the app from `/onboarding`.
 *
 * Staff (doctors/nurses) are still created by an admin from inside the app and
 * sign in with a username + password on `/login`.
 */

import { useEffect } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";

import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { OwnerAuth } from "@/components/auth/owner-auth";
import { useAuth } from "@/components/auth-provider";
import { useT } from "@/components/locale-provider";

export default function SignupPage() {
  const { t } = useT();
  const router = useRouter();
  const { mounted, isAuthenticated, needsOnboarding } = useAuth();

  // Already verified? Skip the verify step. Onboarding routes onward to the
  // dashboard if a hospital already exists.
  useEffect(() => {
    if (!mounted) return;
    if (isAuthenticated) router.replace("/dashboard");
    else if (needsOnboarding) router.replace("/onboarding");
  }, [mounted, isAuthenticated, needsOnboarding, router]);

  return (
    <div className="mx-auto flex w-full max-w-md flex-col px-4 py-12 md:py-16">
      <Card>
        <CardHeader>
          <CardTitle>{t("auth.signup.title")}</CardTitle>
          <CardDescription>{t("auth.signup.subtitle")}</CardDescription>
        </CardHeader>
        <CardContent>
          <OwnerAuth redirectAfter="/onboarding" />

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
