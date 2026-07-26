"use client";

import { useEffect, useMemo, useState } from "react";

import { FormDialog } from "@/components/ui/form-dialog";
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
import { BILLING_CATEGORY_ORDER } from "@/components/billing/billing";
import { type TFunction } from "@/components/locale-provider";
import type { BillableItemId, BillingCategory, BillingUnit } from "@careflow/shared";

const UNITS: BillingUnit[] = ["per_item", "per_night", "per_day"];

export interface DraftState {
  id: BillableItemId | null;
  category: BillingCategory;
  name: string;
  unit: BillingUnit;
  unit_price: string;
  ref_code: string;
  is_active: boolean;
}

export const EMPTY_DRAFT: DraftState = {
  id: null,
  category: "consultation",
  name: "",
  unit: "per_item",
  unit_price: "",
  ref_code: "",
  is_active: true,
};

export function ItemDialog({
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
    <FormDialog
      open={draft !== null}
      onOpenChange={(v) => !v && onClose()}
      title={state.id ? t("billing.editItem") : t("billing.newItem")}
      cancelLabel={t("billing.cancel")}
      submitLabel={t("billing.save")}
      onSubmit={() => onSave(state)}
      submitDisabled={!canSave}
    >
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
    </FormDialog>
  );
}
