"use client";

import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Field } from "@/components/intake/field";
import { useT } from "@/components/locale-provider";
import type { Department, Staff, TriageLevel } from "@/types/healthcare";

/** Visit fields — reason, triage, routing, and staff assignments. */
export function VisitDetailsCard({
  reason,
  setReason,
  triageLevel,
  setTriageLevel,
  departments,
  departmentId,
  setDepartmentId,
  staff,
  registeredById,
  setRegisteredById,
  attendingId,
  setAttendingId,
}: {
  reason: string;
  setReason: (v: string) => void;
  triageLevel: "" | `${TriageLevel}`;
  setTriageLevel: (v: "" | `${TriageLevel}`) => void;
  departments: Department[];
  departmentId: string;
  setDepartmentId: (v: string) => void;
  staff: Staff[];
  registeredById: string;
  setRegisteredById: (v: string) => void;
  attendingId: string;
  setAttendingId: (v: string) => void;
}) {
  const { t } = useT();

  const doctors = staff.filter((s) => s.role === "doctor");
  const deptName = (id: string | null) =>
    id ? (departments.find((d) => d.id === id)?.name ?? "—") : "—";

  return (
    <Card>
      <CardHeader className="pb-0">
        <span className="text-[11px] font-semibold uppercase tracking-[0.1em] text-muted-foreground">
          {t("intake.visit")}
        </span>
      </CardHeader>
      <CardContent className="flex flex-col gap-5">
        <Field label={t("intake.reason")} htmlFor="reason">
          <Textarea
            id="reason"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder={t("intake.reasonPlaceholder")}
          />
        </Field>
        <div className="grid gap-5 sm:grid-cols-2">
          <Field
            label={t("intake.triage")}
            htmlFor="triage"
            className="sm:col-span-2"
          >
            <Select
              items={{
                "": t("intake.triageNone"),
                ...Object.fromEntries(
                  ([1, 2, 3, 4, 5] as const).map((n) => [
                    String(n),
                    `${t("liveBoard.triage.label", { level: String(n) })} · ${t(`liveBoard.triage.${n}`)}`,
                  ]),
                ),
              }}
              value={triageLevel}
              onValueChange={(v) => setTriageLevel(v as "" | `${TriageLevel}`)}
            >
              <SelectTrigger id="triage" className="w-full">
                <SelectValue placeholder={t("intake.triageNone")} />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="">{t("intake.triageNone")}</SelectItem>
                {([1, 2, 3, 4, 5] as const).map((n) => (
                  <SelectItem key={n} value={String(n)}>
                    <span className="inline-flex items-center gap-2">
                      <span
                        aria-hidden
                        className="size-2 rounded-full"
                        style={{ backgroundColor: `var(--triage-${n})` }}
                      />
                      {t("liveBoard.triage.label", { level: String(n) })} ·{" "}
                      {t(`liveBoard.triage.${n}`)}
                    </span>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
          <Field label={t("intake.department")} htmlFor="department">
            <Select
              items={Object.fromEntries(
                departments.map((d) => [d.id, d.name]),
              )}
              value={departmentId}
              onValueChange={(v) => setDepartmentId(v as string)}
            >
              <SelectTrigger id="department" className="w-full">
                <SelectValue placeholder={t("intake.selectDepartment")} />
              </SelectTrigger>
              <SelectContent>
                {departments.map((d) => (
                  <SelectItem key={d.id} value={d.id}>
                    {d.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
          <Field label={t("intake.registeringStaff")} htmlFor="registered_by">
            <Select
              items={Object.fromEntries(
                staff.map((s) => [s.id, `${s.full_name} · ${s.role}`]),
              )}
              value={registeredById}
              onValueChange={(v) => setRegisteredById(v as string)}
            >
              <SelectTrigger id="registered_by" className="w-full">
                <SelectValue placeholder={t("intake.selectStaff")} />
              </SelectTrigger>
              <SelectContent>
                {staff.map((s) => (
                  <SelectItem key={s.id} value={s.id}>
                    {s.full_name} · {s.role}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
          <Field
            label={t("intake.attendingDoctor")}
            htmlFor="attending"
            className="sm:col-span-2"
          >
            <Select
              items={Object.fromEntries(
                doctors.map((s) => [s.id, `${s.full_name} · ${deptName(s.department_id)}`]),
              )}
              value={attendingId}
              onValueChange={(v) => setAttendingId(v as string)}
            >
              <SelectTrigger id="attending" className="w-full">
                <SelectValue placeholder={t("intake.unassigned")} />
              </SelectTrigger>
              <SelectContent>
                {doctors.map((s) => (
                  <SelectItem key={s.id} value={s.id}>
                    {s.full_name} · {deptName(s.department_id)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
        </div>
      </CardContent>
    </Card>
  );
}
