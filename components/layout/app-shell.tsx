"use client";

import { useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  Activity,
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
import { RoleSwitcher } from "@/components/role-switcher";
import { ROLE_LABEL, staffInitials, useRole } from "@/components/role-provider";
import {
  Sheet,
  SheetContent,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";

interface NavItem {
  title: string;
  href: string;
  icon: LucideIcon;
}

const NAV_ITEMS: NavItem[] = [
  { title: "Live Board", href: "/", icon: LayoutDashboard },
  { title: "Patient Intake", href: "/intake", icon: ClipboardPlus },
  { title: "Diagnostics", href: "/diagnostics", icon: FlaskConical },
  { title: "Medications", href: "/medications", icon: Pill },
  { title: "Reconciliation", href: "/reconciliation", icon: GitMerge },
  { title: "Departments", href: "/departments", icon: Building2 },
  { title: "Floor Map", href: "/floor-map", icon: LayoutGrid },
  { title: "Staff Directory", href: "/staff", icon: Users },
];

function isActive(pathname: string, href: string) {
  return href === "/" ? pathname === "/" : pathname.startsWith(href);
}

function Brand({ compact = false }: { compact?: boolean }) {
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
            Status Board
          </span>
        </div>
      )}
    </Link>
  );
}

function SidebarBody({ onNavigate }: { onNavigate?: () => void }) {
  const pathname = usePathname();

  return (
    <div className="flex h-full flex-col">
      <div className="flex h-16 items-center px-5">
        <Brand />
      </div>

      <Separator />

      <nav className="flex-1 space-y-0.5 px-3 py-4">
        <p className="px-3 pb-2 text-[11px] font-semibold uppercase tracking-[0.12em] text-muted-foreground/70">
          Workspace
        </p>
        {NAV_ITEMS.map((item) => {
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
              {item.title}
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

  // Keep markup stable until hydration; the seeded default matches this.
  const name = mounted && actingStaff ? actingStaff.full_name : "Dr. A. Okafor";
  const roleLabel =
    mounted && actingStaff ? ROLE_LABEL[actingStaff.role] : "Doctor";
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
          On shift · {roleLabel}
        </span>
      </div>
    </div>
  );
}

export function AppShell({ children }: { children: React.ReactNode }) {
  const [mobileOpen, setMobileOpen] = useState(false);

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
                  <Button variant="ghost" size="icon" aria-label="Open menu" />
                }
              >
                <Menu className="size-5" />
              </SheetTrigger>
              <SheetContent
                side="left"
                className="w-64 bg-sidebar p-0"
                showCloseButton={false}
              >
                <SheetTitle className="sr-only">Navigation</SheetTitle>
                <SidebarBody onNavigate={() => setMobileOpen(false)} />
              </SheetContent>
            </Sheet>
            <Brand compact />
          </div>

          {/* Desktop: facility context */}
          <div className="hidden min-w-0 flex-col leading-tight md:flex">
            <span className="text-sm font-medium tracking-tight">
              General Hospital
            </span>
            <span className="text-xs text-muted-foreground">
              Live operations
            </span>
          </div>

          <div className="ml-auto flex items-center gap-3">
            <span className="hidden text-xs font-medium tabular-nums text-muted-foreground sm:inline">
              {new Date().toLocaleDateString("en-US", {
                weekday: "short",
                month: "short",
                day: "numeric",
              })}
            </span>
            <Separator orientation="vertical" className="hidden h-5 sm:block" />
            <RoleSwitcher />
            <ThemeToggle />
          </div>
        </header>

        <main className="min-h-0 flex-1 overflow-y-auto p-4 md:p-8">{children}</main>
      </div>
    </div>
  );
}
