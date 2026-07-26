"use client";

import { Trash2, X } from "lucide-react";

import { Button } from "@/components/ui/button";

/** A trash button that arms a two-step confirm in place (no modal), so a single
 *  mis-click can't delete a mistaken order / prescription. */
export function DeleteControl({
  armed,
  onArm,
  onCancel,
  onConfirm,
  label,
  confirmLabel,
  cancelLabel,
}: {
  armed: boolean;
  onArm: () => void;
  onCancel: () => void;
  onConfirm: () => void;
  label: string;
  confirmLabel: string;
  cancelLabel: string;
}) {
  if (armed) {
    return (
      <span className="flex shrink-0 items-center gap-1">
        <Button
          variant="destructive"
          size="sm"
          className="h-7 px-2 text-xs"
          onClick={onConfirm}
        >
          {confirmLabel}
        </Button>
        <Button
          variant="ghost"
          size="icon"
          className="size-7"
          onClick={onCancel}
          aria-label={cancelLabel}
        >
          <X className="size-3.5" />
        </Button>
      </span>
    );
  }
  return (
    <Button
      variant="ghost"
      size="icon"
      className="size-7 shrink-0 text-muted-foreground hover:text-destructive"
      onClick={onArm}
      aria-label={label}
    >
      <Trash2 className="size-3.5" />
    </Button>
  );
}
