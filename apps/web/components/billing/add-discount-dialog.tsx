"use client";

import { useState } from "react";

import { FormDialog } from "@/components/ui/form-dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { type TFunction } from "@/components/locale-provider";

// ---------------------------------------------------------------------------
// Add discount dialog
// ---------------------------------------------------------------------------

export function AddDiscountDialog({
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
    <FormDialog
      open={open}
      onOpenChange={(v) => { if (!v) reset(); onOpenChange(v); }}
      title={t("billing.addDiscountTitle")}
      cancelLabel={t("billing.cancel")}
      submitLabel={t("billing.save")}
      onSubmit={submit}
      submitDisabled={!(Number(amount) > 0)}
    >
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
    </FormDialog>
  );
}
