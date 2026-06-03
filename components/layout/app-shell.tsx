"use client";

import { useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  Activity,
  BarChart3,
  Building2,
  ClipboardPlus,
  FlaskConical,
  GitMerge,
  LayoutDashboard,
  LayoutGrid,
  Menu,
  Pill,
  Users,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";

import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { ThemeToggle } from "@/components/theme-toggle";
import { LocaleToggle } from "@/components/locale-toggle";
import { RoleSwitcher } from "@/components/role-switcher";
import { GlobalSearch } from "@/components/search/global-search";
import { GuidedTour, TourHelpButton } from "@/components/onboarding/guided-tour";
import { SyncStatus } from "@/components/pwa/sync-status";
import { ROLE_LABEL, staffInitials, useRole } from "@/components/role-provider";
import { useT, useLocale } from "@/components/locale-provider";
import { formatDate } from "@/i18n/format";
import type { StaffRole } from "@/types/healthcare";
import {
  Sheet,
  SheetContent,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";

interface NavItem {
  /** i18n key — resolve with `t(item.title)`. */
  title: string;
  href: string;
  icon: LucideIcon;
}

const NAV_ITEMS: NavItem[] = [
  { title: "nav.liveBoard", href: "/", icon: LayoutDashboard },
  { title: "nav.intake", href: "/intake", icon: ClipboardPlus },
  { title: "nav.diagnostics", href: "/diagnostics", icon: FlaskConical },
  { title: "nav.medications", href: "/medications", icon: Pill },
  { title: "nav.reconciliation", href: "/reconciliation", icon: GitMerge },
  { title: "nav.departments", href: "/departments", icon: Building2 },
  { title: "nav.floorMap", href: "/floor-map", icon: LayoutGrid },
  { title: "nav.reports", href: "/reports", icon: BarChart3 },
  { title: "nav.staff", href: "/staff", icon: Users },
];

/**
 * Role-focused navigation (Phase 14) — each role sees only the routes its job
 * needs, cutting perceived complexity without removing any capability. `admin`
 * (and any unmapped role) sees the full menu. The order here is the menu order.
 * Until the client hydrates we render the full menu (see `SidebarBody`), so SSR
 * and first paint stay identical to the seeded-default markup.
 */
const ROLE_NAV: Record<StaffRole, string[]> = {
  // Reception: register arrivals, find a bed, match an emergency record.
  receptionist: ["/", "/intake", "/floor-map", "/reconciliation"],
  // Nurse: the board, medications due, and bed/ward status.
  nurse: ["/", "/medications", "/floor-map"],
  // Doctor: the board (their patients), tests & results, prescribing.
  doctor: ["/", "/diagnostics", "/medications"],
  // Pharmacist: medications and the tests that inform them.
  pharmacist: ["/", "/medications", "/diagnostics"],
  // Lab tech: the diagnostics queue.
  lab_tech: ["/", "/diagnostics"],
  // Admin: full operational menu.
  admin: NAV_ITEMS.map((i) => i.href),
};

/** The nav items visible to a role, in menu order. `null` → full menu. */
function navItemsForRole(role: StaffRole | null): NavItem[] {
  if (!role || role === "admin") return NAV_ITEMS;
  const allowed = new Set(ROLE_NAV[role]);
  return NAV_ITEMS.filter((item) => allowed.has(item.href));
}

function isActive(pathname: string, href: string) {
  return href === "/" ? pathname === "/" : pathname.startsWith(href);
}

function Brand({ compact = false }: { compact?: boolean }) {
  const { t } = useT();
  return (
    <Link href="/" className="flex items-center gap-2.5">
      <span className="flex size-9 items-center justify-center rounded-md bg-primary text-primary-foreground shadow-sm">
        <Activity className="size-5" strokeWidth={2.25} />
      </span>
      {!compact && (
        <div className="flex flex-col leading-none">
          <span className="text-[15px] font-semibold tracking-tight">
            CareFlow
          </span>
          <span className="mt-1 text-[11px] font-medium uppercase tracking-[0.12em] text-muted-foreground">
            {t("shell.statusBoard")}
          </span>
        </div>
      )}
    </Link>
  );
}

function SidebarBody({ onNavigate }: { onNavigate?: () => void }) {
  const pathname = usePathname();
  const { t } = useT();
  const { mounted, actingRole } = useRole();

  // Full menu until hydration keeps SSR + first paint stable; after mount we
  // narrow to the acting role's task-focused subset.
  const items = mounted ? navItemsForRole(actingRole) : NAV_ITEMS;

  return (
    <div className="flex h-full flex-col">
      <div className="flex h-16 items-center px-5">
        <Brand />
      </div>

      <Separator />

      <nav className="flex-1 space-y-0.5 px-3 py-4">
        <p className="px-3 pb-2 text-[11px] font-semibold uppercase tracking-[0.12em] text-muted-foreground/70">
          {t("shell.workspace")}
        </p>
        {items.map((item) => {
          const active = isActive(pathname, item.href);
          const Icon = item.icon;
          return (
            <Link
              key={item.href}
              href={item.href}
              onClick={onNavigate}
              aria-current={active ? "page" : undefined}
              className={cn(
                "group relative flex min-h-11 items-center gap-3 rounded-md px-3 text-sm font-medium transition-colors",
                active
                  ? "bg-accent text-foreground"
                  : "text-muted-foreground hover:bg-accent/60 hover:text-foreground"
              )}
            >
              {active && (
                <span className="absolute left-0 top-1/2 h-5 w-1 -translate-y-1/2 rounded-r-full bg-primary" />
              )}
              <Icon
                className={cn(
                  "size-4 shrink-0 transition-colors",
                  active
                    ? "text-foreground"
                    : "text-muted-foreground group-hover:text-foreground"
                )}
              />
              {t(item.title)}
            </Link>
          );
        })}
      </nav>

      <Separator />

      <ActingStaffCard />
    </div>
  );
}

function ActingStaffCard() {
  const { mounted, actingStaff } = useRole();
  const { t } = useT();

  // Keep markup stable until hydration; the seeded default matches this.
  const name = mounted && actingStaff ? actingStaff.full_name : "Dr. A. Okafor";
  const roleLabel =
    mounted && actingStaff ? t(ROLE_LABEL[actingStaff.role]) : t("roles.doctor");
  const initials = staffInitials(name);

  return (
    <div className="flex items-center gap-3 p-4">
      <Avatar className="size-9 border border-border">
        <AvatarFallback className="bg-secondary text-xs font-semibold">
          {initials}
        </AvatarFallback>
      </Avatar>
      <div className="flex min-w-0 flex-col leading-tight">
        <span className="truncate text-sm font-medium">{name}</span>
        <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <span className="size-1.5 rounded-full bg-[var(--status-clearance)]" />
          {t("shell.onShift")} · {roleLabel}
        </span>
      </div>
    </div>
  );
}

export function AppShell({ children }: { children: React.ReactNode }) {
  const [mobileOpen, setMobileOpen] = useState(false);
  const { t } = useT();
  const { mounted, locale } = useLocale();

  return (
    <div className="flex h-svh overflow-hidden bg-background text-foreground">
      {/* Desktop sidebar — fixed; never scrolls with the content */}
      <aside className="hidden w-64 shrink-0 border-r border-sidebar-border bg-sidebar md:flex md:flex-col">
        <SidebarBody />
      </aside>

      <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
        {/* Top navbar — stays put; only the content below scrolls */}
        <header className="z-30 flex h-16 shrink-0 items-center gap-3 border-b border-border bg-background/80 px-4 backdrop-blur-sm md:px-8">
          {/* Mobile: hamburger + brand */}
          <div className="flex items-center gap-2 md:hidden">
            <Sheet open={mobileOpen} onOpenChange={setMobileOpen}>
              <SheetTrigger
                render={
                  <Button
                    variant="ghost"
                    size="icon"
                    aria-label={t("shell.openMenu")}
                  />
                }
              >
                <Menu className="size-5" />
              </SheetTrigger>
              <SheetContent
                side="left"
                className="w-64 bg-sidebar p-0"
                showCloseButton={false}
              >
                <SheetTitle className="sr-only">{t("shell.navigation")}</SheetTitle>
                <SidebarBody onNavigate={() => setMobileOpen(false)} />
              </SheetContent>
            </Sheet>
            <Brand compact />
          </div>

          {/* Desktop: facility context. `min-w-0` lets this flex item shrink
              when the header is tight; `truncate` on each line keeps the text
              clipped inside the box instead of spilling onto the search. */}
          <div className="hidden min-w-0 flex-col leading-tight md:flex">
            <span className="truncate text-sm font-medium tracking-tight">
              {t("shell.facility")}
            </span>
            <span className="truncate text-xs text-muted-foreground">
              {t("shell.liveOperations")}
            </span>
          </div>

          <GlobalSearch />

          <div className="ml-auto flex items-center gap-3">
            <span className="hidden text-xs font-medium tabular-nums text-muted-foreground sm:inline">
              {formatDate(new Date(), mounted ? locale : "en", {
                weekday: "short",
                month: "short",
                day: "numeric",
              })}
            </span>
            <Separator orientation="vertical" className="hidden h-5 sm:block" />
            <SyncStatus />
            <RoleSwitcher />
            <TourHelpButton />
            <LocaleToggle />
            <ThemeToggle />
          </div>
        </header>

        <main className="min-h-0 flex-1 overflow-y-auto p-4 md:p-8">{children}</main>
      </div>

      <GuidedTour />
    </div>
  );
}
