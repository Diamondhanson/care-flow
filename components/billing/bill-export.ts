/**
 * Bill / invoice PDF exporter — browser-only (Phase 16.9).
 *
 * Renders one visit's itemized bill: a header with the hospital + patient, the
 * charges grouped by category (the same grouping `summarizeBill` produces, so
 * the on-screen bill and the PDF never disagree), any discounts, and the totals
 * block. Money is whole XAF via `formatXaf`.
 *
 * jsPDF + autotable are heavy, so they're imported here and this module is only
 * pulled in when an export is actually triggered.
 */

import { jsPDF } from "jspdf";
import autoTable from "jspdf-autotable";

import type { Translate } from "@/components/reports/reports";
import { VISIT_TYPE_LABEL } from "@/components/reports/reports";
import { formatDate, formatDateTime, formatXaf } from "@/i18n/format";
import { getCurrentHospital } from "@/services/mockStorage";
import type { Locale } from "@/i18n";
import type { BillableItem, Charge, Patient, Visit } from "@/types/healthcare";
import { summarizeBill } from "./billing";

type DocWithAutoTable = jsPDF & { lastAutoTable?: { finalY: number } };

const PAGE_MARGIN = 40;
const INK = [15, 23, 42] as const;
const MUTED = [100, 116, 139] as const;
const RULE = [226, 232, 240] as const;
const DASH = "—";

export interface BillExportData {
  patient: Patient;
  visit: Visit;
  charges: readonly Charge[];
  catalog: readonly BillableItem[];
  generatedAtMs: number;
}

function fmtDateTime(value: string | number, locale: Locale): string {
  return formatDateTime(value, locale, { dateStyle: "medium", timeStyle: "short" });
}

function fmtDate(value: string | number, locale: Locale): string {
  return formatDate(value, locale, { dateStyle: "medium" });
}

function displayNameOf(patient: Patient): string {
  return patient.is_emergency_anonymous && patient.anonymous_identifier
    ? patient.anonymous_identifier
    : patient.full_name;
}

// ---------------------------------------------------------------------------
// Drawing helpers
// ---------------------------------------------------------------------------

function ensureSpace(doc: jsPDF, y: number, needed: number): number {
  const pageH = doc.internal.pageSize.getHeight();
  if (y + needed > pageH - PAGE_MARGIN) {
    doc.addPage();
    return PAGE_MARGIN;
  }
  return y;
}

function sectionTitle(doc: jsPDF, text: string, y: number): number {
  const y2 = ensureSpace(doc, y, 36);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(11);
  doc.setTextColor(...INK);
  doc.text(text, PAGE_MARGIN, y2);
  doc.setFont("helvetica", "normal");
  return y2 + 8;
}

function keyValues(doc: jsPDF, rows: [string, string][], startY: number): number {
  const visible = rows.filter(([, val]) => val && val !== DASH);
  if (visible.length === 0) return startY;
  autoTable(doc, {
    body: visible.map(([k, val]) => [k, val]),
    startY,
    theme: "plain",
    margin: { left: PAGE_MARGIN, right: PAGE_MARGIN },
    styles: { fontSize: 9, cellPadding: { top: 1.5, bottom: 1.5, left: 0, right: 6 } },
    columnStyles: {
      0: { cellWidth: 130, textColor: [100, 116, 139] },
      1: { textColor: [15, 23, 42] },
    },
  });
  return (doc as DocWithAutoTable).lastAutoTable?.finalY ?? startY;
}

function drawHeader(
  doc: jsPDF,
  title: string,
  subtitle: string,
  t: Translate,
  locale: Locale,
  generatedAtMs: number,
): number {
  const pageW = doc.internal.pageSize.getWidth();
  doc.setFont("helvetica", "bold");
  doc.setFontSize(18);
  doc.setTextColor(...INK);
  doc.text(title, PAGE_MARGIN, 50);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(10);
  doc.setTextColor(...MUTED);
  doc.text(
    `${subtitle}  ·  ${t("visitReport.generated")} ${fmtDateTime(generatedAtMs, locale)}`,
    PAGE_MARGIN,
    68,
  );
  doc.setDrawColor(...RULE);
  doc.line(PAGE_MARGIN, 78, pageW - PAGE_MARGIN, 78);
  return 96;
}

function drawFooter(doc: jsPDF, disclaimer: string, t: Translate): void {
  const pageW = doc.internal.pageSize.getWidth();
  const pageH = doc.internal.pageSize.getHeight();
  const pages = doc.getNumberOfPages();
  for (let p = 1; p <= pages; p += 1) {
    doc.setPage(p);
    doc.setFontSize(7.5);
    doc.setTextColor(148, 163, 184);
    doc.text(disclaimer, PAGE_MARGIN, pageH - 20);
    doc.text(t("reports.pageOf", { p, total: pages }), pageW - PAGE_MARGIN, pageH - 20, {
      align: "right",
    });
  }
}

function fileStamp(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

function fileName(patient: Patient, ms: number): string {
  const slug = (s: string) =>
    s.replace(/[^\p{L}\p{N}]+/gu, "-").replace(/^-+|-+$/g, "");
  const base = slug(displayNameOf(patient));
  return `careflow-bill-${base || slug(patient.mrn) || "patient"}-${fileStamp(ms)}.pdf`;
}

// ---------------------------------------------------------------------------
// Public exporter
// ---------------------------------------------------------------------------

export function exportBillPdf(
  data: BillExportData,
  t: Translate,
  locale: Locale,
): void {
  const { patient, visit, charges, catalog, generatedAtMs } = data;
  const summary = summarizeBill(charges, catalog);

  const doc = new jsPDF({ unit: "pt", format: "a4" });
  const hospitalName = getCurrentHospital()?.name ?? t("shell.facility");

  let y = drawHeader(doc, t("billing.pdfTitle"), hospitalName, t, locale, generatedAtMs);

  // Patient + visit identity
  y = sectionTitle(doc, t("visitReport.section.patient"), y);
  y = keyValues(
    doc,
    [
      [t("visitReport.field.name"), displayNameOf(patient)],
      [t("visitReport.field.hospitalNo"), patient.mrn || DASH],
      [t("visitReport.field.visitType"), t(VISIT_TYPE_LABEL[visit.visit_type])],
      [t("visitReport.field.arrived"), fmtDate(visit.arrived_at, locale)],
    ],
    y,
  );

  // Itemized charges, grouped by category
  y = sectionTitle(doc, t("billing.title"), y + 12);
  const head = [
    t("billing.colItem"),
    t("billing.colQty"),
    t("billing.colUnitPrice"),
    t("billing.colAmount"),
    t("billing.colStatus"),
  ];

  if (summary.isEmpty) {
    y = ensureSpace(doc, y + 4, 16);
    doc.setFont("helvetica", "italic");
    doc.setFontSize(9);
    doc.setTextColor(...MUTED);
    doc.text(t("billing.emptyBill"), PAGE_MARGIN, y);
    doc.setFont("helvetica", "normal");
    y += 14;
  } else {
    for (const group of summary.groups) {
      y = sectionTitle(doc, t(`billing.category.${group.category}`), y + 8);
      autoTable(doc, {
        head: [head],
        body: group.lines.map((c) => [
          c.description,
          String(c.quantity),
          formatXaf(c.unit_price, locale),
          formatXaf(c.amount, locale),
          t(`billing.status.${c.status}`),
        ]),
        foot: [
          [
            t("billing.subtotal"),
            "",
            "",
            formatXaf(group.subtotal, locale),
            "",
          ],
        ],
        startY: y,
        margin: { left: PAGE_MARGIN, right: PAGE_MARGIN },
        styles: { fontSize: 8, cellPadding: 4, valign: "top" },
        headStyles: { fillColor: [30, 41, 59], textColor: [248, 250, 252] },
        footStyles: { fillColor: [244, 246, 249], textColor: [15, 23, 42], fontStyle: "bold" },
        alternateRowStyles: { fillColor: [244, 246, 249] },
        columnStyles: {
          1: { halign: "right", cellWidth: 40 },
          2: { halign: "right", cellWidth: 80 },
          3: { halign: "right", cellWidth: 80 },
          4: { halign: "center", cellWidth: 60 },
        },
      });
      y = (doc as DocWithAutoTable).lastAutoTable?.finalY ?? y;
    }

    // Discounts
    if (summary.discounts.length > 0) {
      y = sectionTitle(doc, t("billing.source.discount"), y + 8);
      autoTable(doc, {
        head: [[t("billing.colItem"), t("billing.colAmount"), t("billing.colStatus")]],
        body: summary.discounts.map((c) => [
          c.description,
          formatXaf(c.amount, locale),
          t(`billing.status.${c.status}`),
        ]),
        startY: y,
        margin: { left: PAGE_MARGIN, right: PAGE_MARGIN },
        styles: { fontSize: 8, cellPadding: 4, valign: "top" },
        headStyles: { fillColor: [30, 41, 59], textColor: [248, 250, 252] },
        columnStyles: {
          1: { halign: "right", cellWidth: 80 },
          2: { halign: "center", cellWidth: 60 },
        },
      });
      y = (doc as DocWithAutoTable).lastAutoTable?.finalY ?? y;
    }

    // Totals
    const totalRows: [string, string][] = [
      [t("billing.subtotal"), formatXaf(summary.itemsSubtotal, locale)],
    ];
    if (summary.discountTotal > 0) {
      totalRows.push([
        t("billing.discountTotal"),
        `-${formatXaf(summary.discountTotal, locale)}`,
      ]);
    }
    y = ensureSpace(doc, y + 10, 60);
    autoTable(doc, {
      body: totalRows,
      foot: [[t("billing.grandTotal"), formatXaf(summary.grandTotal, locale)]],
      startY: y,
      theme: "plain",
      margin: { left: PAGE_MARGIN, right: PAGE_MARGIN },
      styles: { fontSize: 9, cellPadding: { top: 2, bottom: 2, left: 0, right: 0 } },
      footStyles: { fontStyle: "bold", fontSize: 11, textColor: [15, 23, 42] },
      columnStyles: {
        0: { textColor: [100, 116, 139], halign: "right" },
        1: { halign: "right", cellWidth: 110 },
      },
    });
    y = (doc as DocWithAutoTable).lastAutoTable?.finalY ?? y;

    if (summary.isFullySettled) {
      y = ensureSpace(doc, y + 8, 16);
      doc.setFont("helvetica", "bold");
      doc.setFontSize(9);
      doc.setTextColor(22, 163, 74);
      doc.text(
        t("billing.settled").toUpperCase(),
        doc.internal.pageSize.getWidth() - PAGE_MARGIN,
        y,
        { align: "right" },
      );
      doc.setFont("helvetica", "normal");
    }
  }

  drawFooter(doc, t("billing.pdfDisclaimer"), t);
  doc.save(fileName(patient, generatedAtMs));
}
