"use client";

import { useMemo, useState } from "react";

import { FormDialog } from "@/components/ui/form-dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { type TFunction } from "@/components/locale-provider";
import { formatXaf } from "@/i18n/format";
import { cn } from "@/lib/utils";
import type { BillableItem, BillableItemId } from "@/types/healthcare";

// ---------------------------------------------------------------------------
// Add charge dialog
// ---------------------------------------------------------------------------

export function AddChargeDialog({
  open,
  onOpenChange,
  catalog,
  onSubmit,
  t,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  catalog: BillableItem[];
  onSubmit: (input: { billableItemId: BillableItemId | null; description: string; quantity: number; unitPrice: number }) => void;
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
      // The select's value is a raw DOM string; brand it at this boundary.
      onSubmit({ billableItemId: itemId as BillableItemId, description: "", quantity: qty, unitPrice: NaN });
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
    <FormDialog
      open={open}
      onOpenChange={(v) => { if (!v) reset(); onOpenChange(v); }}
      title={t("billing.addChargeTitle")}
      description={t("billing.recalcHint")}
      cancelLabel={t("billing.cancel")}
      submitLabel={t("billing.save")}
      onSubmit={submit}
      submitDisabled={!canSubmit}
    >
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
    </FormDialog>
  );
}
