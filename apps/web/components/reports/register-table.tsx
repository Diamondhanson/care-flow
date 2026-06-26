"use client";

/**
 * Patient register table (Phase 19) — the line-by-line hospital register shown
 * inside the Reports tab, alongside (and switchable with) the analytics charts.
 *
 * Filters by period (passed in), status (incl. "currently in hospital"), visit
 * type, department, sex and a name/code search; downloadable as PDF, Excel or
 * CSV. Built entirely from `buildPatientRegister` + `REGISTER_COLUMNS`, so the
 * screen and every export share one source of truth.
 */

import { useMemo, useState } from "react";
import { FileSpreadsheet, FileText, Sheet as SheetIcon, Search } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";
import { useT } from "@/components/locale-provider";
import type { Department, Sex, VisitType } from "@careflow/shared";
import type { DateRange, Translate } from "@/components/reports/reports";
import { SEX_LABEL, VISIT_TYPE_LABEL } from "@/components/reports/reports";
import {
  buildPatientRegister,
  outcomeKey,
  DEFAULT_REGISTER_FILTERS,
  REGISTER_COLUMNS,
  type RegisterFilters,
  type RegisterStatusFilter,
  type PatientRegisterRow,
} from "@/components/reports/register";
import {
  exportRegisterCsv,
  exportRegisterPdf,
  exportRegisterXlsx,
} from "@/components/reports/register-export";

const STATUS_OPTIONS: RegisterStatusFilter[] = [
  "all",
  "in_hospital",
  "open",
  "discharged",
];
const VISIT_TYPES: VisitType[] = ["outpatient", "inpatient", "emergency"];
const SEXES: Sex[] = ["male", "female", "other", "unknown"];

/** Outcome → status-bar accent, reusing the clinical chart palette. */
function outcomeAccent(row: PatientRegisterRow): string {
  switch (outcomeKey(row)) {
    case "reports.register.outcome.deceased":
      return "var(--chart-6)";
    case "reports.register.outcome.discharged":
      return "var(--chart-3)";
    case "reports.register.outcome.cancelled":
      return "var(--muted-foreground)";
    default:
      return "var(--chart-1)"; // in care
  }
}

export function PatientRegister({
  range,
  departments,
  generatedAtMs,
}: {
  range: DateRange;
  departments: Department[];
  generatedAtMs: number;
}) {
  const { t, locale, mounted } = useT();
  const activeLocale = mounted ? locale : "en";
  const tr = t as Translate;

  const [filters, setFilters] = useState<RegisterFilters>(DEFAULT_REGISTER_FILTERS);

  const rows = useMemo(
    () => buildPatientRegister(range, filters),
    [range, filters],
  );

  const ctx = { t: tr, locale: activeLocale };
  const set = <K extends keyof RegisterFilters>(key: K, value: RegisterFilters[K]) =>
    setFilters((f) => ({ ...f, [key]: value }));

  const statusItems: Record<string, string> = Object.fromEntries(
    STATUS_OPTIONS.map((s) => [s, t(`reports.register.statusFilter.${s}`)]),
  );
  const typeItems: Record<string, string> = {
    all: t("reports.register.allTypes"),
    ...Object.fromEntries(VISIT_TYPES.map((v) => [v, t(VISIT_TYPE_LABEL[v])])),
  };
  const deptItems: Record<string, string> = {
    all: t("reports.register.allDepartments"),
    ...Object.fromEntries(departments.map((d) => [d.id, d.name])),
  };
  const sexItems: Record<string, string> = {
    all: t("reports.register.allSexes"),
    ...Object.fromEntries(SEXES.map((s) => [s, t(SEX_LABEL[s])])),
  };

  const disabled = rows.length === 0;

  return (
    <section className="flex flex-col gap-4">
      {/* Filter + export bar */}
      <div className="flex flex-col gap-3 rounded-md border border-border bg-card p-3">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
          <div className="flex flex-wrap items-center gap-2">
            <FilterSelect
              label={t("reports.register.filterStatus")}
              items={statusItems}
              value={filters.status}
              onChange={(v) => set("status", v as RegisterStatusFilter)}
            />
            <FilterSelect
              label={t("reports.register.filterType")}
              items={typeItems}
              value={filters.visitType}
              onChange={(v) => set("visitType", v as VisitType | "all")}
            />
            <FilterSelect
              label={t("reports.register.filterDepartment")}
              items={deptItems}
              value={filters.departmentId}
              onChange={(v) => set("departmentId", v)}
            />
            <FilterSelect
              label={t("reports.register.filterSex")}
              items={sexItems}
              value={filters.sex}
              onChange={(v) => set("sex", v as Sex | "all")}
            />
            <div className="relative">
              <Search className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={filters.query}
                onChange={(e) => set("query", e.target.value)}
                placeholder={t("reports.register.searchPlaceholder")}
                className="h-9 w-48 pl-8"
                aria-label={t("reports.register.searchPlaceholder")}
              />
            </div>
          </div>

          <div className="flex shrink-0 items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              disabled={disabled}
              onClick={() =>
                exportRegisterPdf(rows, range, generatedAtMs, tr, activeLocale)
              }
            >
              <FileText className="size-4" /> {t("reports.pdf")}
            </Button>
            <Button
              variant="outline"
              size="sm"
              disabled={disabled}
              onClick={() => exportRegisterXlsx(rows, generatedAtMs, tr, activeLocale)}
            >
              <FileSpreadsheet className="size-4" /> {t("reports.excel")}
            </Button>
            <Button
              variant="outline"
              size="sm"
              disabled={disabled}
              onClick={() => exportRegisterCsv(rows, generatedAtMs, tr, activeLocale)}
            >
              <SheetIcon className="size-4" /> {t("reports.register.csv")}
            </Button>
          </div>
        </div>
        <p className="text-xs text-muted-foreground">
          {t("reports.register.count", { count: rows.length })}
        </p>
      </div>

      {/* Register table */}
      {rows.length === 0 ? (
        <div className="rounded-md border border-dashed border-border bg-card p-10 text-center">
          <p className="text-sm text-muted-foreground">
            {t("reports.register.empty")}
          </p>
        </div>
      ) : (
        <div className="overflow-x-auto rounded-md border border-border bg-card">
          <table className="w-full border-collapse text-xs">
            <thead>
              <tr className="border-b border-border bg-muted/50">
                {REGISTER_COLUMNS.map((c) => (
                  <th
                    key={c.key}
                    scope="col"
                    className={cn(
                      "whitespace-nowrap px-3 py-2 text-left font-semibold uppercase tracking-wide text-muted-foreground",
                      c.numeric && "text-right",
                    )}
                  >
                    {t(c.headerKey)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr
                  key={row.visitId}
                  className="border-b border-border last:border-0 hover:bg-muted/40"
                >
                  {REGISTER_COLUMNS.map((c) => {
                    const text = c.value(row, ctx);
                    const isOutcome = c.key === "outcome";
                    return (
                      <td
                        key={c.key}
                        title={text}
                        className={cn(
                          "px-3 py-2 align-top",
                          c.numeric
                            ? "text-right font-mono tabular-nums"
                            : "max-w-[200px] truncate",
                        )}
                      >
                        {isOutcome ? (
                          <span className="inline-flex items-center gap-1.5 whitespace-nowrap">
                            <span
                              aria-hidden
                              className="size-2 shrink-0 rounded-full"
                              style={{ backgroundColor: outcomeAccent(row) }}
                            />
                            {text}
                          </span>
                        ) : (
                          text
                        )}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

function FilterSelect({
  label,
  items,
  value,
  onChange,
}: {
  label: string;
  items: Record<string, string>;
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <Select items={items} value={value} onValueChange={(v) => onChange(v as string)}>
      <SelectTrigger size="sm" className="h-9 w-auto min-w-36" aria-label={label}>
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {Object.entries(items).map(([k, v]) => (
          <SelectItem key={k} value={k}>
            {v}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
