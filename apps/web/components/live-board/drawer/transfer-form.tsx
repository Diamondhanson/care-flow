"use client";

import { useState } from "react";
import type * as React from "react";
import { ArrowLeftRight, CheckCircle2 } from "lucide-react";

import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { getStaff, transferAdmission } from "@/services/mockStorage";
import { useT, useLocale } from "@/components/locale-provider";
import { formatDateTime } from "@/i18n/format";
import { useFormReset } from "@/components/live-board/drawer/use-drawer-data";
import type { Admission, Bed, BedId, StaffId, Transfer, Ward } from "@careflow/shared";

const NO_BED = "__none__";
const NO_DOCTOR = "__none__";

/**
 * Placement & transfers for inpatient admissions: current ward/bed summary,
 * bed + attending-doctor reassignment, and the transfer history list.
 *
 * The bed/doctor/reason drafts reset on every data refresh (`resetKey`); the
 * plain-language "Moved to …" confirmation deliberately survives refreshes —
 * it is tied to the open patient, so the orchestrator remounts this component
 * (via `key`) when the visit changes.
 */
export function TransferForm({
  admission,
  transfers,
  wards,
  beds,
  recorderId,
  resetKey,
  onMutated,
  className,
  style,
}: {
  admission: Admission;
  transfers: Transfer[];
  wards: Ward[];
  beds: Bed[];
  recorderId: StaffId | null;
  resetKey: string;
  onMutated: () => void;
  className?: string;
  style?: React.CSSProperties;
}) {
  const { t } = useT();
  const { mounted, locale } = useLocale();
  const activeLocale = mounted ? locale : "en";

  const [transferBedId, setTransferBedId] = useState<string>(
    admission.bed_id ?? NO_BED,
  );
  const [transferDoctorId, setTransferDoctorId] = useState<string>(
    admission.attending_doctor_id ?? NO_DOCTOR,
  );
  const [transferReason, setTransferReason] = useState("");
  const [transferError, setTransferError] = useState<string | null>(null);
  // Plain-language confirmation of the last completed move ("Moved to … · …").
  // Not reset on `resetKey` — clearing it on every refresh would wipe the
  // confirmation the instant a transfer's own refresh fires.
  const [transferDone, setTransferDone] = useState<string | null>(null);

  // Re-sync the selects with the (possibly refreshed) admission and clear the
  // reason/error on drawer open / after any mutation.
  useFormReset(resetKey, () => {
    setTransferBedId(admission.bed_id ?? NO_BED);
    setTransferDoctorId(admission.attending_doctor_id ?? NO_DOCTOR);
    setTransferReason("");
    setTransferError(null);
  });

  // Placement & transfers — lookup maps + selectable options.
  const wardById = new Map(wards.map((w) => [w.id, w]));
  const bedById = new Map(beds.map((b) => [b.id, b]));
  const doctors = getStaff().filter((s) => s.role === "doctor" && s.is_active);
  const staffById = new Map(getStaff().map((s) => [s.id, s]));
  const assignableBeds = beds
    .filter((b) => b.status === "free" || b.id === admission.bed_id)
    .map((b) => ({
      bed: b,
      label: `${wardById.get(b.ward_id)?.name ?? t("drawer.ward")} · ${b.label}`,
    }))
    .sort((a, b) => a.label.localeCompare(b.label, undefined, { numeric: true }));
  const hasBed = Boolean(admission.bed_id);

  // Accepts both branded ids (transfer rows) and raw select strings.
  function bedLabel(id: string | null): string {
    if (!id) return "—";
    const b = bedById.get(id as BedId);
    if (!b) return "—";
    return `${wardById.get(b.ward_id)?.name ?? t("drawer.ward")} · ${b.label}`;
  }
  function staffName(id: string | null): string {
    return id ? (staffById.get(id as StaffId)?.full_name ?? "—") : "—";
  }

  function handleTransfer() {
    setTransferError(null);
    const currentBed = admission.bed_id ?? NO_BED;
    const currentDoctor = admission.attending_doctor_id ?? NO_DOCTOR;
    const bedChanged = transferBedId !== currentBed;
    const doctorChanged = transferDoctorId !== currentDoctor;
    if (!bedChanged && !doctorChanged) {
      setTransferError(t("drawer.transferNoChange"));
      return;
    }
    try {
      transferAdmission(admission.id, {
        // Select values are raw DOM strings; brand them at this boundary.
        ...(bedChanged
          ? { to_bed_id: transferBedId === NO_BED ? null : (transferBedId as BedId) }
          : {}),
        ...(doctorChanged
          ? {
              to_doctor_id:
                transferDoctorId === NO_DOCTOR ? null : (transferDoctorId as StaffId),
            }
          : {}),
        reason: transferReason,
        transferred_by_id: recorderId,
      });
      // Plain-language confirmation that names the new placement / doctor.
      const parts: string[] = [];
      if (bedChanged) {
        parts.push(
          transferBedId === NO_BED
            ? t("drawer.transferDoneNoBed")
            : t("drawer.transferDoneBed", {
                placement: bedLabel(transferBedId),
              }),
        );
      }
      if (doctorChanged) {
        parts.push(
          transferDoctorId === NO_DOCTOR
            ? t("drawer.transferDoneNoDoctor")
            : t("drawer.transferDoneDoctor", {
                doctor: staffName(transferDoctorId),
              }),
        );
      }
      setTransferDone(parts.join(" "));
      setTransferReason("");
      onMutated();
    } catch (e) {
      setTransferError(
        e instanceof Error ? e.message : t("drawer.transferFailed"),
      );
    }
  }

  return (
    <section className={className} style={style}>
      <div className="flex items-center gap-2">
        <ArrowLeftRight className="size-4 text-muted-foreground" />
        <h3 className="text-[11px] font-semibold uppercase tracking-[0.1em] text-muted-foreground">
          {t("drawer.placementTransfers")}
        </h3>
      </div>

      <div className="grid grid-cols-2 gap-2 rounded-md border border-border px-3 py-2.5 text-sm">
        <div className="flex flex-col">
          <span className="text-[11px] uppercase tracking-wide text-muted-foreground">
            {t("drawer.ward")}
          </span>
          <span>
            {admission.ward_id
              ? (wardById.get(admission.ward_id)?.name ?? "—")
              : "—"}
          </span>
        </div>
        <div className="flex flex-col">
          <span className="text-[11px] uppercase tracking-wide text-muted-foreground">
            {t("drawer.bed")}
          </span>
          <span className="font-mono">
            {admission.bed_id
              ? (bedById.get(admission.bed_id)?.label ?? "—")
              : t("drawer.unassigned")}
          </span>
        </div>
      </div>

      <div className="flex flex-col gap-1.5">
        <Label htmlFor="transfer-bed" className="text-xs">
          {t("drawer.bed")}
        </Label>
        <Select
          items={{
            [NO_BED]: t("drawer.noBed"),
            ...Object.fromEntries(
              assignableBeds.map((o) => [o.bed.id, o.label]),
            ),
          }}
          value={transferBedId}
          onValueChange={(v) => setTransferBedId(v as string)}
        >
          <SelectTrigger id="transfer-bed" className="w-full">
            <SelectValue placeholder={t("drawer.selectBed")} />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={NO_BED}>{t("drawer.noBed")}</SelectItem>
            {assignableBeds.map((o) => (
              <SelectItem key={o.bed.id} value={o.bed.id}>
                {o.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="flex flex-col gap-1.5">
        <Label htmlFor="transfer-doctor" className="text-xs">
          {t("drawer.attendingDoctor")}
        </Label>
        <Select
          items={{
            [NO_DOCTOR]: t("drawer.unassigned"),
            ...Object.fromEntries(doctors.map((d) => [d.id, d.full_name])),
          }}
          value={transferDoctorId}
          onValueChange={(v) => setTransferDoctorId(v as string)}
        >
          <SelectTrigger id="transfer-doctor" className="w-full">
            <SelectValue placeholder={t("drawer.selectDoctor")} />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={NO_DOCTOR}>{t("drawer.unassigned")}</SelectItem>
            {doctors.map((d) => (
              <SelectItem key={d.id} value={d.id}>
                {d.full_name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="flex flex-col gap-1.5">
        <Label htmlFor="transfer-reason" className="text-xs">
          {t("drawer.reason")}
        </Label>
        <Input
          id="transfer-reason"
          value={transferReason}
          onChange={(e) => setTransferReason(e.target.value)}
          placeholder={t("drawer.reasonPlaceholder")}
        />
      </div>

      {transferError ? (
        <p className="text-xs text-destructive">{transferError}</p>
      ) : null}

      {transferDone ? (
        <p
          className="flex items-start gap-1.5 text-xs"
          style={{ color: "var(--status-clearance)" }}
        >
          <CheckCircle2 className="mt-0.5 size-3.5 shrink-0" />
          <span>{transferDone}</span>
        </p>
      ) : null}

      <Button
        onClick={() => {
          setTransferDone(null);
          handleTransfer();
        }}
        className="self-end"
      >
        <ArrowLeftRight className="size-4" />
        {hasBed ? t("drawer.recordTransfer") : t("drawer.assignBed")}
      </Button>

      {transfers.length > 0 ? (
        <div className="flex flex-col gap-2">
          <span className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
            {t("drawer.transferHistory")}
          </span>
          <ul className="flex flex-col gap-2">
            {transfers.map((tr) => {
              const lines: string[] = [];
              if (tr.from_bed_id !== tr.to_bed_id) {
                lines.push(
                  t("drawer.bedMove", {
                    from: bedLabel(tr.from_bed_id),
                    to: bedLabel(tr.to_bed_id),
                  }),
                );
              }
              if (tr.from_doctor_id !== tr.to_doctor_id) {
                lines.push(
                  t("drawer.doctorMove", {
                    from: staffName(tr.from_doctor_id),
                    to: staffName(tr.to_doctor_id),
                  }),
                );
              }
              return (
                <li
                  key={tr.id}
                  className="flex flex-col gap-1 rounded-md border border-border p-3 text-xs"
                >
                  <span className="font-mono text-muted-foreground">
                    {formatDateTime(tr.created_at, activeLocale)}
                  </span>
                  {lines.map((l) => (
                    <span key={l}>{l}</span>
                  ))}
                  {tr.reason ? (
                    <span className="text-muted-foreground">{tr.reason}</span>
                  ) : null}
                  {tr.transferred_by_id ? (
                    <span className="text-muted-foreground">
                      {t("drawer.byStaff", {
                        name: staffName(tr.transferred_by_id),
                      })}
                    </span>
                  ) : null}
                </li>
              );
            })}
          </ul>
        </div>
      ) : null}
    </section>
  );
}
