"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  CheckCircle2,
  MinusCircle,
  Plus,
  Receipt,
  RefreshCw,
  Settings2,
  Trash2,
  Wallet,
} from "lucide-react";

import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
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
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
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
import { VISIT_TYPE_LABEL } from "@/components/reports/reports";
import { useRole } from "@/components/role-provider";
import { useT, type TFunction } from "@/components/locale-provider";
import { formatDate, formatXaf } from "@/i18n/format";
import { cn } from "@/lib/utils";
import type {
  BillableItem,
  Charge,
  ChargeStatus,
  Patient,
  Visit,
} from "@/types/healthcare";

/** A visit joined with its patient, for the picker + bill header. */
interface VisitRow {
  visit: Visit;
  patient: Patient | undefined;
}

function patientDisplayName(patient: Patient | undefined, t: TFunction): string {
  if (!patient) return t("meds.unknownPatient");
  return patient.is_emergency_anonymous && patient.anonymous_identifier
    ? patient.anonymous_identifier
    : patient.full_name;
}

function statusBadgeStyle(status: ChargeStatus): { color: string; bg: string } {
  switch (status) {
    case "paid":
      return { color: "var(--status-clearance)", bg: "color-mix(in oklab, var(--status-clearance) 16%, transparent)" };
    case "waived":
      return { color: "var(--status-boarding)", bg: "color-mix(in oklab, var(--status-boarding) 16%, transparent)" };
    default:
      return { color: "var(--status-treatment)", bg: "color-mix(in oklab, var(--status-treatment) 16%, transparent)" };
  }
}

// ---------------------------------------------------------------------------
// Left rail — visit picker
// ---------------------------------------------------------------------------

function VisitPickerRow({
  row,
  active,
  total,
  locale,
  onSelect,
  t,
}: {
  row: VisitRow;
  active: boolean;
  total: number;
  locale: "en" | "fr";
  onSelect: () => void;
  t: TFunction;
}) {
  const isAnon = row.patient?.is_emergency_anonymous ?? false;
  return (
    <button
      type="button"
      onClick={onSelect}
      aria-current={active ? "true" : undefined}
      className={cn(
        "flex w-full flex-col gap-1 rounded-lg border px-3.5 py-3 text-left transition-colors",
        active ? "border-primary/40 bg-accent" : "border-border bg-card hover:bg-accent/50",
      )}
    >
      <div className="flex items-center justify-between gap-2">
        <span className={cn("truncate text-sm", isAnon ? "font-mono" : "font-medium")}>
          {patientDisplayName(row.patient, t)}
        </span>
        <span className="shrink-0 font-mono text-xs tabular-nums text-muted-foreground">
          {formatXaf(total, locale)}
        </span>
      </div>
      <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
        <span className="truncate font-mono">{row.patient?.mrn || "—"}</span>
      </div>
    </button>
  );
}

// ---------------------------------------------------------------------------
// Add charge / discount dialog
// ---------------------------------------------------------------------------

function AddChargeDialog({
  open,
  onOpenChange,
  catalog,
  onSubmit,
  t,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  catalog: BillableItem[];
  onSubmit: (input: { billableItemId: string | null; description: string; quantity: number; unitPrice: number }) => void;
  t: TFunction;
}) {
  const [mode, setMode] = useState<"catalog" | "custom">("catalog");
  const [itemId, setItemId] = useState<string>("");
  const [description, setDescription] = useState("");
  const [quantity, setQuantity] = useState("1");
  const [unitPrice, setUnitPrice] = useState("");

  const activeCatalog = useMemo(() => catalog.filter((c) => c.is_active), [catalog]);
  const catalogItems = useMemo(() => {
    const entries: Record<string, string> = {};
    for (const c of activeCatalog) entries[c.id] = c.name;
    return entries;
  }, [activeCatalog]);

  function reset() {
    setMode("catalog");
    setItemId("");
    setDescription("");
    setQuantity("1");
    setUnitPrice("");
  }

  function submit() {
    const qty = Math.max(1, Math.round(Number(quantity) || 1));
    if (mode === "catalog") {
      if (!itemId) return;
      onSubmit({ billableItemId: itemId, description: "", quantity: qty, unitPrice: NaN });
    } else {
      if (!description.trim()) return;
      onSubmit({
        billableItemId: null,
        description: description.trim(),
        quantity: qty,
        unitPrice: Math.max(0, Math.round(Number(unitPrice) || 0)),
      });
    }
    reset();
    onOpenChange(false);
  }

  const canSubmit = mode === "catalog" ? Boolean(itemId) : description.trim().length > 0;

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) reset(); onOpenChange(v); }}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{t("billing.addChargeTitle")}</DialogTitle>
          <DialogDescription>{t("billing.recalcHint")}</DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-4">
          <div className="flex gap-1.5">
            {(["catalog", "custom"] as const).map((m) => (
              <button
                key={m}
                type="button"
                onClick={() => setMode(m)}
                aria-pressed={mode === m}
                className={cn(
                  "flex-1 rounded-md border px-3 py-1.5 text-sm font-medium transition-colors",
                  mode === m
                    ? "border-primary bg-primary text-primary-foreground"
                    : "border-border text-muted-foreground hover:bg-accent",
                )}
              >
                {m === "catalog" ? t("billing.fromCatalog") : t("billing.customLine")}
              </button>
            ))}
          </div>

          {mode === "catalog" ? (
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="charge-item">{t("billing.fieldItem")}</Label>
              <Select items={catalogItems} value={itemId} onValueChange={(v) => setItemId(v as string)}>
                <SelectTrigger id="charge-item" className="w-full">
                  <SelectValue placeholder={t("billing.fieldItem")} />
                </SelectTrigger>
                <SelectContent>
                  {activeCatalog.map((c) => (
                    <SelectItem key={c.id} value={c.id}>
                      {c.name} · {formatXaf(c.unit_price, "en")}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          ) : (
            <>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="charge-desc">{t("billing.fieldDescription")}</Label>
                <Input
                  id="charge-desc"
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  placeholder={t("billing.fieldDescriptionPlaceholder")}
                />
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="charge-price">{t("billing.fieldUnitPrice")}</Label>
                <Input
                  id="charge-price"
                  type="number"
                  min={0}
                  value={unitPrice}
                  onChange={(e) => setUnitPrice(e.target.value)}
                />
              </div>
            </>
          )}

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="charge-qty">{t("billing.fieldQuantity")}</Label>
            <Input
              id="charge-qty"
              type="number"
              min={1}
              value={quantity}
              onChange={(e) => setQuantity(e.target.value)}
              className="w-28"
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => { reset(); onOpenChange(false); }}>
            {t("billing.cancel")}
          </Button>
          <Button onClick={submit} disabled={!canSubmit}>
            {t("billing.save")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function AddDiscountDialog({
  open,
  onOpenChange,
  onSubmit,
  t,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  onSubmit: (input: { description: string; amount: number }) => void;
  t: TFunction;
}) {
  const [description, setDescription] = useState("");
  const [amount, setAmount] = useState("");

  function reset() {
    setDescription("");
    setAmount("");
  }

  function submit() {
    const value = Math.max(0, Math.round(Number(amount) || 0));
    if (value <= 0) return;
    onSubmit({ description: description.trim(), amount: value });
    reset();
    onOpenChange(false);
  }

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) reset(); onOpenChange(v); }}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{t("billing.addDiscountTitle")}</DialogTitle>
        </DialogHeader>
        <div className="flex flex-col gap-4">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="disc-desc">{t("billing.fieldDescription")}</Label>
            <Input
              id="disc-desc"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder={t("billing.discountDescriptionPlaceholder")}
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="disc-amount">{t("billing.fieldDiscountAmount")}</Label>
            <Input
              id="disc-amount"
              type="number"
              min={1}
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => { reset(); onOpenChange(false); }}>
            {t("billing.cancel")}
          </Button>
          <Button onClick={submit} disabled={!(Number(amount) > 0)}>
            {t("billing.save")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ---------------------------------------------------------------------------
// A single charge row in the bill
// ---------------------------------------------------------------------------

function ChargeRow({
  charge,
  locale,
  onStatus,
  onRemove,
  t,
}: {
  charge: Charge;
  locale: "en" | "fr";
  onStatus: (status: ChargeStatus) => void;
  onRemove: () => void;
  t: TFunction;
}) {
  const badge = statusBadgeStyle(charge.status);
  return (
    <div className="grid grid-cols-[1fr_auto] items-start gap-3 border-b border-border/60 py-2.5 last:border-b-0">
      <div className="flex min-w-0 flex-col gap-0.5">
        <span className="truncate text-sm">{charge.description}</span>
        <span className="flex items-center gap-2 text-xs text-muted-foreground">
          <span className="font-mono tabular-nums">
            {charge.quantity} × {formatXaf(charge.unit_price, locale)}
          </span>
          <span
            className="rounded-full px-1.5 py-0.5 text-[10px] font-semibold uppercase"
            style={{ color: badge.color, backgroundColor: badge.bg }}
          >
            {t(`billing.status.${charge.status}`)}
          </span>
        </span>
      </div>
      <div className="flex items-center gap-2">
        <span className="font-mono text-sm tabular-nums">{formatXaf(charge.amount, locale)}</span>
        <DropdownMenu>
          <DropdownMenuTrigger
            aria-label={t("billing.colActions") || "actions"}
            className="flex size-7 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground"
          >
            <Settings2 className="size-4" />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            {charge.status !== "paid" ? (
              <DropdownMenuItem onClick={() => onStatus("paid")}>
                <CheckCircle2 className="size-4" />
                {t("billing.markPaid")}
              </DropdownMenuItem>
            ) : null}
            {charge.status !== "waived" ? (
              <DropdownMenuItem onClick={() => onStatus("waived")}>
                <MinusCircle className="size-4" />
                {t("billing.markWaived")}
              </DropdownMenuItem>
            ) : null}
            {charge.status !== "pending" ? (
              <DropdownMenuItem onClick={() => onStatus("pending")}>
                {t("billing.markPending")}
              </DropdownMenuItem>
            ) : null}
            <DropdownMenuItem variant="destructive" onClick={onRemove}>
              <Trash2 className="size-4" />
              {t("billing.remove")}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export default function BillingPage() {
  const { actingStaff, actingRole, mounted: roleMounted } = useRole();
  const { t, locale, mounted } = useT();
  const activeLocale = mounted ? locale : "en";

  const [rows, setRows] = useState<VisitRow[] | null>(null);
  const [catalog, setCatalog] = useState<BillableItem[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [charges, setCharges] = useState<Charge[]>([]);
  const [search, setSearch] = useState("");
  const [chargeDialog, setChargeDialog] = useState(false);
  const [discountDialog, setDiscountDialog] = useState(false);

  const allowed = !roleMounted || actingRole === "admin" || actingRole === "receptionist";

  function refreshVisits() {
    const visits = getVisits()
      .slice()
      .sort((a, b) => b.arrived_at.localeCompare(a.arrived_at));
    setRows(visits.map((visit) => ({ visit, patient: getPatientById(visit.patient_id) })));
    setCatalog(getBillableItems());
  }

  function refreshCharges(visitId: string | null) {
    setCharges(visitId ? getChargesForVisit(visitId) : []);
  }

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    refreshVisits();
  }, []);

  useEffect(() => {
    if (rows && rows.length > 0 && selectedId === null) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setSelectedId(rows[0].visit.id);
    }
  }, [rows, selectedId]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    refreshCharges(selectedId);
  }, [selectedId]);

  const filtered = useMemo(() => {
    if (!rows) return [];
    const q = search.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter((r) => {
      const name = patientDisplayName(r.patient, t).toLowerCase();
      const mrn = (r.patient?.mrn ?? "").toLowerCase();
      return name.includes(q) || mrn.includes(q);
    });
  }, [rows, search, t]);

  const openRows = filtered.filter((r) => r.visit.status === "open");
  const closedRows = filtered.filter((r) => r.visit.status !== "open");

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

  function handleAddCharge(input: { billableItemId: string | null; description: string; quantity: number; unitPrice: number }) {
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

  function handleStatus(chargeId: string, status: ChargeStatus) {
    setChargeStatus(chargeId, status);
    reload();
  }

  function handleRemove(chargeId: string) {
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

  if (roleMounted && !allowed) {
    return (
      <div className="mx-auto max-w-2xl">
        <Card>
          <CardContent className="flex flex-col items-center gap-2 py-12 text-center">
            <Receipt className="size-8 text-muted-foreground/60" />
            <p className="text-sm font-medium">{t("billing.title")}</p>
            <p className="text-xs text-muted-foreground">{t("billing.accessDenied")}</p>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
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
          <aside className="flex flex-col gap-3">
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder={t("billing.searchPlaceholder")}
            />
            {filtered.length === 0 ? (
              <p className="px-1 text-sm text-muted-foreground">{t("billing.noVisitsHint")}</p>
            ) : (
              <div className="flex flex-col gap-4">
                {openRows.length > 0 ? (
                  <div className="flex flex-col gap-2">
                    <p className="px-1 text-[11px] font-semibold uppercase tracking-[0.12em] text-muted-foreground/70">
                      {t("billing.openVisits")}
                    </p>
                    {openRows.map((r) => (
                      <VisitPickerRow
                        key={r.visit.id}
                        row={r}
                        active={r.visit.id === selectedId}
                        total={totals.get(r.visit.id) ?? 0}
                        locale={activeLocale}
                        onSelect={() => setSelectedId(r.visit.id)}
                        t={t}
                      />
                    ))}
                  </div>
                ) : null}
                {closedRows.length > 0 ? (
                  <div className="flex flex-col gap-2">
                    <p className="px-1 text-[11px] font-semibold uppercase tracking-[0.12em] text-muted-foreground/70">
                      {t("billing.closedVisits")}
                    </p>
                    {closedRows.map((r) => (
                      <VisitPickerRow
                        key={r.visit.id}
                        row={r}
                        active={r.visit.id === selectedId}
                        total={totals.get(r.visit.id) ?? 0}
                        locale={activeLocale}
                        onSelect={() => setSelectedId(r.visit.id)}
                        t={t}
                      />
                    ))}
                  </div>
                ) : null}
              </div>
            )}
          </aside>

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
                <>
                  {/* Grouped itemised charges */}
                  <div className="flex flex-col gap-4">
                    {summary.groups.map((group) => (
                      <Card key={group.category}>
                        <CardContent className="flex flex-col gap-1 p-4">
                          <div className="flex items-center justify-between gap-2 pb-1">
                            <span className="text-[11px] font-semibold uppercase tracking-[0.08em] text-muted-foreground">
                              {t(`billing.category.${group.category}`)}
                            </span>
                            <span className="font-mono text-xs tabular-nums text-muted-foreground">
                              {formatXaf(group.subtotal, activeLocale)}
                            </span>
                          </div>
                          {group.lines.map((c) => (
                            <ChargeRow
                              key={c.id}
                              charge={c}
                              locale={activeLocale}
                              onStatus={(s) => handleStatus(c.id, s)}
                              onRemove={() => handleRemove(c.id)}
                              t={t}
                            />
                          ))}
                        </CardContent>
                      </Card>
                    ))}

                    {summary.discounts.length > 0 ? (
                      <Card>
                        <CardContent className="flex flex-col gap-1 p-4">
                          <span className="pb-1 text-[11px] font-semibold uppercase tracking-[0.08em] text-muted-foreground">
                            {t("billing.source.discount")}
                          </span>
                          {summary.discounts.map((c) => (
                            <ChargeRow
                              key={c.id}
                              charge={c}
                              locale={activeLocale}
                              onStatus={(s) => handleStatus(c.id, s)}
                              onRemove={() => handleRemove(c.id)}
                              t={t}
                            />
                          ))}
                        </CardContent>
                      </Card>
                    ) : null}
                  </div>

                  {/* Totals */}
                  <Card>
                    <CardContent className="flex flex-col gap-2 p-4">
                      <div className="flex items-center justify-between text-sm">
                        <span className="text-muted-foreground">{t("billing.subtotal")}</span>
                        <span className="font-mono tabular-nums">
                          {formatXaf(summary.itemsSubtotal, activeLocale)}
                        </span>
                      </div>
                      {summary.discountTotal > 0 ? (
                        <div className="flex items-center justify-between text-sm">
                          <span className="text-muted-foreground">{t("billing.discountTotal")}</span>
                          <span className="font-mono tabular-nums">
                            −{formatXaf(summary.discountTotal, activeLocale)}
                          </span>
                        </div>
                      ) : null}
                      <div className="mt-1 flex items-center justify-between border-t border-border pt-2.5">
                        <span className="flex items-center gap-2 text-base font-semibold">
                          <Wallet className="size-4 text-muted-foreground" />
                          {t("billing.grandTotal")}
                        </span>
                        <span className="font-mono text-lg font-semibold tabular-nums">
                          {formatXaf(summary.grandTotal, activeLocale)}
                        </span>
                      </div>
                      {summary.isFullySettled ? (
                        <div
                          className="mt-1 flex items-center justify-center gap-1.5 rounded-md py-1.5 text-xs font-semibold uppercase tracking-wide"
                          style={{
                            color: "var(--status-clearance)",
                            backgroundColor: "color-mix(in oklab, var(--status-clearance) 14%, transparent)",
                          }}
                        >
                          <CheckCircle2 className="size-3.5" />
                          {t("billing.settled")}
                        </div>
                      ) : (
                        <Button className="mt-1.5 w-full" onClick={handleSettle}>
                          <Wallet className="size-4" />
                          {t("billing.settle")}
                        </Button>
                      )}
                    </CardContent>
                  </Card>
                </>
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
  );
}
