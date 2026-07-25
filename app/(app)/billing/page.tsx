"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { MinusCircle, Plus, Receipt, RefreshCw, Settings2 } from "lucide-react";

import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  addDiscount,
  addManualCharge,
  getBillableItems,
  getChargesForVisit,
  getPatientById,
  getVisits,
  recalculateAutoCharges,
  removeCharge,
  setChargeStatus,
  settleBill,
} from "@/services/mockStorage";
import { summarizeBill } from "@/components/billing/billing";
import { exportBillPdf } from "@/components/billing/bill-export";
import {
  VisitPicker,
  patientDisplayName,
  type VisitRow,
} from "@/components/billing/visit-picker";
import { ChargesTable } from "@/components/billing/charges-table";
import { AddChargeDialog } from "@/components/billing/add-charge-dialog";
import { AddDiscountDialog } from "@/components/billing/add-discount-dialog";
import { VISIT_TYPE_LABEL } from "@/components/reports/reports";
import { useRole } from "@/components/role-provider";
import { RoleGate } from "@/components/auth/role-gate";
import { useT } from "@/components/locale-provider";
import { formatDate } from "@/i18n/format";
import { useCacheVersion } from "@/lib/use-cache";
import { cn } from "@/lib/utils";
import type { BillableItem, BillableItemId, Charge, ChargeId, ChargeStatus, VisitId } from "@/types/healthcare";

export default function BillingPage() {
  const { actingStaff } = useRole();
  const { t, locale, mounted } = useT();
  const activeLocale = mounted ? locale : "en";
  const cacheVersion = useCacheVersion();

  const [rows, setRows] = useState<VisitRow[] | null>(null);
  const [catalog, setCatalog] = useState<BillableItem[]>([]);
  const [selectedId, setSelectedId] = useState<VisitId | null>(null);
  const [charges, setCharges] = useState<Charge[]>([]);
  const [chargeDialog, setChargeDialog] = useState(false);
  const [discountDialog, setDiscountDialog] = useState(false);

  function refreshVisits() {
    const visits = getVisits()
      .slice()
      .sort((a, b) => b.arrived_at.localeCompare(a.arrived_at));
    setRows(visits.map((visit) => ({ visit, patient: getPatientById(visit.patient_id) })));
    setCatalog(getBillableItems());
  }

  function refreshCharges(visitId: VisitId | null) {
    setCharges(visitId ? getChargesForVisit(visitId) : []);
  }

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    refreshVisits();
  }, [cacheVersion]);

  useEffect(() => {
    if (rows && rows.length > 0 && selectedId === null) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setSelectedId(rows[0].visit.id);
    }
  }, [rows, selectedId]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    refreshCharges(selectedId);
  }, [selectedId, cacheVersion]);

  const selected = useMemo(
    () => rows?.find((r) => r.visit.id === selectedId) ?? null,
    [rows, selectedId],
  );

  // Per-visit grand totals for the rail, recomputed whenever the visit list,
  // catalog, or the selected visit's charges change.
  const totals = useMemo(() => {
    const map = new Map<string, number>();
    for (const r of rows ?? []) {
      map.set(r.visit.id, summarizeBill(getChargesForVisit(r.visit.id), catalog).grandTotal);
    }
    return map;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows, catalog, charges]);

  const summary = useMemo(() => summarizeBill(charges, catalog), [charges, catalog]);

  function reload() {
    refreshCharges(selectedId);
    refreshVisits();
  }

  function handleRecalc() {
    if (!selectedId) return;
    recalculateAutoCharges(selectedId);
    reload();
  }

  function handleAddCharge(input: { billableItemId: BillableItemId | null; description: string; quantity: number; unitPrice: number }) {
    if (!selectedId) return;
    addManualCharge(selectedId, {
      billable_item_id: input.billableItemId,
      description: input.description,
      quantity: input.quantity,
      unit_price: Number.isNaN(input.unitPrice) ? undefined : input.unitPrice,
      created_by_id: actingStaff?.id ?? null,
    });
    reload();
  }

  function handleAddDiscount(input: { description: string; amount: number }) {
    if (!selectedId) return;
    addDiscount(selectedId, {
      description: input.description,
      amount: input.amount,
      created_by_id: actingStaff?.id ?? null,
    });
    reload();
  }

  function handleSettle() {
    if (!selectedId) return;
    settleBill(selectedId, actingStaff?.id ?? null);
    reload();
  }

  function handleStatus(chargeId: ChargeId, status: ChargeStatus) {
    setChargeStatus(chargeId, status);
    reload();
  }

  function handleRemove(chargeId: ChargeId) {
    removeCharge(chargeId);
    reload();
  }

  function handleExport() {
    if (!selected?.patient) return;
    exportBillPdf(
      {
        patient: selected.patient,
        visit: selected.visit,
        charges,
        catalog,
        generatedAtMs: Date.now(),
      },
      t,
      activeLocale,
    );
  }

  return (
    <RoleGate
      allow={["admin", "receptionist"]}
      icon={Receipt}
      titleKey="billing.title"
      bodyKey="billing.accessDenied"
    >
    <div className="mx-auto flex max-w-6xl flex-col gap-6">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex flex-col gap-1">
          <h1 className="text-2xl font-semibold tracking-tight">{t("billing.title")}</h1>
          <p className="max-w-2xl text-sm text-muted-foreground">{t("billing.subtitle")}</p>
        </div>
        <Button variant="outline" size="sm" render={<Link href="/billing/prices" />}>
          <Settings2 className="size-4" />
          {t("billing.pricesLink")}
        </Button>
      </header>

      {rows === null ? (
        <p className="text-sm text-muted-foreground">{t("billing.loading")}</p>
      ) : (
        <div className="grid gap-6 lg:grid-cols-[22rem_1fr]">
          {/* Master — visit picker */}
          <VisitPicker
            rows={rows}
            selectedId={selectedId}
            totals={totals}
            locale={activeLocale}
            onSelect={setSelectedId}
            t={t}
          />

          {/* Detail — the selected visit's bill */}
          {selected ? (
            <div className="flex flex-col gap-5">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="flex flex-col gap-0.5">
                  <span
                    className={cn(
                      "text-lg",
                      selected.patient?.is_emergency_anonymous ? "font-mono" : "font-semibold",
                    )}
                  >
                    {t("billing.billFor", { name: patientDisplayName(selected.patient, t) })}
                  </span>
                  <span className="text-sm text-muted-foreground">
                    {t("billing.visitMeta", {
                      type: t(VISIT_TYPE_LABEL[selected.visit.visit_type]),
                      date: formatDate(selected.visit.arrived_at, activeLocale),
                    })}
                  </span>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <Button variant="outline" size="sm" onClick={handleRecalc}>
                    <RefreshCw className="size-4" />
                    {t("billing.recalc")}
                  </Button>
                  <Button variant="outline" size="sm" onClick={() => setChargeDialog(true)}>
                    <Plus className="size-4" />
                    {t("billing.addCharge")}
                  </Button>
                  <Button variant="outline" size="sm" onClick={() => setDiscountDialog(true)}>
                    <MinusCircle className="size-4" />
                    {t("billing.addDiscount")}
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={handleExport}
                    disabled={summary.isEmpty || !selected.patient}
                  >
                    <Receipt className="size-4" />
                    {t("billing.exportPdf")}
                  </Button>
                </div>
              </div>

              {summary.isEmpty ? (
                <Card>
                  <CardContent className="flex flex-col items-center gap-2 py-12 text-center">
                    <Receipt className="size-8 text-muted-foreground/60" />
                    <p className="text-sm font-medium">{t("billing.emptyBill")}</p>
                    <p className="text-xs text-muted-foreground">{t("billing.emptyBillHint")}</p>
                    <Button variant="outline" size="sm" className="mt-2" onClick={handleRecalc}>
                      <RefreshCw className="size-4" />
                      {t("billing.recalc")}
                    </Button>
                  </CardContent>
                </Card>
              ) : (
                <ChargesTable
                  summary={summary}
                  locale={activeLocale}
                  onStatus={handleStatus}
                  onRemove={handleRemove}
                  onSettle={handleSettle}
                  t={t}
                />
              )}
            </div>
          ) : (
            <Card>
              <CardContent className="flex flex-col items-center gap-2 py-12 text-center">
                <Receipt className="size-8 text-muted-foreground/60" />
                <p className="text-sm font-medium">{t("billing.selectVisit")}</p>
                <p className="text-xs text-muted-foreground">{t("billing.selectVisitHint")}</p>
              </CardContent>
            </Card>
          )}
        </div>
      )}

      <AddChargeDialog
        open={chargeDialog}
        onOpenChange={setChargeDialog}
        catalog={catalog}
        onSubmit={handleAddCharge}
        t={t}
      />
      <AddDiscountDialog
        open={discountDialog}
        onOpenChange={setDiscountDialog}
        onSubmit={handleAddDiscount}
        t={t}
      />
    </div>
    </RoleGate>
  );
}
