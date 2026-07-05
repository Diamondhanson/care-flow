"use client";

/**
 * Marketing chrome — the public shell for the landing, login and signup pages.
 * Deliberately minimal: brand + theme/locale toggles + a sign-in link. No
 * {@link AppShell}, no auth guard — these routes are reachable signed-out.
 */

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Activity } from "lucide-react";

import { buttonVariants } from "@/components/ui/button";
import { ThemeToggle } from "@/components/theme-toggle";
import { LocaleToggle } from "@/components/locale-toggle";
import { useT } from "@/components/locale-provider";
import { cn } from "@/lib/utils";

function MarketingBrand() {
  return (
    <Link href="/" className="flex items-center gap-2.5">
      <span className="flex size-9 items-center justify-center rounded-md bg-primary text-primary-foreground shadow-sm">
        <Activity className="size-5" strokeWidth={2.25} />
      </span>
      <span className="text-[15px] font-semibold tracking-tight">CareFlow</span>
    </Link>
  );
}

export default function MarketingLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const { t } = useT();
  const pathname = usePathname();
  const onLogin = pathname === "/login";

  return (
    <div className="flex min-h-svh flex-col bg-background text-foreground">
      <header className="sticky top-0 z-30 flex h-16 shrink-0 items-center gap-3 border-b border-border bg-background/80 px-4 backdrop-blur-sm md:px-8">
        <MarketingBrand />
        <div className="ml-auto flex items-center gap-2">
          <LocaleToggle />
          <ThemeToggle />
          <Link
            href={onLogin ? "/signup" : "/login"}
            className={cn(buttonVariants({ variant: "outline", size: "sm" }))}
          >
            {onLogin ? t("marketing.getStarted") : t("marketing.signIn")}
          </Link>
        </div>
      </header>

      <main className="flex-1">{children}</main>
    </div>
  );
}
