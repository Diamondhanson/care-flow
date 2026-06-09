"use client";

import { useEffect, useState } from "react";
import {
  AlertTriangle,
  ClipboardList,
  FlaskConical,
  Image as ImageIcon,
  Stethoscope,
  Syringe,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";

import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Separator } from "@/components/ui/separator";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
  SheetFooter,
} from "@/components/ui/sheet";
import {
  addResult,
  getOpenOrders,
  getPatientById,
  getStaffById,
  getVisitById,
  updateOrderStatus,
} from "@/services/mockStorage";
import {
  ORDER_STATUS_LABEL,
  ORDER_STATUS_TOKEN,
  ORDER_TYPE_LABEL,
} from "@/components/diagnostics/orders";
import { useRole } from "@/components/role-provider";
import { useT, type TFunction } from "@/components/locale-provider";
import {
  uploadClinicalFile,
  LAB_RESULTS_BUCKET,
} from "@/lib/supabase/storage";
import type { Order, OrderType } from "@/types/healthcare";

const TYPE_ICON: Record<OrderType, LucideIcon> = {
  lab: FlaskConical,
  imaging: ImageIcon,
  procedure: Syringe,
};

interface QueueRow {
  order: Order;
  patientName: string;
  mrn: string;
  isAnonymous: boolean;
  chiefComplaint: string | null;
  orderedBy: string | null;
}

function load(t: TFunction): QueueRow[] {
  return getOpenOrders().map((order) => {
    const visit = getVisitById(order.visit_id);
    const patient = visit ? getPatientById(visit.patient_id) : null;
    const isAnonymous = patient?.is_emergency_anonymous ?? false;
    return {
      order,
      patientName: patient
        ? isAnonymous && patient.anonymous_identifier
          ? patient.anonymous_identifier
          : patient.full_name
        : t("diagnostics.unknownPatient"),
      mrn: patient?.mrn || "—",
      isAnonymous,
      chiefComplaint: visit?.chief_complaint ?? null,
      orderedBy: order.ordered_by_id
        ? (getStaffById(order.ordered_by_id)?.full_name ?? null)
        : null,
    };
  });
}

export default function DiagnosticsPage() {
  const { t } = useT();
  const [rows, setRows] = useState<QueueRow[] | null>(null);
  const [active, setActive] = useState<Order | null>(null);

  function refresh() {
    setRows(load(t));
  }

  useEffect(() => {
    refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [t]);

  const pending = rows?.length ?? null;

  return (
    <div className="mx-auto flex max-w-4xl flex-col gap-8">
      <header className="flex flex-col gap-1">
        <div className="flex items-baseline gap-3">
          <h1 className="text-2xl font-semibold tracking-tight">
            {t("diagnostics.title")}
          </h1>
          <span className="text-sm font-medium tabular-nums text-muted-foreground">
            {pending ?? "—"} {t("diagnostics.awaiting")}
          </span>
        </div>
        <p className="text-sm text-muted-foreground">
          {t("diagnostics.subtitle")}
        </p>
      </header>

      {rows === null ? (
        <p className="text-sm text-muted-foreground">{t("diagnostics.loading")}</p>
      ) : rows.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center gap-2 py-12 text-center">
            <ClipboardList className="size-8 text-muted-foreground/60" />
            <p className="text-sm font-medium">{t("diagnostics.queueClear")}</p>
            <p className="text-xs text-muted-foreground">
              {t("diagnostics.queueClearHint")}
            </p>
          </CardContent>
        </Card>
      ) : (
        <div className="flex flex-col gap-3">
          {rows.map(({ order, patientName, mrn, isAnonymous, chiefComplaint, orderedBy }) => {
            const Icon = TYPE_ICON[order.order_type];
            const token = ORDER_STATUS_TOKEN[order.status];
            return (
              <Card key={order.id}>
                <CardContent className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between">
                  <div className="flex min-w-0 items-start gap-3">
                    <span
                      aria-hidden
                      className="flex size-9 shrink-0 items-center justify-center rounded-md"
                      style={{
                        backgroundColor:
                          "color-mix(in oklab, var(--status-diagnostics) 16%, transparent)",
                        color: "var(--status-diagnostics)",
                      }}
                    >
                      <Icon className="size-4.5" />
                    </span>
                    <div className="flex min-w-0 flex-col gap-0.5">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-medium">{order.description}</span>
                        <Badge
                          variant="outline"
                          className="gap-1 border-transparent text-[10px] uppercase"
                          style={{
                            backgroundColor: `var(--status-${token})`,
                            color: `var(--status-${token}-foreground)`,
                          }}
                        >
                          {t(ORDER_STATUS_LABEL[order.status])}
                        </Badge>
                        <span className="text-[11px] uppercase tracking-wide text-muted-foreground">
                          {t(ORDER_TYPE_LABEL[order.order_type])}
                        </span>
                      </div>
                      <div className="flex flex-wrap items-center gap-x-3 gap-y-0.5 text-xs text-muted-foreground">
                        <span
                          className={
                            isAnonymous ? "font-mono" : "font-medium text-foreground"
                          }
                        >
                          {patientName}
                        </span>
                        <span className="font-mono">{mrn}</span>
                        {chiefComplaint ? <span>{chiefComplaint}</span> : null}
                        {orderedBy ? (
                          <span className="inline-flex items-center gap-1">
                            <Stethoscope className="size-3" />
                            {orderedBy}
                          </span>
                        ) : null}
                      </div>
                    </div>
                  </div>
                  <div className="flex shrink-0 gap-2">
                    {order.status === "requested" ? (
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => {
                          updateOrderStatus(order.id, "in_progress");
                          refresh();
                        }}
                      >
                        {t("diagnostics.start")}
                      </Button>
                    ) : null}
                    <Button size="sm" onClick={() => setActive(order)}>
                      {t("diagnostics.enterResult")}
                    </Button>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      <ResultFormSheet
        order={active}
        onClose={() => setActive(null)}
        onSaved={() => {
          setActive(null);
          refresh();
        }}
      />
    </div>
  );
}

function ResultFormSheet({
  order,
  onClose,
  onSaved,
}: {
  order: Order | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const { actingStaff } = useRole();
  const { t } = useT();

  const [value, setValue] = useState("");
  const [referenceRange, setReferenceRange] = useState("");
  const [summary, setSummary] = useState("");
  const [isAbnormal, setIsAbnormal] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);

  // Reset the form whenever a different order is opened.
  useEffect(() => {
    setValue("");
    setReferenceRange("");
    setSummary("");
    setIsAbnormal(false);
    setFile(null);
    setUploading(false);
    setUploadError(null);
  }, [order]);

  async function handleSave() {
    if (!order || uploading) return;
    let attachmentPath: string | null = null;

    // Upload the attachment first (when present). Storage is online-only and
    // RLS-scoped to the hospital prefix; if it fails we abort so the user can
    // retry rather than recording a result that references a missing file.
    if (file) {
      if (!actingStaff?.hospital_id) {
        setUploadError(t("diagnostics.attachmentNoHospital"));
        return;
      }
      setUploading(true);
      setUploadError(null);
      try {
        const { path } = await uploadClinicalFile({
          bucket: LAB_RESULTS_BUCKET,
          hospitalId: actingStaff.hospital_id,
          segments: ["orders", order.id],
          filename: file.name,
          body: file,
          contentType: file.type || undefined,
        });
        attachmentPath = path;
      } catch (err) {
        setUploading(false);
        setUploadError(
          err instanceof Error ? err.message : t("diagnostics.attachmentFailed"),
        );
        return;
      }
      setUploading(false);
    }

    addResult(order.id, {
      recorded_by_id: actingStaff?.id ?? null,
      value: value || null,
      reference_range: referenceRange || null,
      summary: summary || null,
      is_abnormal: isAbnormal,
      attachment_path: attachmentPath,
    });
    onSaved();
  }

  const canSave = Boolean(value.trim() || summary.trim()) && !uploading;

  return (
    <Sheet
      open={order !== null}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <SheetContent className="flex w-full flex-col gap-0 overflow-y-auto sm:max-w-md">
        <SheetHeader className="border-b border-border">
          <SheetTitle>{t("diagnostics.recordResult")}</SheetTitle>
          <SheetDescription>
            {order
              ? `${t(ORDER_TYPE_LABEL[order.order_type])} · ${order.description}`
              : ""}
          </SheetDescription>
        </SheetHeader>

        <div className="flex flex-col gap-5 p-4">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="res_value">{t("diagnostics.resultValue")}</Label>
            <Input
              id="res_value"
              value={value}
              onChange={(e) => setValue(e.target.value)}
              placeholder={t("diagnostics.resultValuePlaceholder")}
              className="font-mono"
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="res_range">{t("diagnostics.referenceRange")}</Label>
            <Input
              id="res_range"
              value={referenceRange}
              onChange={(e) => setReferenceRange(e.target.value)}
              placeholder={t("diagnostics.referenceRangePlaceholder")}
              className="font-mono"
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="res_summary">{t("diagnostics.summary")}</Label>
            <Textarea
              id="res_summary"
              value={summary}
              onChange={(e) => setSummary(e.target.value)}
              placeholder={t("diagnostics.summaryPlaceholder")}
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="res_attachment">{t("diagnostics.attachment")}</Label>
            <Input
              id="res_attachment"
              type="file"
              accept="image/*,application/pdf"
              onChange={(e) => {
                setUploadError(null);
                setFile(e.target.files?.[0] ?? null);
              }}
              disabled={uploading}
              className="font-mono file:mr-3 file:rounded file:border-0 file:bg-muted file:px-2 file:py-1 file:text-xs file:text-foreground"
            />
            <span className="text-[11px] text-muted-foreground">
              {t("diagnostics.attachmentHint")}
            </span>
            {uploadError ? (
              <span className="text-[11px] text-[var(--status-treatment)]">
                {uploadError}
              </span>
            ) : null}
          </div>

          <label className="flex items-center justify-between gap-4 rounded-md border border-border p-3">
            <span className="flex items-center gap-2">
              <AlertTriangle
                className="size-4"
                style={{ color: "var(--status-treatment)" }}
              />
              <span className="flex flex-col gap-0.5">
                <span className="text-sm font-medium">{t("diagnostics.abnormalResult")}</span>
                <span className="text-xs text-muted-foreground">
                  {t("diagnostics.abnormalHint")}
                </span>
              </span>
            </span>
            <Switch checked={isAbnormal} onCheckedChange={setIsAbnormal} />
          </label>

          <Separator />
        </div>

        <SheetFooter className="mt-auto flex-row justify-end gap-3 border-t border-border">
          <Button variant="ghost" onClick={onClose}>
            {t("common.cancel")}
          </Button>
          <Button onClick={handleSave} disabled={!canSave}>
            {uploading
              ? t("diagnostics.attachmentUploading")
              : t("diagnostics.recordResult")}
          </Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}
