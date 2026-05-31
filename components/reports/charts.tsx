"use client";

/**
 * Recharts presentation primitives for the reports dashboard (Phase 12).
 *
 * All colors come from the `--chart-*` theme tokens (via CHART_COLORS), so every
 * chart adapts to light/dark automatically — no hardcoded hues. Axis text, grids
 * and tooltips are likewise driven by semantic tokens.
 */

import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  Cell,
  Legend,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

import { CHART_COLORS, type CountSlice, type TimeBucket } from "./reports";

const AXIS_TICK = { fill: "var(--muted-foreground)", fontSize: 11 };
const GRID_STROKE = "var(--border)";

const TOOLTIP_STYLE = {
  background: "var(--popover)",
  border: "1px solid var(--border)",
  borderRadius: 8,
  color: "var(--popover-foreground)",
  fontSize: 12,
  boxShadow: "0 4px 12px rgb(0 0 0 / 0.08)",
} as const;

const TOOLTIP_ITEM = { color: "var(--popover-foreground)" } as const;
const TOOLTIP_LABEL = { color: "var(--muted-foreground)", marginBottom: 2 } as const;

function EmptyChart({ height }: { height: number }) {
  return (
    <div
      className="flex items-center justify-center rounded-md border border-dashed border-border bg-muted/20 text-xs text-muted-foreground"
      style={{ height }}
    >
      No data in this period
    </div>
  );
}

/** Stacked area trend for the three visit types over time. */
export function StackedAreaTrend({
  data,
  height = 260,
}: {
  data: TimeBucket[];
  height?: number;
}) {
  if (data.every((b) => b.total === 0)) return <EmptyChart height={height} />;
  return (
    <ResponsiveContainer width="100%" height={height}>
      <AreaChart data={data} margin={{ top: 8, right: 8, left: -16, bottom: 0 }}>
        <defs>
          {[0, 1, 5].map((c, idx) => (
            <linearGradient key={c} id={`area-${idx}`} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={CHART_COLORS[c]} stopOpacity={0.5} />
              <stop offset="100%" stopColor={CHART_COLORS[c]} stopOpacity={0.04} />
            </linearGradient>
          ))}
        </defs>
        <XAxis
          dataKey="label"
          tick={AXIS_TICK}
          tickLine={false}
          axisLine={{ stroke: GRID_STROKE }}
          minTickGap={24}
        />
        <YAxis tick={AXIS_TICK} tickLine={false} axisLine={false} allowDecimals={false} width={36} />
        <Tooltip
          contentStyle={TOOLTIP_STYLE}
          itemStyle={TOOLTIP_ITEM}
          labelStyle={TOOLTIP_LABEL}
          cursor={{ stroke: GRID_STROKE }}
        />
        <Legend wrapperStyle={{ fontSize: 12 }} iconType="circle" />
        <Area
          type="monotone"
          dataKey="outpatient"
          name="Outpatient"
          stackId="1"
          stroke={CHART_COLORS[0]}
          fill="url(#area-0)"
        />
        <Area
          type="monotone"
          dataKey="inpatient"
          name="Inpatient"
          stackId="1"
          stroke={CHART_COLORS[1]}
          fill="url(#area-1)"
        />
        <Area
          type="monotone"
          dataKey="emergency"
          name="Emergency"
          stackId="1"
          stroke={CHART_COLORS[5]}
          fill="url(#area-2)"
        />
      </AreaChart>
    </ResponsiveContainer>
  );
}

/** Donut with a centered total and a side legend. */
export function Donut({
  data,
  height = 240,
}: {
  data: CountSlice[];
  height?: number;
}) {
  const total = data.reduce((s, d) => s + d.value, 0);
  if (total === 0) return <EmptyChart height={height} />;
  return (
    <ResponsiveContainer width="100%" height={height}>
      <PieChart>
        <Pie
          data={data}
          dataKey="value"
          nameKey="label"
          innerRadius="58%"
          outerRadius="82%"
          paddingAngle={1.5}
          stroke="var(--card)"
          strokeWidth={2}
        >
          {data.map((slice, i) => (
            <Cell key={slice.key} fill={CHART_COLORS[i % CHART_COLORS.length]} />
          ))}
        </Pie>
        <Tooltip
          contentStyle={TOOLTIP_STYLE}
          itemStyle={TOOLTIP_ITEM}
          labelStyle={TOOLTIP_LABEL}
        />
        <Legend
          layout="vertical"
          align="right"
          verticalAlign="middle"
          iconType="circle"
          wrapperStyle={{ fontSize: 12 }}
        />
      </PieChart>
    </ResponsiveContainer>
  );
}

/** Horizontal bars — good for ranked lists (diagnoses, drugs, departments). */
export function HorizontalBars({
  data,
  height = 260,
  categorical = false,
}: {
  data: CountSlice[];
  height?: number;
  categorical?: boolean;
}) {
  if (data.length === 0 || data.every((d) => d.value === 0)) {
    return <EmptyChart height={height} />;
  }
  return (
    <ResponsiveContainer width="100%" height={height}>
      <BarChart
        layout="vertical"
        data={data}
        margin={{ top: 4, right: 16, left: 8, bottom: 0 }}
      >
        <XAxis type="number" tick={AXIS_TICK} tickLine={false} axisLine={false} allowDecimals={false} />
        <YAxis
          type="category"
          dataKey="label"
          tick={AXIS_TICK}
          tickLine={false}
          axisLine={false}
          width={140}
        />
        <Tooltip
          contentStyle={TOOLTIP_STYLE}
          itemStyle={TOOLTIP_ITEM}
          labelStyle={TOOLTIP_LABEL}
          cursor={{ fill: "var(--accent)", opacity: 0.4 }}
        />
        <Bar dataKey="value" name="Count" radius={[0, 4, 4, 0]} maxBarSize={26}>
          {data.map((slice, i) => (
            <Cell
              key={slice.key}
              fill={categorical ? CHART_COLORS[i % CHART_COLORS.length] : CHART_COLORS[0]}
            />
          ))}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}

/** Vertical bars — good for ordered bands (age, length of stay). */
export function VerticalBars({
  data,
  height = 240,
  colorIndex = 2,
}: {
  data: CountSlice[];
  height?: number;
  colorIndex?: number;
}) {
  if (data.length === 0 || data.every((d) => d.value === 0)) {
    return <EmptyChart height={height} />;
  }
  return (
    <ResponsiveContainer width="100%" height={height}>
      <BarChart data={data} margin={{ top: 8, right: 8, left: -16, bottom: 0 }}>
        <XAxis dataKey="label" tick={AXIS_TICK} tickLine={false} axisLine={{ stroke: GRID_STROKE }} />
        <YAxis tick={AXIS_TICK} tickLine={false} axisLine={false} allowDecimals={false} width={36} />
        <Tooltip
          contentStyle={TOOLTIP_STYLE}
          itemStyle={TOOLTIP_ITEM}
          labelStyle={TOOLTIP_LABEL}
          cursor={{ fill: "var(--accent)", opacity: 0.4 }}
        />
        <Bar
          dataKey="value"
          name="Count"
          radius={[4, 4, 0, 0]}
          maxBarSize={48}
          fill={CHART_COLORS[colorIndex % CHART_COLORS.length]}
        />
      </BarChart>
    </ResponsiveContainer>
  );
}
