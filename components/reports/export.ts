/**
 * Reporting exporters (Phase 12) — browser-only.
 *
 * Both exporters consume the same `FullReport` the dashboard renders, so the
 * numbers in a downloaded PDF / spreadsheet can never drift from what's on
 * screen. Nothing here touches persistence or React; it's pure formatting plus
 * the third-party document builders (jsPDF + SheetJS), kept out of the page so
 * the heavy libs only load when an export is actually triggered.
 */

import { jsPDF } from "jspdf";
import autoTable from "jspdf-autotable";
import * as XLSX from "xlsx";

import {
  CHART_RGB,
  sliceLabel,
  type CountSlice,
  type FullReport,
  type TimeBucket,
  type Translate,
  type WardOccupancyRow,
} from "./reports";
import { formatDate, formatDateTime } from "@/i18n/format";
import type { Locale } from "@/i18n";

// jsPDF gains `lastAutoTable` once the autotable plugin draws a table.
type DocWithAutoTable = jsPDF & { lastAutoTable?: { finalY: number } };

const PAGE_MARGIN = 40;

function fmtDateTime(ms: number, locale: Locale): string {
  return formatDateTime(ms, locale, { dateStyle: "medium", timeStyle: "short" });
}

function fmtDate(ms: number, locale: Locale): string {
  return formatDate(ms, locale, { dateStyle: "medium" });
}

function rangeText(report: FullReport, t: Translate, locale: Locale): string {
  if (report.range.startMs === 0) return t("reports.allTime");
  return `${fmtDate(report.range.startMs, locale)} – ${fmtDate(report.range.endMs, locale)}`;
}

/** Localize a slice array's labels for export tables/charts. */
function locSlices(slices: CountSlice[], t: Translate): CountSlice[] {
  return slices.map((s) => ({ ...s, label: sliceLabel(s, t) }));
}

function fileStamp(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

// ---------------------------------------------------------------------------
// PDF
// ---------------------------------------------------------------------------

interface KpiCell {
  label: string;
  value: string;
}

function kpiCells(report: FullReport, t: Translate): KpiCell[] {
  const k = report.kpis;
  return [
    { label: t("reports.kpi.totalVisits"), value: String(k.totalVisits) },
    { label: t("reports.kpi.uniquePatients"), value: String(k.uniquePatients) },
    { label: t("reports.kpi.outpatient"), value: String(k.outpatient) },
    { label: t("reports.kpi.inpatient"), value: String(k.inpatient) },
    { label: t("reports.kpi.emergency"), value: String(k.emergency) },
    { label: t("reports.kpi.admissions"), value: String(k.admissionsStarted) },
    { label: t("reports.kpi.discharges"), value: String(k.discharges) },
    { label: t("reports.kpi.deaths"), value: String(k.deaths) },
    { label: t("reports.kpi.currentInpatients"), value: String(k.currentInpatients) },
    { label: t("reports.kpi.bedOccupancy"), value: `${k.bedOccupancyPct}%` },
    { label: t("reports.kpi.avgLos"), value: k.avgLosDays == null ? "—" : `${k.avgLosDays}d` },
  ];
}

/** Draw a compact grid of KPI tiles. Returns the Y below the grid. */
function drawKpiGrid(doc: jsPDF, cells: KpiCell[], startY: number): number {
  const pageW = doc.internal.pageSize.getWidth();
  const cols = 5;
  const gap = 8;
  const gridW = pageW - PAGE_MARGIN * 2;
  const tileW = (gridW - gap * (cols - 1)) / cols;
  const tileH = 46;
  let y = startY;

  cells.forEach((cell, i) => {
    const col = i % cols;
    const rowIdx = Math.floor(i / cols);
    const x = PAGE_MARGIN + col * (tileW + gap);
    const ty = startY + rowIdx * (tileH + gap);

    doc.setFillColor(244, 246, 249);
    doc.setDrawColor(226, 232, 240);
    doc.roundedRect(x, ty, tileW, tileH, 4, 4, "FD");

    doc.setFontSize(7);
    doc.setTextColor(100, 116, 139);
    doc.text(cell.label.toUpperCase(), x + 8, ty + 16);

    doc.setFontSize(16);
    doc.setTextColor(15, 23, 42);
    doc.text(cell.value, x + 8, ty + 36);

    y = ty + tileH;
  });

  return y;
}

/** Horizontal colored bar chart for a categorical breakdown. Returns Y below. */
function drawBarChart(
  doc: jsPDF,
  title: string,
  slices: CountSlice[],
  startY: number,
): number {
  const pageW = doc.internal.pageSize.getWidth();
  const chartW = pageW - PAGE_MARGIN * 2;
  const labelW = 150;
  const barMaxW = chartW - labelW - 50;
  const rowH = 18;
  const max = Math.max(1, ...slices.map((s) => s.value));

  doc.setFontSize(11);
  doc.setTextColor(15, 23, 42);
  doc.text(title, PAGE_MARGIN, startY);
  let y = startY + 14;

  slices.forEach((slice, i) => {
    const [r, g, b] = CHART_RGB[i % CHART_RGB.length];
    const barW = Math.max(2, (slice.value / max) * barMaxW);

    doc.setFontSize(8);
    doc.setTextColor(51, 65, 85);
    const label = slice.label.length > 34 ? `${slice.label.slice(0, 33)}…` : slice.label;
    doc.text(label, PAGE_MARGIN, y + 9);

    doc.setFillColor(r, g, b);
    doc.roundedRect(PAGE_MARGIN + labelW, y, barW, 11, 2, 2, "F");

    doc.setTextColor(71, 85, 105);
    doc.text(String(slice.value), PAGE_MARGIN + labelW + barW + 6, y + 9);

    y += rowH;
  });

  return y + 4;
}

function table(
  doc: jsPDF,
  head: string[],
  body: (string | number)[][],
  startY: number,
): number {
  autoTable(doc, {
    head: [head],
    body,
    startY,
    margin: { left: PAGE_MARGIN, right: PAGE_MARGIN },
    styles: { fontSize: 8, cellPadding: 4 },
    headStyles: { fillColor: [30, 41, 59], textColor: [248, 250, 252] },
    alternateRowStyles: { fillColor: [244, 246, 249] },
  });
  return (doc as DocWithAutoTable).lastAutoTable?.finalY ?? startY;
}

function ensureSpace(doc: jsPDF, y: number, needed: number): number {
  const pageH = doc.internal.pageSize.getHeight();
  if (y + needed > pageH - PAGE_MARGIN) {
    doc.addPage();
    return PAGE_MARGIN;
  }
  return y;
}

function sectionTitle(doc: jsPDF, text: string, y: number): number {
  doc.setFontSize(13);
  doc.setTextColor(15, 23, 42);
  doc.text(text, PAGE_MARGIN, y);
  return y + 16;
}

function sliceRows(slices: CountSlice[], t: Translate): (string | number)[][] {
  return slices.map((s) => [sliceLabel(s, t), s.value]);
}

export function exportReportPdf(report: FullReport, t: Translate, locale: Locale): void {
  const doc = new jsPDF({ unit: "pt", format: "a4" });
  const pageW = doc.internal.pageSize.getWidth();

  // Header
  doc.setFontSize(20);
  doc.setTextColor(15, 23, 42);
  doc.text(t("reports.exportTitle"), PAGE_MARGIN, 50);
  doc.setFontSize(10);
  doc.setTextColor(100, 116, 139);
  doc.text(
    `${t("reports.reportingPeriod")}: ${rangeText(report, t, locale)}  ·  ${t("reports.generated")} ${fmtDateTime(report.generatedAtMs, locale)}`,
    PAGE_MARGIN,
    68,
  );
  doc.setDrawColor(226, 232, 240);
  doc.line(PAGE_MARGIN, 78, pageW - PAGE_MARGIN, 78);

  let y = drawKpiGrid(doc, kpiCells(report, t), 92) + 24;

  // Visual breakdowns (colored bars)
  y = ensureSpace(doc, y, 120);
  y = drawBarChart(doc, t("reports.visitsByType"), locSlices(report.visitTypeMix, t), y) + 8;
  y = ensureSpace(doc, y, 140);
  y = drawBarChart(doc, t("reports.chart.departmentThroughput"), locSlices(report.departmentThroughput, t), y) + 8;
  y = ensureSpace(doc, y, 160);
  y = drawBarChart(doc, t("reports.chart.topDiagnoses"), locSlices(report.topDiagnoses, t), y) + 12;

  // Tabular detail
  const sections: { title: string; head: string[]; body: (string | number)[][] }[] = [
    {
      title: t("reports.sheet.visitsOverTime"),
      head: [
        t("reports.table.period"),
        t("reports.table.outpatient"),
        t("reports.table.inpatient"),
        t("reports.table.emergency"),
        t("reports.table.total"),
      ],
      body: report.visitsOverTime.map((b: TimeBucket) => [
        formatDate(`${b.key}T00:00:00.000Z`, locale, {
          month: "short",
          day: "numeric",
          timeZone: "UTC",
        }),
        b.outpatient,
        b.inpatient,
        b.emergency,
        b.total,
      ]),
    },
    {
      title: t("reports.chart.lengthOfStay"),
      head: [t("reports.table.band"), t("reports.table.discharges")],
      body: sliceRows(report.los.buckets, t),
    },
    {
      title: t("reports.chart.wardOccupancy"),
      head: [
        t("reports.table.ward"),
        t("reports.table.totalBeds"),
        t("reports.table.occupied"),
        t("reports.table.free"),
        t("reports.table.occupancyPct"),
      ],
      body: report.wardOccupancy.map((w: WardOccupancyRow) => [
        w.ward,
        w.total,
        w.occupied,
        w.free,
        `${w.pct}%`,
      ]),
    },
    {
      title: t("reports.chart.openByStage"),
      head: [t("reports.table.stage"), t("reports.table.visits")],
      body: sliceRows(report.stageDistribution, t),
    },
    {
      title: t("reports.chart.outcomes"),
      head: [t("reports.table.outcome"), t("reports.table.visits")],
      body: sliceRows(report.outcomes, t),
    },
    {
      title: t("reports.table.abnormal"),
      head: [t("reports.table.outcome"), t("reports.table.count")],
      body: [
        [t("reports.table.abnormal"), report.abnormal.abnormal],
        [t("reports.table.normal"), report.abnormal.normal],
        [t("reports.table.abnormalRate"), `${report.abnormal.pct}%`],
      ],
    },
    {
      title: t("reports.chart.patientsBySex"),
      head: [t("reports.table.sex"), t("reports.table.patients")],
      body: sliceRows(report.sexMix, t),
    },
    {
      title: t("reports.chart.patientsByAge"),
      head: [t("reports.table.ageBand"), t("reports.table.patients")],
      body: sliceRows(report.ageDistribution, t),
    },
    {
      title: t("reports.chart.clearanceBottlenecks"),
      head: [t("reports.table.gate"), t("reports.table.pending")],
      body: sliceRows(report.clearanceBottlenecks, t),
    },
  ];

  for (const section of sections) {
    if (section.body.length === 0) continue;
    y = ensureSpace(doc, y + 14, 90);
    y = sectionTitle(doc, section.title, y);
    y = table(doc, section.head, section.body, y);
  }

  // Page numbers
  const pages = doc.getNumberOfPages();
  for (let p = 1; p <= pages; p += 1) {
    doc.setPage(p);
    doc.setFontSize(8);
    doc.setTextColor(148, 163, 184);
    doc.text(
      t("reports.pageOf", { p, total: pages }),
      pageW - PAGE_MARGIN,
      doc.internal.pageSize.getHeight() - 20,
      { align: "right" },
    );
  }

  doc.save(`careflow-report-${fileStamp(report.generatedAtMs)}.pdf`);
}

// ---------------------------------------------------------------------------
// Excel (SheetJS)
// ---------------------------------------------------------------------------

function sliceSheet(
  slices: CountSlice[],
  t: Translate,
  valueHeader: string,
): XLSX.WorkSheet {
  const category = t("reports.table.category");
  return XLSX.utils.json_to_sheet(
    slices.map((s) => ({ [category]: sliceLabel(s, t), [valueHeader]: s.value })),
  );
}

export function exportReportXlsx(report: FullReport, t: Translate, locale: Locale): void {
  const wb = XLSX.utils.book_new();

  // Summary
  const k = report.kpis;
  const summary = [
    [t("reports.exportTitle")],
    [t("reports.reportingPeriod"), rangeText(report, t, locale)],
    [t("reports.generated"), fmtDateTime(report.generatedAtMs, locale)],
    [],
    [t("reports.metric"), t("reports.value")],
    [t("reports.kpi.totalVisits"), k.totalVisits],
    [t("reports.kpi.uniquePatients"), k.uniquePatients],
    [t("reports.kpi.outpatient"), k.outpatient],
    [t("reports.kpi.inpatient"), k.inpatient],
    [t("reports.kpi.emergency"), k.emergency],
    [t("reports.kpi.admissionsStarted"), k.admissionsStarted],
    [t("reports.kpi.discharges"), k.discharges],
    [t("reports.kpi.deaths"), k.deaths],
    [t("reports.kpi.currentInpatients"), k.currentInpatients],
    [`${t("reports.kpi.bedOccupancy")} %`, k.bedOccupancyPct],
    [t("reports.kpi.avgLos"), k.avgLosDays ?? "—"],
    [t("reports.kpi.medianLos"), report.los.medianDays ?? "—"],
  ];
  XLSX.utils.book_append_sheet(
    wb,
    XLSX.utils.aoa_to_sheet(summary),
    t("reports.sheet.summary"),
  );

  XLSX.utils.book_append_sheet(
    wb,
    XLSX.utils.json_to_sheet(
      report.visitsOverTime.map((b) => ({
        [t("reports.table.period")]: formatDate(`${b.key}T00:00:00.000Z`, locale, {
          month: "short",
          day: "numeric",
          timeZone: "UTC",
        }),
        [t("reports.table.outpatient")]: b.outpatient,
        [t("reports.table.inpatient")]: b.inpatient,
        [t("reports.table.emergency")]: b.emergency,
        [t("reports.table.total")]: b.total,
      })),
    ),
    t("reports.sheet.visitsOverTime"),
  );

  XLSX.utils.book_append_sheet(
    wb,
    sliceSheet(report.visitTypeMix, t, t("reports.table.visits")),
    t("reports.sheet.visitTypes"),
  );
  XLSX.utils.book_append_sheet(
    wb,
    sliceSheet(report.departmentThroughput, t, t("reports.table.visits")),
    t("reports.sheet.departments"),
  );
  XLSX.utils.book_append_sheet(
    wb,
    sliceSheet(report.topDiagnoses, t, t("reports.table.cases")),
    t("reports.sheet.topDiagnoses"),
  );
  XLSX.utils.book_append_sheet(
    wb,
    sliceSheet(report.los.buckets, t, t("reports.table.discharges")),
    t("reports.sheet.lengthOfStay"),
  );

  XLSX.utils.book_append_sheet(
    wb,
    XLSX.utils.json_to_sheet(
      report.wardOccupancy.map((w) => ({
        [t("reports.table.ward")]: w.ward,
        [t("reports.table.totalBeds")]: w.total,
        [t("reports.table.occupied")]: w.occupied,
        [t("reports.table.free")]: w.free,
        [t("reports.table.occupancyPct")]: w.pct,
      })),
    ),
    t("reports.sheet.wardOccupancy"),
  );
  XLSX.utils.book_append_sheet(
    wb,
    sliceSheet(report.stageDistribution, t, t("reports.table.visits")),
    t("reports.sheet.careStages"),
  );
  XLSX.utils.book_append_sheet(
    wb,
    sliceSheet(report.outcomes, t, t("reports.table.visits")),
    t("reports.sheet.outcomes"),
  );
  XLSX.utils.book_append_sheet(
    wb,
    sliceSheet(report.sexMix, t, t("reports.table.patients")),
    t("reports.sheet.sexMix"),
  );
  XLSX.utils.book_append_sheet(
    wb,
    sliceSheet(report.ageDistribution, t, t("reports.table.patients")),
    t("reports.sheet.ageMix"),
  );
  XLSX.utils.book_append_sheet(
    wb,
    sliceSheet(report.clearanceBottlenecks, t, t("reports.table.pending")),
    t("reports.sheet.clearanceGates"),
  );

  XLSX.writeFile(wb, `careflow-report-${fileStamp(report.generatedAtMs)}.xlsx`);
}
