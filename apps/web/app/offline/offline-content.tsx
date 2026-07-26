"use client";

/**
 * Client half of the offline fallback page. The copy is translated with useT(),
 * which needs the client (the locale preference lives in localStorage). useT
 * resolves to DEFAULT_LOCALE until the LocaleProvider mounts, so server and
 * first-paint markup stay identical (AGENTS.md hydration discipline) — no extra
 * mount guard is needed here.
 */

import Link from "next/link";
import { CloudOff } from "lucide-react";

import { Card, CardContent } from "@/components/ui/card";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { useT } from "@/components/locale-provider";

export function OfflineContent() {
  const { t } = useT();
  return (
    <Card className="w-full max-w-md text-center">
      <CardContent className="flex flex-col items-center gap-4 py-10">
        <span className="flex size-14 items-center justify-center rounded-full bg-muted text-muted-foreground">
          <CloudOff className="size-7" aria-hidden />
        </span>
        <div className="space-y-1.5">
          <h1 className="text-lg font-semibold tracking-tight text-foreground">
            {t("offline.title")}
          </h1>
          <p className="text-sm text-muted-foreground">{t("offline.body")}</p>
        </div>
        <Link
          href="/dashboard"
          className={cn(buttonVariants({ variant: "default" }), "mt-1")}
        >
          {t("offline.backToBoard")}
        </Link>
      </CardContent>
    </Card>
  );
}
