/**
 * Patient report exporters — browser-only. Two documents share the same jsPDF +
 * autotable rendering helpers:
 *   • exportVisitSummaryPdf   — one encounter (discharge / visit summary)
 *   • exportPatientHistoryPdf — every encounter, chronological (lifetime record)
 *
 * The heavy libs are lazy-imported by the calling component, so they only load
 * when an export is actually triggered.
 *
 * Scope note (Phase 13): clinical *values* stay canonical — drug names, ICD-10
 * descriptions, free-text notes, dose/route/frequency, vitals units (GCS, SpO₂)
 * are not translated. Only chrome (labels, statuses, section titles) is.
 */

import { jsPDF } from "jspdf";
import autoTable from "jspdf-autotable";

import type { Translate } from "./reports";
import { VISIT_TYPE_LABEL, CARE_STAGE_LABEL } from "./reports";
import { ORDER_TYPE_LABEL, ORDER_STATUS_LABEL } from "@/components/diagnostics/orders";
import {
  PRESCRIPTION_STATUS_LABEL,
  MAR_STATUS_LABEL,
} from "@/components/medications/prescriptions";
import {
  ALLERGY_CATEGORY_LABEL,
  ALLERGY_SEVERITY_LABEL,
} from "@/components/allergies/allergies";
import { formatDate, formatDateTime } from "@/i18n/format";
import type { Locale } from "@/i18n";
import type { Allergy, MarStatus, Patient } from "@/types/healthcare";
import type { PatientHistoryData, VisitSummaryData } from "./visit-summary";

type DocWithAutoTable = jsPDF & { lastAutoTable?: { finalY: number } };

const PAGE_MARGIN = 40;
const INK = [15, 23, 42] as const;
const MUTED = [100, 116, 139] as const;
const RULE = [226, 232, 240] as const;
const DASH = "—";

function fmtDateTime(value: string | number, locale: Locale): string {
  return formatDateTime(value, locale, { dateStyle: "medium", timeStyle: "short" });
}

function fmtDate(value: string | number, locale: Locale): string {
  return formatDate(value, locale, { dateStyle: "medium" });
}

function v(s: string | null | undefined): string {
  return s && s.trim() ? s : DASH;
}

function ageFromDob(dob: string | null): number | null {
  if (!dob) return null;
  const birth = new Date(dob);
  if (Number.isNaN(birth.getTime())) return null;
  const now = new Date();
  let age = now.getFullYear() - birth.getFullYear();
  const m = now.getMonth() - birth.getMonth();
  if (m < 0 || (m === 0 && now.getDate() < birth.getDate())) age -= 1;
  return age;
}

function displayNameOf(patient: Patient): string {
  return patient.is_emergency_anonymous && patient.anonymous_identifier
    ? patient.anonymous_identifier
    : patient.full_name;
}

// ---------------------------------------------------------------------------
// Low-level drawing helpers
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
  const y2 = ensureSpace(doc, y, 40);
  const pageW = doc.internal.pageSize.getWidth();
  doc.setFont("helvetica", "bold");
  doc.setFontSize(12);
  doc.setTextColor(...INK);
  doc.text(text, PAGE_MARGIN, y2);
  doc.setDrawColor(...RULE);
  doc.line(PAGE_MARGIN, y2 + 5, pageW - PAGE_MARGIN, y2 + 5);
  doc.setFont("helvetica", "normal");
  return y2 + 18;
}

/** Borderless two-column key/value block. Returns Y below. */
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
    styles: { fontSize: 8, cellPadding: 4, valign: "top" },
    headStyles: { fillColor: [30, 41, 59], textColor: [248, 250, 252] },
    alternateRowStyles: { fillColor: [244, 246, 249] },
  });
  return (doc as DocWithAutoTable).lastAutoTable?.finalY ?? startY;
}

/** Bold label followed by wrapped body text. Returns Y below. */
function labelledText(doc: jsPDF, label: string, text: string, y: number): number {
  const pageW = doc.internal.pageSize.getWidth();
  const wrapW = pageW - PAGE_MARGIN * 2;
  const lines = text ? (doc.splitTextToSize(text, wrapW) as string[]) : [];
  let yy = ensureSpace(doc, y, 14 + lines.length * 11);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(8.5);
  doc.setTextColor(...MUTED);
  doc.text(label.toUpperCase(), PAGE_MARGIN, yy);
  yy += 12;
  if (lines.length) {
    doc.setFont("helvetica", "normal");
    doc.setFontSize(9.5);
    doc.setTextColor(...INK);
    doc.text(lines, PAGE_MARGIN, yy);
    yy += lines.length * 11;
  }
  return yy + 4;
}

function emptyLine(doc: jsPDF, text: string, y: number): number {
  const yy = ensureSpace(doc, y, 16);
  doc.setFont("helvetica", "italic");
  doc.setFontSize(9);
  doc.setTextColor(...MUTED);
  doc.text(text, PAGE_MARGIN, yy);
  doc.setFont("helvetica", "normal");
  return yy + 14;
}

// ---------------------------------------------------------------------------
// Composable document sections
// ---------------------------------------------------------------------------

function drawDocHeader(
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

function drawPatientSection(
  doc: jsPDF,
  patient: Patient,
  t: Translate,
  locale: Locale,
  y: number,
): number {
  const age = ageFromDob(patient.date_of_birth);
  let yy = sectionTitle(doc, t("visitReport.section.patient"), y);
  yy = keyValues(
    doc,
    [
      [t("visitReport.field.name"), displayNameOf(patient)],
      [t("visitReport.field.hospitalNo"), patient.mrn],
      [
        t("visitReport.field.dob"),
        patient.date_of_birth ? fmtDate(patient.date_of_birth, locale) : DASH,
      ],
      [
        t("visitReport.field.age"),
        age != null ? t("visitReport.value.years", { count: age }) : DASH,
      ],
      [t("visitReport.field.sex"), t(`sex.${patient.sex}`)],
      [t("visitReport.field.phone"), v(patient.phone)],
      [t("visitReport.field.address"), v(patient.address)],
      [t("visitReport.field.nationalId"), v(patient.national_id)],
    ],
    yy,
  );
  return yy;
}

function drawAllergiesSection(
  doc: jsPDF,
  allergies: Allergy[],
  noKnownAllergies: boolean,
  t: Translate,
  y: number,
): number {
  let yy = sectionTitle(doc, t("visitReport.section.allergies"), y + 14);
  if (allergies.length > 0) {
    yy = table(
      doc,
      [
        t("visitReport.field.substance"),
        t("visitReport.field.category"),
        t("visitReport.field.severity"),
        t("visitReport.field.reaction"),
      ],
      allergies.map((a) => [
        a.substance,
        t(ALLERGY_CATEGORY_LABEL[a.category]),
        t(ALLERGY_SEVERITY_LABEL[a.severity]),
        v(a.reaction),
      ]),
      yy,
    );
  } else {
    yy = emptyLine(
      doc,
      noKnownAllergies
        ? t("visitReport.empty.noKnownAllergies")
        : t("visitReport.empty.allergiesNotAssessed"),
      yy,
    );
  }
  return yy;
}

/** The "Visit" identity block (type, dept, doctor, dates, triage, complaint). */
function drawVisitSection(
  doc: jsPDF,
  data: VisitSummaryData,
  t: Translate,
  locale: Locale,
  y: number,
): number {
  const { visit } = data;
  let yy = sectionTitle(doc, t("visitReport.section.visit"), y + 14);
  yy = keyValues(
    doc,
    [
      [t("visitReport.field.visitType"), t(VISIT_TYPE_LABEL[visit.visit_type])],
      [t("visitReport.field.department"), v(data.department?.name)],
      [t("visitReport.field.attendingDoctor"), v(data.attendingDoctor?.full_name)],
      [t("visitReport.field.registeredBy"), v(data.registeredBy?.full_name)],
      [t("visitReport.field.arrived"), fmtDateTime(visit.arrived_at, locale)],
      [
        t("visitReport.field.closed"),
        visit.closed_at
          ? fmtDateTime(visit.closed_at, locale)
          : t("visitReport.value.ongoing"),
      ],
      [t("visitReport.field.careStage"), t(CARE_STAGE_LABEL[visit.stage])],
      [
        t("visitReport.field.triage"),
        visit.triage_level != null
          ? `${t("liveBoard.triage.label", { level: String(visit.triage_level) })} · ${t(
              `liveBoard.triage.${visit.triage_level}`,
            )}`
          : DASH,
      ],
      [t("visitReport.field.chiefComplaint"), v(visit.chief_complaint)],
    ],
    yy,
  );
  if (visit.triage_notes && visit.triage_notes.trim()) {
    yy = labelledText(doc, t("visitReport.field.triageNotes"), visit.triage_notes, yy + 6);
  }
  return yy;
}

/** Vitals, doctor's notes, diagnoses, tests+results, meds, admission. */
function drawClinicalSections(
  doc: jsPDF,
  data: VisitSummaryData,
  t: Translate,
  locale: Locale,
  y: number,
): number {
  let yy = y;

  // Vitals
  yy = sectionTitle(doc, t("visitReport.section.vitals"), yy + 14);
  if (data.vitals.length > 0) {
    yy = table(
      doc,
      [
        t("visitReport.field.recordedAt"),
        "BP",
        t("visitReport.field.pulse"),
        t("visitReport.field.temp"),
        "SpO₂",
        "GCS",
        t("visitReport.field.notes"),
      ],
      data.vitals.map((r) => [
        fmtDateTime(r.recorded_at, locale),
        r.bp_systolic != null && r.bp_diastolic != null
          ? `${r.bp_systolic}/${r.bp_diastolic}`
          : DASH,
        r.pulse != null ? `${r.pulse}` : DASH,
        r.temperature_c != null ? `${r.temperature_c}°C` : DASH,
        r.spo2 != null ? `${r.spo2}%` : DASH,
        r.gcs_score != null ? `${r.gcs_score}` : DASH,
        v(r.notes),
      ]),
      yy,
    );
  } else {
    yy = emptyLine(doc, t("visitReport.empty.noVitals"), yy);
  }

  // Doctor's notes
  yy = sectionTitle(doc, t("visitReport.section.doctorNotes"), yy + 14);
  if (data.consultations.length > 0) {
    data.consultations.forEach((c, i) => {
      if (i > 0) yy += 4;
      const by = data.staffName(c.doctor_id);
      const meta = [by, fmtDateTime(c.created_at, locale)].filter(Boolean).join(" · ");
      if (meta) {
        yy = ensureSpace(doc, yy, 14);
        doc.setFont("helvetica", "bold");
        doc.setFontSize(9);
        doc.setTextColor(...INK);
        doc.text(meta, PAGE_MARGIN, yy);
        doc.setFont("helvetica", "normal");
        yy += 12;
      }
      if (c.subjective) yy = labelledText(doc, t("visitReport.field.subjective"), c.subjective, yy);
      if (c.examination) yy = labelledText(doc, t("visitReport.field.examination"), c.examination, yy);
      if (c.assessment) yy = labelledText(doc, t("visitReport.field.assessment"), c.assessment, yy);
      if (c.plan) yy = labelledText(doc, t("visitReport.field.plan"), c.plan, yy);
    });
  } else {
    yy = emptyLine(doc, t("visitReport.empty.noNotes"), yy);
  }

  // Diagnoses
  yy = sectionTitle(doc, t("visitReport.section.diagnoses"), yy + 14);
  if (data.diagnoses.length > 0) {
    yy = table(
      doc,
      [
        t("visitReport.field.diagnosis"),
        t("visitReport.field.icd10"),
        t("visitReport.field.primary"),
        t("visitReport.field.diagnosedBy"),
      ],
      data.diagnoses.map((d) => [
        d.description,
        v(d.icd10_code),
        d.is_primary ? t("visitReport.value.yes") : DASH,
        v(data.staffName(d.diagnosed_by_id)),
      ]),
      yy,
    );
  } else {
    yy = emptyLine(doc, t("visitReport.empty.noDiagnoses"), yy);
  }

  // Tests & results
  yy = sectionTitle(doc, t("visitReport.section.tests"), yy + 14);
  if (data.orders.length > 0) {
    const rows: (string | number)[][] = [];
    for (const { order, results } of data.orders) {
      if (results.length === 0) {
        rows.push([
          order.description,
          t(ORDER_TYPE_LABEL[order.order_type]),
          t(ORDER_STATUS_LABEL[order.status]),
          DASH,
          DASH,
        ]);
      } else {
        for (const r of results) {
          const value = [r.value, r.summary].filter(Boolean).join(" — ");
          const flag = r.is_abnormal
            ? t("visitReport.value.abnormal")
            : t("visitReport.value.normal");
          rows.push([
            order.description,
            t(ORDER_TYPE_LABEL[order.order_type]),
            t(ORDER_STATUS_LABEL[order.status]),
            value || DASH,
            `${flag}${r.reference_range ? ` (${r.reference_range})` : ""}`,
          ]);
        }
      }
    }
    yy = table(
      doc,
      [
        t("visitReport.field.test"),
        t("visitReport.field.type"),
        t("visitReport.field.status"),
        t("visitReport.field.result"),
        t("visitReport.field.flag"),
      ],
      rows,
      yy,
    );
  } else {
    yy = emptyLine(doc, t("visitReport.empty.noTests"), yy);
  }

  // Medications
  yy = sectionTitle(doc, t("visitReport.section.medications"), yy + 14);
  if (data.prescriptions.length > 0) {
    yy = table(
      doc,
      [
        t("visitReport.field.drug"),
        t("visitReport.field.dose"),
        t("visitReport.field.route"),
        t("visitReport.field.frequency"),
        t("visitReport.field.duration"),
        t("visitReport.field.status"),
        t("visitReport.field.administered"),
      ],
      data.prescriptions.map(({ prescription: p, administrations }) => {
        const counts: Partial<Record<MarStatus, number>> = {};
        for (const a of administrations) counts[a.status] = (counts[a.status] ?? 0) + 1;
        const admin =
          administrations.length === 0
            ? DASH
            : (Object.keys(counts) as MarStatus[])
                .map((s) => `${counts[s]} ${t(MAR_STATUS_LABEL[s])}`)
                .join(", ");
        return [
          p.drug_name,
          v(p.dose),
          v(p.route),
          v(p.frequency),
          v(p.duration),
          t(PRESCRIPTION_STATUS_LABEL[p.status]),
          admin,
        ];
      }),
      yy,
    );
    const withInstructions = data.prescriptions.filter(
      (x) => x.prescription.instructions && x.prescription.instructions.trim(),
    );
    for (const { prescription: p } of withInstructions) {
      yy = labelledText(doc, p.drug_name, p.instructions as string, yy + 4);
    }
  } else {
    yy = emptyLine(doc, t("visitReport.empty.noMedications"), yy);
  }

  // Admission
  if (data.admission) {
    const a = data.admission;
    yy = sectionTitle(doc, t("visitReport.section.admission"), yy + 14);
    yy = keyValues(
      doc,
      [
        [t("visitReport.field.ward"), v(data.wardName(a.ward_id))],
        [t("visitReport.field.bed"), v(data.bedName(a.bed_id))],
        [t("visitReport.field.admitted"), fmtDateTime(a.admitted_at, locale)],
        [
          t("visitReport.field.discharged"),
          a.discharged_at
            ? fmtDateTime(a.discharged_at, locale)
            : t("visitReport.value.stillAdmitted"),
        ],
        [
          t("visitReport.field.lengthOfStay"),
          data.lengthOfStayDays != null
            ? t("visitReport.value.days", { count: data.lengthOfStayDays })
            : DASH,
        ],
        [t("visitReport.field.reason"), v(a.reason)],
      ],
      yy,
    );

    if (data.transfers.length > 0) {
      yy = labelledText(doc, t("visitReport.field.transfers"), "", yy + 2);
      yy = table(
        doc,
        [
          t("visitReport.field.date"),
          t("visitReport.field.fromTo"),
          t("visitReport.field.reason"),
        ],
        data.transfers.map((tr) => {
          const move: string[] = [];
          if (tr.from_ward_id || tr.to_ward_id)
            move.push(`${data.wardName(tr.from_ward_id) ?? DASH} → ${data.wardName(tr.to_ward_id) ?? DASH}`);
          if (tr.from_bed_id || tr.to_bed_id)
            move.push(`${data.bedName(tr.from_bed_id) ?? DASH} → ${data.bedName(tr.to_bed_id) ?? DASH}`);
          if (tr.from_doctor_id || tr.to_doctor_id)
            move.push(`${data.staffName(tr.from_doctor_id) ?? DASH} → ${data.staffName(tr.to_doctor_id) ?? DASH}`);
          return [fmtDateTime(tr.created_at, locale), move.join("; ") || DASH, v(tr.reason)];
        }),
        yy,
      );
    }
  }

  return yy;
}

/** A filled banner introducing one visit inside the history document. */
function drawVisitBanner(
  doc: jsPDF,
  data: VisitSummaryData,
  index: number,
  total: number,
  t: Translate,
  locale: Locale,
  y: number,
): number {
  const pageW = doc.internal.pageSize.getWidth();
  const barH = 22;
  const yy = ensureSpace(doc, y, barH + 10);
  doc.setFillColor(30, 41, 59);
  doc.roundedRect(PAGE_MARGIN, yy, pageW - PAGE_MARGIN * 2, barH, 3, 3, "F");
  doc.setFont("helvetica", "bold");
  doc.setFontSize(10);
  doc.setTextColor(248, 250, 252);
  const left = t("visitReport.history.visitN", {
    n: index + 1,
    total,
  });
  const right = `${fmtDate(data.visit.arrived_at, locale)} · ${t(
    VISIT_TYPE_LABEL[data.visit.visit_type],
  )}`;
  doc.text(left, PAGE_MARGIN + 8, yy + 15);
  doc.text(right, pageW - PAGE_MARGIN - 8, yy + 15, { align: "right" });
  doc.setFont("helvetica", "normal");
  return yy + barH + 8;
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

function fileName(patient: Patient, kind: string, ms: number): string {
  const base = displayNameOf(patient)
    .replace(/[^\p{L}\p{N}]+/gu, "-")
    .replace(/^-+|-+$/g, "");
  return `careflow-${kind}-${base || patient.mrn}-${fileStamp(ms)}.pdf`;
}

// ---------------------------------------------------------------------------
// Public exporters
// ---------------------------------------------------------------------------

export function exportVisitSummaryPdf(
  data: VisitSummaryData,
  t: Translate,
  locale: Locale,
): void {
  const doc = new jsPDF({ unit: "pt", format: "a4" });
  let y = drawDocHeader(
    doc,
    t("visitReport.title"),
    t("shell.facility"),
    t,
    locale,
    data.generatedAtMs,
  );
  y = drawPatientSection(doc, data.patient, t, locale, y);
  y = drawVisitSection(doc, data, t, locale, y);
  y = drawAllergiesSection(
    doc,
    data.allergies,
    data.patient.no_known_allergies,
    t,
    y,
  );
  drawClinicalSections(doc, data, t, locale, y);
  drawFooter(doc, t("visitReport.disclaimer"), t);
  doc.save(fileName(data.patient, "visit", data.generatedAtMs));
}

export function exportPatientHistoryPdf(
  data: PatientHistoryData,
  t: Translate,
  locale: Locale,
): void {
  const doc = new jsPDF({ unit: "pt", format: "a4" });
  let y = drawDocHeader(
    doc,
    t("visitReport.history.title"),
    t("shell.facility"),
    t,
    locale,
    data.generatedAtMs,
  );
  y = drawPatientSection(doc, data.patient, t, locale, y);

  // History overview
  y = sectionTitle(doc, t("visitReport.history.overview"), y + 14);
  y = keyValues(
    doc,
    [
      [t("visitReport.history.totalVisits"), String(data.totalVisits)],
      [
        t("visitReport.history.firstVisit"),
        data.firstArrivedAt ? fmtDate(data.firstArrivedAt, locale) : DASH,
      ],
      [
        t("visitReport.history.lastVisit"),
        data.lastArrivedAt ? fmtDate(data.lastArrivedAt, locale) : DASH,
      ],
    ],
    y,
  );

  y = drawAllergiesSection(
    doc,
    data.allergies,
    data.patient.no_known_allergies,
    t,
    y,
  );

  if (data.visits.length === 0) {
    y = sectionTitle(doc, t("visitReport.section.visit"), y + 14);
    emptyLine(doc, t("visitReport.history.noVisits"), y);
  } else {
    data.visits.forEach((visit, i) => {
      // Keep each visit's banner with the start of its content.
      y = ensureSpace(doc, y + 18, 120);
      y = drawVisitBanner(doc, visit, i, data.totalVisits, t, locale, y);
      y = drawVisitSection(doc, visit, t, locale, y - 14);
      y = drawClinicalSections(doc, visit, t, locale, y);
    });
  }

  drawFooter(doc, t("visitReport.disclaimer"), t);
  doc.save(fileName(data.patient, "history", data.generatedAtMs));
}
