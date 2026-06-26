/**
 * Patient register exporters (Phase 19) — browser-only.
 *
 * Consume the same `PatientRegisterRow[]` + `REGISTER_COLUMNS` the on-screen
 * register renders, so a downloaded PDF / spreadsheet / CSV can never drift from
 * what's on screen. The heavy document libs (jsPDF + SheetJS) are imported here,
 * out of the page, so they only load when an export is actually triggered.
 *
 * - PDF  → landscape A4, essential columns only (legible printout).
 * - Excel→ every column, one sheet.
 * - CSV  → every column, RFC-4180 quoted.
 */

import { jsPDF } from "jspdf";
import autoTable from "jspdf-autotable";
import * as XLSX from "xlsx";

import {
  REGISTER_COLUMNS,
  type PatientRegisterRow,
  type RegisterFmtCtx,
} from "./register";
import type { Translate } from "./reports";
import { formatDateTime } from "@/i18n/format";
import type { Locale } from "@/i18n";

function fileStamp(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

function periodText(
  range: { startMs: number; endMs: number },
  t: Translate,
  locale: Locale,
): string {
  if (range.startMs === 0) return t("reports.allTime");
  const fmt = (ms: number) =>
    formatDateTime(ms, locale, { dateStyle: "medium" });
  return `${fmt(range.startMs)} – ${fmt(range.endMs)}`;
}

// ---------------------------------------------------------------------------
// PDF — landscape, essential columns.
// ---------------------------------------------------------------------------

export function exportRegisterPdf(
  rows: PatientRegisterRow[],
  range: { startMs: number; endMs: number },
  generatedAtMs: number,
  t: Translate,
  locale: Locale,
): void {
  const ctx: RegisterFmtCtx = { t, locale };
  const columns = REGISTER_COLUMNS.filter((c) => c.essential);
  const doc = new jsPDF({ unit: "pt", format: "a4", orientation: "landscape" });
  const margin = 28;

  doc.setFontSize(15);
  doc.setTextColor(15, 23, 42);
  doc.text(t("reports.register.exportTitle"), margin, 36);

  doc.setFontSize(9);
  doc.setTextColor(100, 116, 139);
  doc.text(
    `${t("reports.reportingPeriod")}: ${periodText(range, t, locale)}  ·  ${t(
      "reports.generated",
    )}: ${formatDateTime(generatedAtMs, locale, { dateStyle: "medium", timeStyle: "short" })}  ·  ${t(
      "reports.register.count",
      { count: rows.length },
    )}`,
    margin,
    52,
  );

  autoTable(doc, {
    head: [columns.map((c) => t(c.headerKey))],
    body: rows.map((r) => columns.map((c) => c.value(r, ctx))),
    startY: 64,
    margin: { left: margin, right: margin },
    styles: { fontSize: 7, cellPadding: 3, overflow: "linebreak" },
    headStyles: { fillColor: [30, 41, 59], textColor: [248, 250, 252], fontSize: 7 },
    alternateRowStyles: { fillColor: [244, 246, 249] },
  });

  doc.save(`careflow-patient-register-${fileStamp(generatedAtMs)}.pdf`);
}

// ---------------------------------------------------------------------------
// Excel — every column.
// ---------------------------------------------------------------------------

export function exportRegisterXlsx(
  rows: PatientRegisterRow[],
  generatedAtMs: number,
  t: Translate,
  locale: Locale,
): void {
  const ctx: RegisterFmtCtx = { t, locale };
  const header = REGISTER_COLUMNS.map((c) => t(c.headerKey));
  const body = rows.map((r) => REGISTER_COLUMNS.map((c) => c.value(r, ctx)));

  const ws = XLSX.utils.aoa_to_sheet([header, ...body]);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, t("reports.register.sheet"));
  XLSX.writeFile(wb, `careflow-patient-register-${fileStamp(generatedAtMs)}.xlsx`);
}

// ---------------------------------------------------------------------------
// CSV — every column, RFC-4180.
// ---------------------------------------------------------------------------

function csvCell(value: string): string {
  if (/[",\r\n]/.test(value)) return `"${value.replace(/"/g, '""')}"`;
  return value;
}

export function exportRegisterCsv(
  rows: PatientRegisterRow[],
  generatedAtMs: number,
  t: Translate,
  locale: Locale,
): void {
  const ctx: RegisterFmtCtx = { t, locale };
  const header = REGISTER_COLUMNS.map((c) => csvCell(t(c.headerKey)));
  const lines = [header.join(",")];
  for (const r of rows) {
    lines.push(REGISTER_COLUMNS.map((c) => csvCell(c.value(r, ctx))).join(","));
  }
  // Prepend a UTF-8 BOM so accented FR headers/names open correctly in Excel.
  const blob = new Blob(["﻿" + lines.join("\r\n")], {
    type: "text/csv;charset=utf-8;",
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `careflow-patient-register-${fileStamp(generatedAtMs)}.csv`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
