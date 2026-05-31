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
  type CountSlice,
  type FullReport,
  type TimeBucket,
  type WardOccupancyRow,
} from "./reports";

// jsPDF gains `lastAutoTable` once the autotable plugin draws a table.
type DocWithAutoTable = jsPDF & { lastAutoTable?: { finalY: number } };

const PAGE_MARGIN = 40;

function fmtDateTime(ms: number): string {
  return new Date(ms).toLocaleString("en-US", {
    dateStyle: "medium",
    timeStyle: "short",
  });
}

function fmtDate(ms: number): string {
  return new Date(ms).toLocaleDateString("en-US", { dateStyle: "medium" });
}

function rangeText(report: FullReport): string {
  if (report.range.startMs === 0) return "All time";
  return `${fmtDate(report.range.startMs)} – ${fmtDate(report.range.endMs)}`;
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

function kpiCells(report: FullReport): KpiCell[] {
  const k = report.kpis;
  return [
    { label: "Total visits", value: String(k.totalVisits) },
    { label: "Unique patients", value: String(k.uniquePatients) },
    { label: "Outpatient", value: String(k.outpatient) },
    { label: "Inpatient", value: String(k.inpatient) },
    { label: "Emergency", value: String(k.emergency) },
    { label: "Admissions", value: String(k.admissionsStarted) },
    { label: "Discharges", value: String(k.discharges) },
    { label: "Current inpatients", value: String(k.currentInpatients) },
    { label: "Bed occupancy", value: `${k.bedOccupancyPct}%` },
    { label: "Avg length of stay", value: k.avgLosDays == null ? "—" : `${k.avgLosDays}d` },
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

function sliceRows(slices: CountSlice[]): (string | number)[][] {
  return slices.map((s) => [s.label, s.value]);
}

export function exportReportPdf(report: FullReport): void {
  const doc = new jsPDF({ unit: "pt", format: "a4" });
  const pageW = doc.internal.pageSize.getWidth();

  // Header
  doc.setFontSize(20);
  doc.setTextColor(15, 23, 42);
  doc.text("CareFlow — Hospital Operations Report", PAGE_MARGIN, 50);
  doc.setFontSize(10);
  doc.setTextColor(100, 116, 139);
  doc.text(
    `Reporting period: ${rangeText(report)}  ·  Generated ${fmtDateTime(report.generatedAtMs)}`,
    PAGE_MARGIN,
    68,
  );
  doc.setDrawColor(226, 232, 240);
  doc.line(PAGE_MARGIN, 78, pageW - PAGE_MARGIN, 78);

  let y = drawKpiGrid(doc, kpiCells(report), 92) + 24;

  // Visual breakdowns (colored bars)
  y = ensureSpace(doc, y, 120);
  y = drawBarChart(doc, "Visits by type", report.visitTypeMix, y) + 8;
  y = ensureSpace(doc, y, 140);
  y = drawBarChart(doc, "Department throughput", report.departmentThroughput, y) + 8;
  y = ensureSpace(doc, y, 160);
  y = drawBarChart(doc, "Top diagnoses", report.topDiagnoses, y) + 12;

  // Tabular detail
  const sections: { title: string; head: string[]; body: (string | number)[][] }[] = [
    {
      title: "Visits over time",
      head: ["Period", "Outpatient", "Inpatient", "Emergency", "Total"],
      body: report.visitsOverTime.map((b: TimeBucket) => [
        b.label,
        b.outpatient,
        b.inpatient,
        b.emergency,
        b.total,
      ]),
    },
    {
      title: "Length of stay",
      head: ["Band", "Discharges"],
      body: sliceRows(report.los.buckets),
    },
    {
      title: "Ward occupancy",
      head: ["Ward", "Total beds", "Occupied", "Free", "Occupancy %"],
      body: report.wardOccupancy.map((w: WardOccupancyRow) => [
        w.ward,
        w.total,
        w.occupied,
        w.free,
        `${w.pct}%`,
      ]),
    },
    { title: "Bed status", head: ["Status", "Beds"], body: sliceRows(report.bedStatusMix) },
    {
      title: "Open visits by care stage",
      head: ["Stage", "Visits"],
      body: sliceRows(report.stageDistribution),
    },
    {
      title: "Medication administrations",
      head: ["Outcome", "Doses"],
      body: sliceRows(report.medsByStatus),
    },
    { title: "Top prescribed drugs", head: ["Drug", "Scripts"], body: sliceRows(report.topDrugs) },
    { title: "Diagnostic orders", head: ["Type", "Orders"], body: sliceRows(report.ordersByType) },
    {
      title: "Abnormal results",
      head: ["Outcome", "Count"],
      body: [
        ["Abnormal", report.abnormal.abnormal],
        ["Normal", report.abnormal.normal],
        ["Abnormal rate", `${report.abnormal.pct}%`],
      ],
    },
    { title: "Patients by sex", head: ["Sex", "Patients"], body: sliceRows(report.sexMix) },
    { title: "Patients by age", head: ["Age band", "Patients"], body: sliceRows(report.ageDistribution) },
    { title: "Clinician workload", head: ["Clinician", "Visits"], body: sliceRows(report.staffWorkload) },
    {
      title: "Allergy coverage",
      head: ["Assessment", "Patients"],
      body: sliceRows(report.allergyPrevalence),
    },
    { title: "Top allergens", head: ["Substance", "Patients"], body: sliceRows(report.topAllergens) },
    {
      title: "Discharge clearance bottlenecks",
      head: ["Gate", "Pending"],
      body: sliceRows(report.clearanceBottlenecks),
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
      `Page ${p} of ${pages}`,
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

function sliceSheet(slices: CountSlice[], valueHeader = "Count"): XLSX.WorkSheet {
  return XLSX.utils.json_to_sheet(
    slices.map((s) => ({ Category: s.label, [valueHeader]: s.value })),
  );
}

export function exportReportXlsx(report: FullReport): void {
  const wb = XLSX.utils.book_new();

  // Summary
  const k = report.kpis;
  const summary = [
    ["CareFlow — Hospital Operations Report"],
    ["Reporting period", rangeText(report)],
    ["Generated", fmtDateTime(report.generatedAtMs)],
    [],
    ["Metric", "Value"],
    ["Total visits", k.totalVisits],
    ["Unique patients", k.uniquePatients],
    ["Outpatient", k.outpatient],
    ["Inpatient", k.inpatient],
    ["Emergency", k.emergency],
    ["Admissions started", k.admissionsStarted],
    ["Discharges", k.discharges],
    ["Current inpatients", k.currentInpatients],
    ["Bed occupancy %", k.bedOccupancyPct],
    ["Avg length of stay (days)", k.avgLosDays ?? "—"],
    ["Median length of stay (days)", report.los.medianDays ?? "—"],
  ];
  XLSX.utils.book_append_sheet(
    wb,
    XLSX.utils.aoa_to_sheet(summary),
    "Summary",
  );

  XLSX.utils.book_append_sheet(
    wb,
    XLSX.utils.json_to_sheet(
      report.visitsOverTime.map((b) => ({
        Period: b.label,
        Outpatient: b.outpatient,
        Inpatient: b.inpatient,
        Emergency: b.emergency,
        Total: b.total,
      })),
    ),
    "Visits over time",
  );

  XLSX.utils.book_append_sheet(wb, sliceSheet(report.visitTypeMix, "Visits"), "Visit types");
  XLSX.utils.book_append_sheet(
    wb,
    sliceSheet(report.departmentThroughput, "Visits"),
    "Departments",
  );
  XLSX.utils.book_append_sheet(wb, sliceSheet(report.topDiagnoses, "Cases"), "Top diagnoses");
  XLSX.utils.book_append_sheet(wb, sliceSheet(report.los.buckets, "Discharges"), "Length of stay");

  XLSX.utils.book_append_sheet(
    wb,
    XLSX.utils.json_to_sheet(
      report.wardOccupancy.map((w) => ({
        Ward: w.ward,
        "Total beds": w.total,
        Occupied: w.occupied,
        Free: w.free,
        "Occupancy %": w.pct,
      })),
    ),
    "Ward occupancy",
  );
  XLSX.utils.book_append_sheet(wb, sliceSheet(report.bedStatusMix, "Beds"), "Bed status");
  XLSX.utils.book_append_sheet(wb, sliceSheet(report.stageDistribution, "Visits"), "Care stages");
  XLSX.utils.book_append_sheet(wb, sliceSheet(report.medsByStatus, "Doses"), "Medications");
  XLSX.utils.book_append_sheet(wb, sliceSheet(report.topDrugs, "Scripts"), "Top drugs");
  XLSX.utils.book_append_sheet(wb, sliceSheet(report.ordersByType, "Orders"), "Order types");
  XLSX.utils.book_append_sheet(wb, sliceSheet(report.sexMix, "Patients"), "Sex mix");
  XLSX.utils.book_append_sheet(wb, sliceSheet(report.ageDistribution, "Patients"), "Age mix");
  XLSX.utils.book_append_sheet(wb, sliceSheet(report.staffWorkload, "Visits"), "Clinician workload");
  XLSX.utils.book_append_sheet(
    wb,
    sliceSheet(report.allergyPrevalence, "Patients"),
    "Allergy coverage",
  );
  XLSX.utils.book_append_sheet(wb, sliceSheet(report.topAllergens, "Patients"), "Top allergens");
  XLSX.utils.book_append_sheet(
    wb,
    sliceSheet(report.clearanceBottlenecks, "Pending"),
    "Clearance gates",
  );

  XLSX.writeFile(wb, `careflow-report-${fileStamp(report.generatedAtMs)}.xlsx`);
}
