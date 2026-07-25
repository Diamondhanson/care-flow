"use client";

import type * as React from "react";
import { Loader2 } from "lucide-react";

import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";

/**
 * Small standard wrapper over the Dialog primitives for form-style dialogs:
 * title, optional description, fields (children), an inline error slot, and a
 * cancel + submit footer. Mirrors the shape of the form sheets/dialogs in
 * `app/(app)/departments/page.tsx` and `app/(app)/floor-map/page.tsx` so those
 * pages can adopt it with a minimal diff.
 *
 * The fields are wrapped in a real `<form>`, so pressing Enter in an input
 * submits. `onSubmit` may be async — while `submitting` is true both buttons
 * are disabled and the submit button shows a spinner.
 */
export function FormDialog({
  open,
  onOpenChange,
  title,
  description,
  children,
  error,
  cancelLabel,
  submitLabel,
  onSubmit,
  submitDisabled = false,
  submitting = false,
  submitVariant = "default",
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: React.ReactNode;
  description?: React.ReactNode;
  /** Form fields. */
  children?: React.ReactNode;
  /** Inline error message shown above the footer, or null/undefined for none. */
  error?: string | null;
  cancelLabel: string;
  submitLabel: React.ReactNode;
  onSubmit: () => void | Promise<void>;
  /** Disables the submit button (e.g. required fields missing). */
  submitDisabled?: boolean;
  /** Marks an in-flight submit — disables the footer and shows a spinner. */
  submitting?: boolean;
  /** Use "destructive" for closing/destructive confirmations. */
  submitVariant?: "default" | "destructive";
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          {description ? (
            <DialogDescription>{description}</DialogDescription>
          ) : null}
        </DialogHeader>
        <form
          className="flex flex-col gap-4"
          onSubmit={(e) => {
            e.preventDefault();
            if (submitting || submitDisabled) return;
            void onSubmit();
          }}
        >
          {children}
          {error ? (
            <p
              role="alert"
              className="rounded-lg bg-destructive/10 p-3 text-sm text-destructive"
            >
              {error}
            </p>
          ) : null}
          <DialogFooter>
            <Button
              type="button"
              variant="ghost"
              disabled={submitting}
              onClick={() => onOpenChange(false)}
            >
              {cancelLabel}
            </Button>
            <Button
              type="submit"
              variant={submitVariant}
              disabled={submitDisabled || submitting}
            >
              {submitting ? <Loader2 className="size-4 animate-spin" /> : null}
              {submitLabel}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
