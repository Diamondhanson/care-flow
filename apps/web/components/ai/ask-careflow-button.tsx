"use client";

/**
 * Top-bar launcher for Ask CareFlow (Phase 22, spec §11). Renders nothing
 * when the AI features are disabled, so the flag cleanly removes every AI
 * surface. Uses the CareFlowMark as the signature accent — brand, not
 * clinical meaning.
 */

import { useRouter } from "next/navigation";

import { CareFlowMark } from "@/components/brand/careflow-logo";
import { useT } from "@/components/locale-provider";
import { Button } from "@/components/ui/button";
import { isAiEnabledClient } from "@/lib/ai/api-client";

export function AskCareFlowButton() {
  const { t } = useT();
  const router = useRouter();

  if (!isAiEnabledClient()) return null;

  return (
    <Button
      variant="ghost"
      size="icon"
      aria-label={t("ai.ask.title")}
      title={t("ai.ask.title")}
      onClick={() => router.push("/ask")}
    >
      <CareFlowMark className="size-[1.15rem]" />
    </Button>
  );
}
