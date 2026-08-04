"use client";

import { useEffect, useState } from "react";
import { BellRing } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import { useT } from "@/components/locale-provider";
import { useAuth } from "@/components/auth-provider";
import { getSupabaseClient } from "@/lib/supabase/client";
import { notify } from "@/lib/notify";
import {
  setNotificationPrefs,
  type NotificationPrefs,
} from "@/services/notification-prefs";
import type { NotificationType } from "@careflow/shared";

/**
 * Hospital-wide configuration, admin-only. Unlike clinical data this does NOT
 * ride the offline outbox: the settings drive server-side jobs (the pg_cron
 * medication passes) and the producer gate, so a change only means anything
 * once the server has it — we read and write `hospital_settings` directly
 * over Supabase.
 */

const LEAD_OPTIONS = [2, 5, 10, 15, 30] as const;
const ESCALATION_OPTIONS = [15, 30, 45, 60, 120] as const;

/** The client-generated event types an admin can silence hospital-wide. */
const EVENT_TYPES = [
  { type: "consultation.created", labelKey: "settings.events.consultationCreated" },
  { type: "order.created", labelKey: "settings.events.orderCreated" },
  { type: "result.recorded", labelKey: "settings.events.resultRecorded" },
  { type: "prescription.created", labelKey: "settings.events.prescriptionCreated" },
  { type: "vitals.recorded", labelKey: "settings.events.vitalsRecorded" },
  { type: "mar.exception", labelKey: "settings.events.marException" },
  { type: "careplan.escalation", labelKey: "settings.events.careplanEscalation" },
  { type: "careplan.acknowledged", labelKey: "settings.events.careplanAcknowledged" },
  { type: "visit.registered", labelKey: "settings.events.visitRegistered" },
  { type: "admission.created", labelKey: "settings.events.admissionCreated" },
  { type: "transfer.recorded", labelKey: "settings.events.transferRecorded" },
] as const satisfies readonly { type: NotificationType; labelKey: string }[];

interface HospitalSettings {
  med_reminders_enabled: boolean;
  med_reminder_lead_minutes: number;
  med_escalation_enabled: boolean;
  med_escalation_after_minutes: number;
  notification_prefs: NotificationPrefs;
}

const DEFAULTS: HospitalSettings = {
  med_reminders_enabled: true,
  med_reminder_lead_minutes: 5,
  med_escalation_enabled: true,
  med_escalation_after_minutes: 30,
  notification_prefs: {},
};

export default function SettingsPage() {
  const { t } = useT();
  const { currentStaff } = useAuth();
  const [settings, setSettings] = useState<HospitalSettings | null>(null);
  const [loadFailed, setLoadFailed] = useState(false);
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);

  const isAdmin = currentStaff?.role === "admin";
  const hospitalId = currentStaff?.hospital_id ?? null;

  useEffect(() => {
    if (!isAdmin || !hospitalId) return;
    let cancelled = false;
    (async () => {
      try {
        const { data, error } = await getSupabaseClient()
          .from("hospital_settings")
          .select(
            "med_reminders_enabled, med_reminder_lead_minutes, med_escalation_enabled, med_escalation_after_minutes, notification_prefs",
          )
          .eq("hospital_id", hospitalId)
          .maybeSingle();
        if (error) throw error;
        if (!cancelled) {
          setSettings(
            data
              ? { ...DEFAULTS, ...data, notification_prefs: data.notification_prefs ?? {} }
              : DEFAULTS,
          );
        }
      } catch {
        if (!cancelled) setLoadFailed(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [isAdmin, hospitalId]);

  function update(patch: Partial<HospitalSettings>) {
    setSettings((s) => (s ? { ...s, ...patch } : s));
    setDirty(true);
  }

  function setEventEnabled(type: NotificationType, enabled: boolean) {
    setSettings((s) => {
      if (!s) return s;
      const prefs = { ...s.notification_prefs };
      // Missing key = enabled; only store the mutes.
      if (enabled) delete prefs[type];
      else prefs[type] = false;
      return { ...s, notification_prefs: prefs };
    });
    setDirty(true);
  }

  async function save() {
    if (!settings || !hospitalId) return;
    setSaving(true);
    try {
      const { error } = await getSupabaseClient()
        .from("hospital_settings")
        .upsert({ hospital_id: hospitalId, ...settings });
      if (error) throw error;
      // This device's producer gate applies the new rules immediately.
      setNotificationPrefs(settings.notification_prefs);
      setDirty(false);
      notify({
        kind: "success",
        titleKey: "settings.saved",
        bodyKey: "settings.savedBody",
      });
    } catch {
      notify({
        kind: "error",
        titleKey: "settings.saveFailed",
        bodyKey: "settings.saveFailedBody",
      });
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-8">
      <header className="flex flex-col gap-1">
        <h1 className="text-2xl font-semibold tracking-tight">
          {t("settings.title")}
        </h1>
        <p className="text-sm text-muted-foreground">{t("settings.subtitle")}</p>
      </header>

      {!isAdmin ? (
        <p className="text-sm text-muted-foreground">{t("settings.adminOnly")}</p>
      ) : loadFailed ? (
        <p className="text-sm text-muted-foreground">{t("settings.loadFailed")}</p>
      ) : settings === null ? (
        <p className="text-sm text-muted-foreground">{t("settings.loading")}</p>
      ) : (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <BellRing aria-hidden className="size-4 text-muted-foreground" />
              {t("settings.notifTitle")}
            </CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-6">
            <div className="flex items-start justify-between gap-6">
              <div className="flex flex-col gap-1">
                <Label htmlFor="med-reminders">
                  {t("settings.medRemindersLabel")}
                </Label>
                <p className="text-sm text-muted-foreground">
                  {t("settings.medRemindersHint")}
                </p>
              </div>
              <Switch
                id="med-reminders"
                checked={settings.med_reminders_enabled}
                onCheckedChange={(checked) =>
                  update({ med_reminders_enabled: checked })
                }
              />
            </div>

            {settings.med_reminders_enabled ? (
              <div className="flex items-start justify-between gap-6">
                <div className="flex flex-col gap-1">
                  <Label htmlFor="med-reminder-lead">
                    {t("settings.leadLabel")}
                  </Label>
                  <p className="text-sm text-muted-foreground">
                    {t("settings.leadHint")}
                  </p>
                </div>
                <Select
                  value={String(settings.med_reminder_lead_minutes)}
                  onValueChange={(v) =>
                    update({ med_reminder_lead_minutes: Number(v) })
                  }
                >
                  <SelectTrigger id="med-reminder-lead" className="w-48 shrink-0">
                    {/* Explicit children: the closed trigger must show the full
                        label even before the (portalled) items ever mount. */}
                    <SelectValue>
                      {t("settings.leadOption", {
                        count: settings.med_reminder_lead_minutes,
                      })}
                    </SelectValue>
                  </SelectTrigger>
                  <SelectContent>
                    {LEAD_OPTIONS.map((min) => (
                      <SelectItem key={min} value={String(min)}>
                        {t("settings.leadOption", { count: min })}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            ) : null}

            <Separator />

            <div className="flex items-start justify-between gap-6">
              <div className="flex flex-col gap-1">
                <Label htmlFor="med-escalation">
                  {t("settings.escalationLabel")}
                </Label>
                <p className="text-sm text-muted-foreground">
                  {t("settings.escalationHint")}
                </p>
              </div>
              <Switch
                id="med-escalation"
                checked={settings.med_escalation_enabled}
                onCheckedChange={(checked) =>
                  update({ med_escalation_enabled: checked })
                }
              />
            </div>

            {settings.med_escalation_enabled ? (
              <div className="flex items-start justify-between gap-6">
                <div className="flex flex-col gap-1">
                  <Label htmlFor="med-escalation-after">
                    {t("settings.escalationAfterLabel")}
                  </Label>
                  <p className="text-sm text-muted-foreground">
                    {t("settings.escalationAfterHint")}
                  </p>
                </div>
                <Select
                  value={String(settings.med_escalation_after_minutes)}
                  onValueChange={(v) =>
                    update({ med_escalation_after_minutes: Number(v) })
                  }
                >
                  <SelectTrigger
                    id="med-escalation-after"
                    className="w-48 shrink-0"
                  >
                    <SelectValue>
                      {t("settings.escalationOption", {
                        count: settings.med_escalation_after_minutes,
                      })}
                    </SelectValue>
                  </SelectTrigger>
                  <SelectContent>
                    {ESCALATION_OPTIONS.map((min) => (
                      <SelectItem key={min} value={String(min)}>
                        {t("settings.escalationOption", { count: min })}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            ) : null}

            <Separator />

            <div className="flex flex-col gap-1">
              <p className="text-sm font-medium">{t("settings.eventsTitle")}</p>
              <p className="text-sm text-muted-foreground">
                {t("settings.eventsHint")}
              </p>
            </div>
            <div className="flex flex-col gap-3">
              {EVENT_TYPES.map(({ type, labelKey }) => (
                <div
                  key={type}
                  className="flex items-center justify-between gap-6"
                >
                  <Label htmlFor={`evt-${type}`} className="font-normal">
                    {t(labelKey)}
                  </Label>
                  <Switch
                    id={`evt-${type}`}
                    checked={settings.notification_prefs[type] !== false}
                    onCheckedChange={(checked) => setEventEnabled(type, checked)}
                  />
                </div>
              ))}
            </div>

            <div className="flex justify-end border-t border-border pt-4">
              <Button onClick={save} disabled={!dirty || saving}>
                {saving ? t("settings.saving") : t("settings.save")}
              </Button>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
