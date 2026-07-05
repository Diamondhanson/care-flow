"use client";

/**
 * Sign-in (`/login`). Real Supabase Auth (Phase 18a): staff authenticate with a
 * username + password. On success the AuthProvider bridges the session to the
 * (still-mock) data layer and we land on the dashboard.
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
import { OwnerAuth } from "@/components/auth/owner-auth";
import { useAuth } from "@/components/auth-provider";
import { useT } from "@/components/locale-provider";

export default function LoginPage() {
  const { t } = useT();
  const router = useRouter();
  const { signIn } = useAuth();

  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const canSubmit = username.trim() !== "" && password !== "";

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    if (!canSubmit || submitting) return;
    setSubmitting(true);
    setError(null);
    try {
      await signIn(username.trim(), password);
      router.push("/dashboard");
    } catch {
      setError(t("auth.login.error"));
      setSubmitting(false);
    }
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
              <Label htmlFor="username">{t("auth.login.usernameLabel")}</Label>
              <Input
                id="username"
                autoComplete="username"
                autoCapitalize="none"
                spellCheck={false}
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                placeholder={t("auth.login.usernamePlaceholder")}
                required
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="password">{t("auth.login.passwordLabel")}</Label>
              <Input
                id="password"
                type="password"
                autoComplete="current-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder={t("auth.login.passwordPlaceholder")}
                required
              />
            </div>

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
              {submitting ? t("auth.login.signingIn") : t("auth.login.submit")}
            </Button>
          </form>

          <div className="mt-8">
            <div className="mb-4 flex items-center gap-3">
              <span className="h-px flex-1 bg-border" />
              <span className="text-xs uppercase tracking-[0.1em] text-muted-foreground">
                {t("auth.login.ownerDivider")}
              </span>
              <span className="h-px flex-1 bg-border" />
            </div>
            <p className="mb-4 text-xs text-muted-foreground">
              {t("auth.login.ownerHint")}
            </p>
            <OwnerAuth redirectAfter="/onboarding" />
          </div>

          <p className="mt-6 text-center text-sm text-muted-foreground">
            {t("auth.login.noAccount")}{" "}
            <Link
              href="/signup"
              className="font-medium text-primary underline-offset-4 hover:underline"
            >
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
