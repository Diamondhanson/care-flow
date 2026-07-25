"use client";

import { useEffect, useState } from "react";
import { KeyRound } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { useT } from "@/components/locale-provider";
import { getSupabaseClient, isSupabaseConfigured } from "@/lib/supabase/client";
import { resetStaffPassword } from "@/app/actions/auth";
import type { Staff } from "@careflow/shared";

/**
 * Admin-only dialog that sets a new login password for a staff member with a
 * provisioned Supabase login (`user_id` present). The privileged update runs in
 * the `resetStaffPassword` server action, which re-verifies the caller from the
 * access token we pass along (the session lives in this tab's localStorage, so
 * the server can't read it on its own).
 */
export function ResetPasswordDialog({
  target,
  onClose,
}: {
  target: Staff | null;
  onClose: () => void;
}) {
  const { t } = useT();
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const [pending, setPending] = useState(false);

  // Reset the dialog state whenever a new target opens it.
  useEffect(() => {
    setPassword("");
    setError(null);
    setDone(false);
    setPending(false);
  }, [target]);

  async function handleReset() {
    if (!target?.user_id) return;
    setError(null);
    if (password.length < 8) {
      setError(t("staff.resetPasswordTooShort"));
      return;
    }
    setPending(true);
    try {
      let accessToken: string | undefined;
      if (isSupabaseConfigured()) {
        const { data } = await getSupabaseClient().auth.getSession();
        accessToken = data.session?.access_token;
      }
      if (!accessToken) {
        setError(t("staff.resetNoSession"));
        return;
      }
      const result = await resetStaffPassword({
        userId: target.user_id,
        password,
        accessToken,
      });
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setDone(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setPending(false);
    }
  }

  return (
    <Dialog
      open={target !== null}
      onOpenChange={(next) => {
        if (!next) onClose();
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t("staff.resetPasswordTitle")}</DialogTitle>
          <DialogDescription>
            {t("staff.resetPasswordDesc", { name: target?.full_name ?? "" })}
          </DialogDescription>
        </DialogHeader>

        {done ? (
          <p
            role="status"
            className="text-sm font-medium text-[var(--status-clearance)]"
          >
            {t("staff.resetPasswordSuccess")}
          </p>
        ) : (
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="staff_new_password">{t("staff.newPassword")}</Label>
            <Input
              id="staff_new_password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder={t("staff.newPasswordPlaceholder")}
              autoComplete="off"
            />
            {error ? (
              <p role="alert" className="text-xs text-destructive">
                {error}
              </p>
            ) : null}
          </div>
        )}

        <DialogFooter>
          {done ? (
            <Button onClick={onClose}>{t("common.close")}</Button>
          ) : (
            <>
              <Button variant="ghost" onClick={onClose} disabled={pending}>
                {t("common.cancel")}
              </Button>
              <Button onClick={handleReset} disabled={pending}>
                <KeyRound className="size-4" />
                {pending ? t("staff.resetting") : t("staff.resetConfirm")}
              </Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
