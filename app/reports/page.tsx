"use client";

import { useEffect, useMemo, useState } from "react";
import {
  Activity,
  BarChart3,
  BedDouble,
  Download,
  FileSpreadsheet,
  FileText,
  Stethoscope,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import {
  getAdmissions,
  getAllAllergies,
  getAllDiagnoses,
  getAllMedicationAdministrations,
  getAllOrders,
  getAllPrescriptions,
  getAllResults,
  getBeds,
  getDepartments,
  getPatients,
  getStaff,
  getVisits,
  getWards,
} from "@/services/mockStorage";
import {
  buildReport,
  presetRange,
  RANGE_PRESET_LABEL,
  type DateRange,
  type FullReport,
  type RangePreset,
  type ReportData,
} from "@/components/reports/reports";
import {
  Donut,
  HorizontalBars,
  StackedAreaTrend,
  VerticalBars,
} from "@/components/reports/charts";
import { exportReportPdf, exportReportXlsx } from "@/components/reports/export";

function loadReportData(): ReportData {
  return {
    visits: getVisits(),
    patients: getPatients(),
    admissions: getAdmissions(),
    diagnoses: getAllDiagnoses(),
    prescriptions: getAllPrescriptions(),
    mar: getAllMedicationAdministrations(),
    orders: getAllOrders(),
    results: getAllResults(),
    allergies: getAllAllergies(),
    staff: getStaff(),
    departments: getDepartments(),
    wards: getWards(),
    beds: getBeds(),
  };
}

const PRESETS: RangePreset[] = ["7d", "30d", "90d", "all", "custom"];

function isoDay(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

export default function ReportsPage() {
  const [data, setData] = useState<ReportData | null>(null);
  const [nowMs, setNowMs] = useState(0);
  const [preset, setPreset] = useState<RangePreset>("30d");
  const [customStart, setCustomStart] = useState("");
  const [customEnd, setCustomEnd] = useState("");

  useEffect(() => {
    const now = Date.now();
    setNowMs(now);
    setData(loadReportData());
    const monthAgo = now - 30 * 86_400_000;
    setCustomStart(isoDay(monthAgo));
    setCustomEnd(isoDay(now));
  }, []);

  const range: DateRange = useMemo(() => {
    if (preset === "custom") {
      const startMs = customStart ? Date.parse(`${customStart}T00:00:00.000Z`) : 0;
      const endMs = customEnd
        ? Date.parse(`${customEnd}T23:59:59.999Z`)
        : nowMs;
      return { startMs, endMs };
    }
    return presetRange(preset, nowMs);
  }, [preset, customStart, customEnd, nowMs]);

  const report: FullReport | null = useMemo(
    () => (data ? buildReport(data, range, nowMs) : null),
    [data, range, nowMs],
  );

  if (!report) {
    return (
      <div className="mx-auto max-w-6xl">
        <p className="text-sm text-muted-foreground">Loading reports…</p>
      </div>
    );
  }

  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-8">
      <header className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
        <div className="flex flex-col gap-1">
          <h1 className="text-2xl font-semibold tracking-tight">
            Operations &amp; analytics
          </h1>
          <p className="text-sm text-muted-foreground">
            Hospital-wide activity, occupancy, clinical and pharmacy metrics for
            the selected period. Export a full snapshot as PDF or Excel.
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <Button variant="outline" size="sm" onClick={() => exportReportPdf(report)}>
            <FileText className="size-4" /> PDF
          </Button>
          <Button variant="outline" size="sm" onClick={() => exportReportXlsx(report)}>
            <FileSpreadsheet className="size-4" /> Excel
          </Button>
        </div>
      </header>

      {/* Range selector */}
      <div className="flex flex-col gap-3 rounded-md border border-border bg-card p-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex flex-wrap items-center gap-1.5">
          {PRESETS.map((p) => (
            <Button
              key={p}
              variant={preset === p ? "default" : "ghost"}
              size="sm"
              onClick={() => setPreset(p)}
            >
              {RANGE_PRESET_LABEL[p]}
            </Button>
          ))}
        </div>
        {preset === "custom" ? (
          <div className="flex items-center gap-2">
            <Input
              type="date"
              value={customStart}
              max={customEnd || undefined}
              onChange={(e) => setCustomStart(e.target.value)}
              className="h-9 w-40"
              aria-label="Start date"
            />
            <span className="text-sm text-muted-foreground">to</span>
            <Input
              type="date"
              value={customEnd}
              min={customStart || undefined}
              onChange={(e) => setCustomEnd(e.target.value)}
              className="h-9 w-40"
              aria-label="End date"
            />
          </div>
        ) : (
          <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <Download className="size-3.5" />
            Exports reflect this period
          </span>
        )}
      </div>

      {/* KPI cards */}
      <section className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
        <Kpi icon={Activity} label="Total visits" value={report.kpis.totalVisits} />
        <Kpi icon={Stethoscope} label="Unique patients" value={report.kpis.uniquePatients} />
        <Kpi label="Admissions" value={report.kpis.admissionsStarted} />
        <Kpi label="Discharges" value={report.kpis.discharges} />
        <Kpi
          icon={BedDouble}
          label="Bed occupancy"
          value={`${report.kpis.bedOccupancyPct}%`}
        />
        <Kpi label="Outpatient" value={report.kpis.outpatient} accent={0} />
        <Kpi label="Inpatient" value={report.kpis.inpatient} accent={1} />
        <Kpi label="Emergency" value={report.kpis.emergency} accent={5} />
        <Kpi label="Current inpatients" value={report.kpis.currentInpatients} />
        <Kpi
          label="Avg length of stay"
          value={report.kpis.avgLosDays == null ? "—" : `${report.kpis.avgLosDays}d`}
        />
      </section>

      {/* Trend — full width */}
      <ChartCard
        title="Visit volume over time"
        description="Daily (or weekly for long spans) arrivals, stacked by visit type."
      >
        <StackedAreaTrend data={report.visitsOverTime} />
      </ChartCard>

      {/* Two-column chart grid */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <ChartCard title="Visit type mix">
          <Donut data={report.visitTypeMix} />
        </ChartCard>
        <ChartCard title="Department throughput">
          <HorizontalBars data={report.departmentThroughput} categorical />
        </ChartCard>

        <ChartCard title="Top diagnoses">
          <HorizontalBars data={report.topDiagnoses} categorical />
        </ChartCard>
        <ChartCard title="Length of stay" description="Discharged admissions in period.">
          <VerticalBars data={report.los.buckets} colorIndex={3} />
        </ChartCard>

        <ChartCard title="Ward occupancy">
          <HorizontalBars
            data={report.wardOccupancy.map((w) => ({
              key: w.key,
              label: w.ward,
              value: w.occupied,
            }))}
            categorical
          />
        </ChartCard>
        <ChartCard title="Bed status">
          <Donut data={report.bedStatusMix} />
        </ChartCard>

        <ChartCard title="Open visits by care stage">
          <VerticalBars data={report.stageDistribution} colorIndex={1} />
        </ChartCard>
        <ChartCard title="Medication administrations">
          <Donut data={report.medsByStatus} />
        </ChartCard>

        <ChartCard title="Top prescribed drugs">
          <HorizontalBars data={report.topDrugs} categorical />
        </ChartCard>
        <ChartCard title="Diagnostic orders">
          <Donut data={report.ordersByType} />
        </ChartCard>

        <ChartCard title="Patients by sex">
          <Donut data={report.sexMix} />
        </ChartCard>
        <ChartCard title="Patients by age">
          <VerticalBars data={report.ageDistribution} colorIndex={4} />
        </ChartCard>

        <ChartCard title="Clinician workload" description="Visits by attending doctor.">
          <HorizontalBars data={report.staffWorkload} categorical />
        </ChartCard>
        <ChartCard title="Allergy coverage">
          <Donut data={report.allergyPrevalence} />
        </ChartCard>

        <ChartCard title="Top allergens">
          <HorizontalBars data={report.topAllergens} categorical />
        </ChartCard>
        <ChartCard
          title="Discharge clearance bottlenecks"
          description="Active admissions still pending each gate."
        >
          <VerticalBars data={report.clearanceBottlenecks} colorIndex={5} />
        </ChartCard>
      </div>

      {/* Diagnostic abnormal-rate callout */}
      <ChartCard
        title="Diagnostic results"
        description={`${report.abnormal.total} result${report.abnormal.total === 1 ? "" : "s"} recorded in period.`}
      >
        <AbnormalBar
          abnormal={report.abnormal.abnormal}
          normal={report.abnormal.normal}
          pct={report.abnormal.pct}
        />
      </ChartCard>
    </div>
  );
}

function Kpi({
  icon: Icon,
  label,
  value,
  accent,
}: {
  icon?: typeof Activity;
  label: string;
  value: number | string;
  accent?: number;
}) {
  return (
    <Card>
      <CardContent className="flex flex-col gap-1 p-4">
        <span className="flex items-center gap-1.5 text-xs font-medium uppercase tracking-wide text-muted-foreground">
          {Icon ? <Icon className="size-3.5" /> : null}
          {accent != null ? (
            <span
              aria-hidden
              className="size-2 rounded-full"
              style={{ backgroundColor: `var(--chart-${accent + 1})` }}
            />
          ) : null}
          {label}
        </span>
        <span className="font-mono text-2xl font-semibold tabular-nums tracking-tight">
          {value}
        </span>
      </CardContent>
    </Card>
  );
}

function ChartCard({
  title,
  description,
  children,
  className,
}: {
  title: string;
  description?: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <Card className={className}>
      <CardHeader className="gap-1 pb-2">
        <CardTitle className="flex items-center gap-2 text-sm font-semibold">
          <BarChart3 className="size-4 text-muted-foreground" />
          {title}
        </CardTitle>
        {description ? (
          <p className="text-xs text-muted-foreground">{description}</p>
        ) : null}
      </CardHeader>
      <CardContent className="pt-1">{children}</CardContent>
    </Card>
  );
}

function AbnormalBar({
  abnormal,
  normal,
  pct,
}: {
  abnormal: number;
  normal: number;
  pct: number;
}) {
  const total = abnormal + normal;
  if (total === 0) {
    return (
      <p className="py-8 text-center text-xs text-muted-foreground">
        No results recorded in this period.
      </p>
    );
  }
  return (
    <div className="flex flex-col gap-3 py-2">
      <div className="flex items-end justify-between">
        <span className="font-mono text-3xl font-semibold tabular-nums">{pct}%</span>
        <span className="text-xs text-muted-foreground">
          {abnormal} abnormal · {normal} normal
        </span>
      </div>
      <div className="flex h-3 w-full overflow-hidden rounded-full bg-muted">
        <div
          className="h-full"
          style={{
            width: `${(abnormal / total) * 100}%`,
            backgroundColor: "var(--chart-6)",
          }}
        />
        <div
          className={cn("h-full flex-1")}
          style={{ backgroundColor: "var(--chart-3)" }}
        />
      </div>
    </div>
  );
}
