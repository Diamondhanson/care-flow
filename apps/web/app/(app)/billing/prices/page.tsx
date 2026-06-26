"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { ArrowLeft, Pencil, Plus, Tag } from "lucide-react";

import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
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
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  createBillableItem,
  getBillableItems,
  updateBillableItem,
} from "@/services/mockStorage";
import { BILLING_CATEGORY_ORDER } from "@/components/billing/billing";
import { useRole } from "@/components/role-provider";
import { useT, type TFunction } from "@/components/locale-provider";
import { formatXaf } from "@/i18n/format";
import { cn } from "@/lib/utils";
import type {
  BillableItem,
  BillingCategory,
  BillingUnit,
} from "@/types/healthcare";

const UNITS: BillingUnit[] = ["per_item", "per_night", "per_day"];

interface DraftState {
  id: string | null;
  category: BillingCategory;
  name: string;
  unit: BillingUnit;
  unit_price: string;
  ref_code: string;
  is_active: boolean;
}

const EMPTY_DRAFT: DraftState = {
  id: null,
  category: "consultation",
  name: "",
  unit: "per_item",
  unit_price: "",
  ref_code: "",
  is_active: true,
};

function ItemDialog({
  draft,
  onClose,
  onSave,
  t,
}: {
  draft: DraftState | null;
  onClose: () => void;
  onSave: (draft: DraftState) => void;
  t: TFunction;
}) {
  const [state, setState] = useState<DraftState>(EMPTY_DRAFT);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (draft) setState(draft);
  }, [draft]);

  const categoryItems = useMemo(() => {
    const entries: Record<string, string> = {};
    for (const c of BILLING_CATEGORY_ORDER) entries[c] = t(`billing.category.${c}`);
    return entries;
  }, [t]);

  const unitItems = useMemo(() => {
    const entries: Record<string, string> = {};
    for (const u of UNITS) entries[u] = t(`billing.unit.${u}`);
    return entries;
  }, [t]);

  const canSave = state.name.trim().length > 0 && Number(state.unit_price) >= 0;

  return (
    <Dialog open={draft !== null} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{state.id ? t("billing.editItem") : t("billing.newItem")}</DialogTitle>
        </DialogHeader>
        <div className="flex flex-col gap-4">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="item-name">{t("billing.fieldName")}</Label>
            <Input
              id="item-name"
              value={state.name}
              onChange={(e) => setState((s) => ({ ...s, name: e.target.value }))}
              placeholder={t("billing.fieldNamePlaceholder")}
            />
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="item-category">{t("billing.fieldCategory")}</Label>
              <Select
                items={categoryItems}
                value={state.category}
                onValueChange={(v) => setState((s) => ({ ...s, category: v as BillingCategory }))}
              >
                <SelectTrigger id="item-category" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {BILLING_CATEGORY_ORDER.map((c) => (
                    <SelectItem key={c} value={c}>
                      {t(`billing.category.${c}`)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="item-unit">{t("billing.fieldUnit")}</Label>
              <Select
                items={unitItems}
                value={state.unit}
                onValueChange={(v) => setState((s) => ({ ...s, unit: v as BillingUnit }))}
              >
                <SelectTrigger id="item-unit" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {UNITS.map((u) => (
                    <SelectItem key={u} value={u}>
                      {t(`billing.unit.${u}`)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="item-price">{t("billing.fieldUnitPrice")}</Label>
            <Input
              id="item-price"
              type="number"
              min={0}
              value={state.unit_price}
              onChange={(e) => setState((s) => ({ ...s, unit_price: e.target.value }))}
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="item-ref">{t("billing.fieldRefCode")}</Label>
            <Input
              id="item-ref"
              value={state.ref_code}
              onChange={(e) => setState((s) => ({ ...s, ref_code: e.target.value }))}
              placeholder={t("billing.fieldRefCodePlaceholder")}
            />
          </div>
          <label className="flex items-center justify-between gap-3 rounded-lg border border-border px-3 py-2.5">
            <span className="text-sm font-medium">{t("billing.fieldActive")}</span>
            <Switch
              checked={state.is_active}
              onCheckedChange={(v) => setState((s) => ({ ...s, is_active: v }))}
            />
          </label>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            {t("billing.cancel")}
          </Button>
          <Button onClick={() => onSave(state)} disabled={!canSave}>
            {t("billing.save")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export default function BillingPricesPage() {
  const { actingRole, mounted: roleMounted } = useRole();
  const { t, locale, mounted } = useT();
  const activeLocale = mounted ? locale : "en";

  const [items, setItems] = useState<BillableItem[] | null>(null);
  const [draft, setDraft] = useState<DraftState | null>(null);

  const allowed = !roleMounted || actingRole === "admin" || actingRole === "receptionist";

  function refresh() {
    setItems(getBillableItems());
  }

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    refresh();
  }, []);

  const grouped = useMemo(() => {
    const byCat = new Map<BillingCategory, BillableItem[]>();
    for (const it of items ?? []) {
      const bucket = byCat.get(it.category);
      if (bucket) bucket.push(it);
      else byCat.set(it.category, [it]);
    }
    return BILLING_CATEGORY_ORDER.map((category) => ({
      category,
      rows: byCat.get(category) ?? [],
    })).filter((g) => g.rows.length > 0);
  }, [items]);

  function handleSave(d: DraftState) {
    const price = Math.max(0, Math.round(Number(d.unit_price) || 0));
    if (d.id) {
      updateBillableItem(d.id, {
        category: d.category,
        name: d.name.trim(),
        unit: d.unit,
        unit_price: price,
        ref_code: d.ref_code.trim() || null,
        is_active: d.is_active,
      });
    } else {
      createBillableItem({
        category: d.category,
        name: d.name.trim(),
        unit: d.unit,
        unit_price: price,
        ref_code: d.ref_code.trim() || null,
        is_active: d.is_active,
      });
    }
    setDraft(null);
    refresh();
  }

  if (roleMounted && !allowed) {
    return (
      <div className="mx-auto max-w-2xl">
        <Card>
          <CardContent className="flex flex-col items-center gap-2 py-12 text-center">
            <Tag className="size-8 text-muted-foreground/60" />
            <p className="text-sm font-medium">{t("billing.pricesTitle")}</p>
            <p className="text-xs text-muted-foreground">{t("billing.accessDenied")}</p>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="mx-auto flex max-w-4xl flex-col gap-6">
      <div className="flex flex-col gap-2">
        <Link
          href="/billing"
          className="inline-flex w-fit items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="size-4" />
          {t("billing.backToBilling")}
        </Link>
        <header className="flex flex-wrap items-start justify-between gap-3">
          <div className="flex flex-col gap-1">
            <h1 className="text-2xl font-semibold tracking-tight">{t("billing.pricesTitle")}</h1>
            <p className="max-w-2xl text-sm text-muted-foreground">{t("billing.pricesSubtitle")}</p>
          </div>
          <Button size="sm" onClick={() => setDraft(EMPTY_DRAFT)}>
            <Plus className="size-4" />
            {t("billing.addItem")}
          </Button>
        </header>
      </div>

      {items === null ? (
        <p className="text-sm text-muted-foreground">{t("billing.loading")}</p>
      ) : items.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center gap-2 py-12 text-center">
            <Tag className="size-8 text-muted-foreground/60" />
            <p className="text-sm font-medium">{t("billing.noItems")}</p>
          </CardContent>
        </Card>
      ) : (
        <div className="flex flex-col gap-5">
          {grouped.map((group) => (
            <section key={group.category} className="flex flex-col gap-2">
              <h2 className="text-[11px] font-semibold uppercase tracking-[0.12em] text-muted-foreground/70">
                {t(`billing.category.${group.category}`)}
              </h2>
              <Card>
                <CardContent className="flex flex-col p-0">
                  {group.rows.map((item) => (
                    <div
                      key={item.id}
                      className="flex items-center gap-3 border-b border-border/60 px-4 py-3 last:border-b-0"
                    >
                      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                        <span className={cn("truncate text-sm", !item.is_active && "text-muted-foreground")}>
                          {item.name}
                        </span>
                        <span className="flex items-center gap-2 text-xs text-muted-foreground">
                          <span>{t(`billing.unit.${item.unit}`)}</span>
                          {item.ref_code ? (
                            <span className="font-mono">{item.ref_code}</span>
                          ) : null}
                          {!item.is_active ? (
                            <Badge variant="outline" className="text-[10px]">
                              {t("billing.inactiveLabel")}
                            </Badge>
                          ) : null}
                        </span>
                      </div>
                      <span className="font-mono text-sm tabular-nums">
                        {formatXaf(item.unit_price, activeLocale)}
                      </span>
                      <Button
                        variant="ghost"
                        size="icon"
                        aria-label={t("billing.editItem")}
                        onClick={() =>
                          setDraft({
                            id: item.id,
                            category: item.category,
                            name: item.name,
                            unit: item.unit,
                            unit_price: String(item.unit_price),
                            ref_code: item.ref_code ?? "",
                            is_active: item.is_active,
                          })
                        }
                      >
                        <Pencil className="size-4" />
                      </Button>
                    </div>
                  ))}
                </CardContent>
              </Card>
            </section>
          ))}
        </div>
      )}

      <ItemDialog draft={draft} onClose={() => setDraft(null)} onSave={handleSave} t={t} />
    </div>
  );
}
