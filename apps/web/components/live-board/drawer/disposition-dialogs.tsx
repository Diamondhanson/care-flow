"use client";

import { useState } from "react";
import { BedDouble, Eye, Send } from "lucide-react";

import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { formatPatientName } from "@/lib/patient-name";
import {
  getDepartments,
  getStaff,
  recordDisposition,
  type DispositionDetails,
} from "@/services/mockStorage";
import { useT } from "@/components/locale-provider";
import type {
  Bed,
  BedId,
  Department,
  StaffId,
  Visit,
  Ward,
  WardId,
} from "@careflow/shared";
import type { MessageKey } from "@/i18n";

const NO_BED = "__none__";
const NO_DOCTOR = "__none__";
const NO_DEPT = "__none__";
const NO_WARD = "__none__";

/** Dispositions that open a details dialog before they are recorded. */
export type DispositionDialogKind = "admit" | "observation" | "refer";

/** Common observation windows offered as a select (i18n label keys). */
const OBS_DURATION_OPTIONS: { value: string; labelKey: MessageKey }[] = [
  { value: "1 hour", labelKey: "drawer.obsDur1h" },
  { value: "2 hours", labelKey: "drawer.obsDur2h" },
  { value: "4 hours", labelKey: "drawer.obsDur4h" },
  { value: "6 hours", labelKey: "drawer.obsDur6h" },
  { value: "12 hours", labelKey: "drawer.obsDur12h" },
  { value: "24 hours", labelKey: "drawer.obsDur24h" },
  { value: "48 hours", labelKey: "drawer.obsDur48h" },
  { value: "72 hours", labelKey: "drawer.obsDur72h" },
];

/**
 * Disposition detail dialogs — admit (department → ward → free-bed placement),
 * observation, and referral. Each opens as a centered dialog to capture the
 * structured details before the disposition is recorded on the visit. The
 * dialogs mount fresh when opened, so their drafts re-seed from the visit
 * every time (matching the monolith's openDispositionDialog seeding).
 */
export function DispositionDialogs({
  kind,
  visit,
  displayName,
  wards,
  beds,
  recorderId,
  onClose,
  onSubmitted,
}: {
  /** Which dialog is open, or null for none. */
  kind: DispositionDialogKind | null;
  visit: Visit;
  displayName: string;
  wards: Ward[];
  beds: Bed[];
  recorderId: StaffId | null;
  onClose: () => void;
  onSubmitted: () => void;
}) {
  function submit(disposition: DispositionDialogKind, details: DispositionDetails) {
    recordDisposition(visit.id, disposition, recorderId, details);
    onSubmitted();
  }

  // Conditional mounting gives each dialog fresh, visit-seeded drafts on open.
  return (
    <>
      {kind === "admit" ? (
        <AdmitDialog
          visit={visit}
          displayName={displayName}
          wards={wards}
          beds={beds}
          recorderId={recorderId}
          onClose={onClose}
          onSubmit={(details) => submit("admit", details)}
        />
      ) : null}
      {kind === "observation" ? (
        <ObservationDialog
          displayName={displayName}
          onClose={onClose}
          onSubmit={(details) => submit("observation", details)}
        />
      ) : null}
      {kind === "refer" ? (
        <ReferralDialog
          displayName={displayName}
          onClose={onClose}
          onSubmit={(details) => submit("refer", details)}
        />
      ) : null}
    </>
  );
}

/* ---- Admit dialog: department → ward → free bed → doctor + reason ---- */
function AdmitDialog({
  visit,
  displayName,
  wards,
  beds,
  recorderId,
  onClose,
  onSubmit,
}: {
  visit: Visit;
  displayName: string;
  wards: Ward[];
  beds: Bed[];
  recorderId: StaffId | null;
  onClose: () => void;
  onSubmit: (details: DispositionDetails) => void;
}) {
  const { t } = useT();

  // Seed from the visit's current department so the ward list is pre-scoped.
  const [admitDeptId, setAdmitDeptId] = useState<string>(
    visit.department_id ?? NO_DEPT,
  );
  const [admitWardId, setAdmitWardId] = useState<string>(NO_WARD);
  const [admitBedId, setAdmitBedId] = useState<string>(NO_BED);
  const [admitDoctorId, setAdmitDoctorId] = useState<string>(
    visit.attending_doctor_id ?? recorderId ?? NO_DOCTOR,
  );
  const [admitReason, setAdmitReason] = useState(visit.chief_complaint ?? "");
  const [dispoError, setDispoError] = useState<string | null>(null);

  const doctors = getStaff().filter((s) => s.role === "doctor" && s.is_active);

  // Admit cascade: department → ward → free bed. Wards are scoped to the
  // chosen department; beds to the chosen ward, showing only what's free.
  const activeDepartments: Department[] = getDepartments().filter(
    (d) => d.is_active,
  );
  const admitWards: Ward[] = wards.filter(
    (w) =>
      w.is_active && (admitDeptId === NO_DEPT || w.department_id === admitDeptId),
  );
  const admitFreeBeds: Bed[] =
    admitWardId === NO_WARD
      ? []
      : beds
          .filter((b) => b.ward_id === admitWardId && b.status === "free")
          .sort((a, b) =>
            a.label.localeCompare(b.label, undefined, { numeric: true }),
          );

  function handleSubmitAdmit() {
    if (admitBedId === NO_BED) {
      setDispoError(t("drawer.admitBedRequired"));
      return;
    }
    onSubmit({
      ward_id: admitWardId === NO_WARD ? null : (admitWardId as WardId),
      bed_id: admitBedId === NO_BED ? null : (admitBedId as BedId),
      attending_doctor_id:
        admitDoctorId === NO_DOCTOR ? null : (admitDoctorId as StaffId),
      reason: admitReason,
    });
  }

  return (
    <Dialog
      open
      onOpenChange={(o) => {
        if (!o) onClose();
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t("drawer.admitDialogTitle")}</DialogTitle>
          <DialogDescription>
            {t("drawer.admitDialogDesc", {
              name: formatPatientName(displayName),
            })}
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-1.5">
          <Label htmlFor="admit-dept" className="text-xs">
            {t("drawer.department")}
          </Label>
          <Select
            items={{
              [NO_DEPT]: t("drawer.anyDepartment"),
              ...Object.fromEntries(activeDepartments.map((d) => [d.id, d.name])),
            }}
            value={admitDeptId}
            onValueChange={(v) => {
              setAdmitDeptId(v as string);
              setAdmitWardId(NO_WARD);
              setAdmitBedId(NO_BED);
            }}
          >
            <SelectTrigger id="admit-dept" className="w-full">
              <SelectValue placeholder={t("drawer.selectDepartment")} />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={NO_DEPT}>{t("drawer.anyDepartment")}</SelectItem>
              {activeDepartments.map((d) => (
                <SelectItem key={d.id} value={d.id}>
                  {d.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="flex flex-col gap-1.5">
          <Label htmlFor="admit-ward" className="text-xs">
            {t("drawer.ward")}
          </Label>
          <Select
            items={Object.fromEntries(admitWards.map((w) => [w.id, w.name]))}
            value={admitWardId === NO_WARD ? null : admitWardId}
            onValueChange={(v) => {
              setAdmitWardId(v as string);
              setAdmitBedId(NO_BED);
            }}
          >
            <SelectTrigger id="admit-ward" className="w-full">
              <SelectValue placeholder={t("drawer.selectWard")} />
            </SelectTrigger>
            <SelectContent>
              {admitWards.map((w) => (
                <SelectItem key={w.id} value={w.id}>
                  {w.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {admitWards.length === 0 ? (
            <p className="text-xs text-muted-foreground">
              {t("drawer.noWardsForDept")}
            </p>
          ) : null}
        </div>

        <div className="flex flex-col gap-1.5">
          <Label htmlFor="admit-bed" className="text-xs">
            {t("drawer.bed")}
          </Label>
          <Select
            items={Object.fromEntries(admitFreeBeds.map((b) => [b.id, b.label]))}
            value={admitBedId === NO_BED ? null : admitBedId}
            onValueChange={(v) => setAdmitBedId(v as string)}
            disabled={admitWardId === NO_WARD}
          >
            <SelectTrigger id="admit-bed" className="w-full">
              <SelectValue placeholder={t("drawer.selectBed")} />
            </SelectTrigger>
            <SelectContent>
              {admitFreeBeds.map((b) => (
                <SelectItem key={b.id} value={b.id}>
                  {b.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {admitWardId !== NO_WARD && admitFreeBeds.length === 0 ? (
            <p className="text-xs text-muted-foreground">
              {t("drawer.noFreeBeds")}
            </p>
          ) : null}
        </div>

        <div className="flex flex-col gap-1.5">
          <Label htmlFor="admit-doctor" className="text-xs">
            {t("drawer.attendingDoctor")}
          </Label>
          <Select
            items={{
              [NO_DOCTOR]: t("drawer.unassigned"),
              ...Object.fromEntries(doctors.map((d) => [d.id, d.full_name])),
            }}
            value={admitDoctorId}
            onValueChange={(v) => setAdmitDoctorId(v as string)}
          >
            <SelectTrigger id="admit-doctor" className="w-full">
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
          <Label htmlFor="admit-reason" className="text-xs">
            {t("drawer.admitReason")}
          </Label>
          <Textarea
            id="admit-reason"
            value={admitReason}
            onChange={(e) => setAdmitReason(e.target.value)}
            placeholder={t("drawer.admitReasonPlaceholder")}
            rows={2}
          />
        </div>

        {dispoError ? (
          <p className="text-xs text-destructive">{dispoError}</p>
        ) : null}

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            {t("common.cancel")}
          </Button>
          <Button onClick={handleSubmitAdmit}>
            <BedDouble className="size-4" />
            {t("drawer.confirmAdmit")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/* ---- Observation dialog: reason → duration → location ---- */
function ObservationDialog({
  displayName,
  onClose,
  onSubmit,
}: {
  displayName: string;
  onClose: () => void;
  onSubmit: (details: DispositionDetails) => void;
}) {
  const { t } = useT();

  const [obsReason, setObsReason] = useState("");
  const [obsDuration, setObsDuration] = useState<string>("");
  const [obsLocation, setObsLocation] = useState("");
  const [dispoError, setDispoError] = useState<string | null>(null);

  function handleSubmitObservation() {
    if (!obsReason.trim()) {
      setDispoError(t("drawer.obsReasonRequired"));
      return;
    }
    onSubmit({
      observation_reason: obsReason,
      observation_duration: obsDuration || null,
      observation_location: obsLocation,
    });
  }

  return (
    <Dialog
      open
      onOpenChange={(o) => {
        if (!o) onClose();
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t("drawer.obsDialogTitle")}</DialogTitle>
          <DialogDescription>
            {t("drawer.obsDialogDesc", {
              name: formatPatientName(displayName),
            })}
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-1.5">
          <Label htmlFor="obs-reason" className="text-xs">
            {t("drawer.obsReason")}
          </Label>
          <Textarea
            id="obs-reason"
            value={obsReason}
            onChange={(e) => setObsReason(e.target.value)}
            placeholder={t("drawer.obsReasonPlaceholder")}
            rows={2}
          />
        </div>

        <div className="flex flex-col gap-1.5">
          <Label htmlFor="obs-duration" className="text-xs">
            {t("drawer.obsDuration")}
          </Label>
          <Select
            items={Object.fromEntries(
              OBS_DURATION_OPTIONS.map((o) => [o.value, t(o.labelKey)]),
            )}
            value={obsDuration || null}
            onValueChange={(v) => setObsDuration(v as string)}
          >
            <SelectTrigger id="obs-duration" className="w-full">
              <SelectValue placeholder={t("drawer.obsDurationPlaceholder")} />
            </SelectTrigger>
            <SelectContent>
              {OBS_DURATION_OPTIONS.map((o) => (
                <SelectItem key={o.value} value={o.value}>
                  {t(o.labelKey)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="flex flex-col gap-1.5">
          <Label htmlFor="obs-location" className="text-xs">
            {t("drawer.obsLocation")}
          </Label>
          <Input
            id="obs-location"
            value={obsLocation}
            onChange={(e) => setObsLocation(e.target.value)}
            placeholder={t("drawer.obsLocationPlaceholder")}
          />
        </div>

        {dispoError ? (
          <p className="text-xs text-destructive">{dispoError}</p>
        ) : null}

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            {t("common.cancel")}
          </Button>
          <Button onClick={handleSubmitObservation}>
            <Eye className="size-4" />
            {t("drawer.confirmObservation")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/* ---- Referral dialog: facility → recipient → reason ---- */
function ReferralDialog({
  displayName,
  onClose,
  onSubmit,
}: {
  displayName: string;
  onClose: () => void;
  onSubmit: (details: DispositionDetails) => void;
}) {
  const { t } = useT();

  const [referReason, setReferReason] = useState("");
  const [referFacility, setReferFacility] = useState("");
  const [referRecipient, setReferRecipient] = useState("");
  const [dispoError, setDispoError] = useState<string | null>(null);

  function handleSubmitReferral() {
    if (!referReason.trim() || !referFacility.trim()) {
      setDispoError(t("drawer.referRequired"));
      return;
    }
    onSubmit({
      referral_reason: referReason,
      referral_facility: referFacility,
      referral_recipient: referRecipient,
    });
  }

  return (
    <Dialog
      open
      onOpenChange={(o) => {
        if (!o) onClose();
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t("drawer.referDialogTitle")}</DialogTitle>
          <DialogDescription>
            {t("drawer.referDialogDesc", {
              name: formatPatientName(displayName),
            })}
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-1.5">
          <Label htmlFor="refer-facility" className="text-xs">
            {t("drawer.referFacility")}
          </Label>
          <Input
            id="refer-facility"
            value={referFacility}
            onChange={(e) => setReferFacility(e.target.value)}
            placeholder={t("drawer.referFacilityPlaceholder")}
          />
        </div>

        <div className="flex flex-col gap-1.5">
          <Label htmlFor="refer-recipient" className="text-xs">
            {t("drawer.referRecipient")}
          </Label>
          <Input
            id="refer-recipient"
            value={referRecipient}
            onChange={(e) => setReferRecipient(e.target.value)}
            placeholder={t("drawer.referRecipientPlaceholder")}
          />
        </div>

        <div className="flex flex-col gap-1.5">
          <Label htmlFor="refer-reason" className="text-xs">
            {t("drawer.referReason")}
          </Label>
          <Textarea
            id="refer-reason"
            value={referReason}
            onChange={(e) => setReferReason(e.target.value)}
            placeholder={t("drawer.referReasonPlaceholder")}
            rows={2}
          />
        </div>

        {dispoError ? (
          <p className="text-xs text-destructive">{dispoError}</p>
        ) : null}

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            {t("common.cancel")}
          </Button>
          <Button onClick={handleSubmitReferral}>
            <Send className="size-4" />
            {t("drawer.confirmReferral")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
