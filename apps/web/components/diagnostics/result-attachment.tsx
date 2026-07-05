"use client";

/**
 * ResultAttachment — a view link for a private clinical file (Block B / #5).
 *
 * Result attachments live in the private `lab-results` bucket, so there's no
 * public URL: clicking mints a short-lived signed URL (RLS-scoped to the staff
 * member's hospital) and opens it in a new tab. Manages its own loading/error
 * state so it can be dropped into any list of results.
 */

import { useState } from "react";
import { FileText, Loader2 } from "lucide-react";

import { useT } from "@/components/locale-provider";
import {
  createSignedDownloadUrl,
  LAB_RESULTS_BUCKET,
} from "@/lib/supabase/storage";

export function ResultAttachment({ path }: { path: string }) {
  const { t } = useT();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(false);

  async function handleView() {
    if (loading) return;
    setLoading(true);
    setError(false);
    try {
      const url = await createSignedDownloadUrl(LAB_RESULTS_BUCKET, path);
      window.open(url, "_blank", "noopener,noreferrer");
    } catch {
      setError(true);
    } finally {
      setLoading(false);
    }
  }

  return (
    <button
      type="button"
      onClick={handleView}
      disabled={loading}
      className="inline-flex items-center gap-1 font-mono text-[11px] text-muted-foreground underline-offset-2 hover:text-foreground hover:underline disabled:opacity-60"
    >
      {loading ? (
        <Loader2 className="size-3 animate-spin" />
      ) : (
        <FileText className="size-3" />
      )}
      {error ? t("diagnostics.attachmentViewFailed") : t("diagnostics.attachmentView")}
    </button>
  );
}
