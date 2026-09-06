"use client";

import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

/**
 * Dashboard charts.
 *
 * All three are single-series horizontal bars. Category identity is carried by
 * the axis label in every case, so colour is not doing identity work: one hue
 * is used throughout, which sidesteps colour-vision separation problems
 * entirely and keeps the charts legible in print and in forced-colours mode.
 * A table of the same figures sits beside or beneath each chart.
 *
 * Palette: the firm's teal, stepped down from the wordmark's sage so it carries
 * enough weight against a white surface. It clears the lightness band and 3:1
 * contrast. It sits under the categorical chroma floor, which is deliberate and
 * fine here: that floor exists so several series stay distinguishable from one
 * another, and these charts have one series whose identity comes from the axis
 * label. A muted teal is also simply what this brand is — saturating it enough
 * to clear a floor that does not apply would just make it the wrong colour.
 */

const SERIES = "#3F7F82";
const SERIES_MUTED = "#B9CFD0";
const GRID = "#E4E8EA";
const TEXT_SECONDARY = "#4A5763";

export type BarDatum = {
  label: string;
  value: number;
  /** Optional secondary figure shown in the tooltip, e.g. a percentage. */
  detail?: string;
  /** Rendered in the muted step — used for the "no agent record" bucket. */
  muted?: boolean;
};

function ChartTooltip({
  active,
  payload,
}: {
  active?: boolean;
  payload?: { payload: BarDatum }[];
}) {
  if (!active || !payload?.length) return null;
  const datum = payload[0]!.payload;
  return (
    <div className="rounded-md border border-ink-200 bg-white px-2.5 py-1.5 text-xs shadow-sm">
      <p className="font-medium text-ink-900">{datum.label}</p>
      <p className="tnum text-ink-600">
        {datum.value.toLocaleString("en-US")}
        {datum.detail ? ` · ${datum.detail}` : ""}
      </p>
    </div>
  );
}

export function HorizontalBars({
  data,
  height,
  labelWidth = 190,
}: {
  data: BarDatum[];
  height?: number;
  labelWidth?: number;
}) {
  if (data.length === 0) {
    return <p className="py-6 text-center text-xs text-ink-500">No data yet.</p>;
  }

  // 28px per row keeps the bars thin and the labels from colliding.
  const computedHeight = height ?? Math.max(120, data.length * 28 + 24);

  return (
    <ResponsiveContainer width="100%" height={computedHeight}>
      <BarChart
        data={data}
        layout="vertical"
        margin={{ top: 4, right: 44, bottom: 4, left: 0 }}
        barCategoryGap={6}
      >
        <CartesianGrid horizontal={false} stroke={GRID} />
        <XAxis
          type="number"
          tick={{ fontSize: 11, fill: TEXT_SECONDARY }}
          axisLine={false}
          tickLine={false}
          allowDecimals={false}
        />
        <YAxis
          type="category"
          dataKey="label"
          width={labelWidth}
          tick={{ fontSize: 11, fill: TEXT_SECONDARY }}
          axisLine={false}
          tickLine={false}
          interval={0}
        />
        <Tooltip
          content={<ChartTooltip />}
          cursor={{ fill: "rgba(63,127,130,0.07)" }}
        />
        <Bar dataKey="value" radius={[0, 4, 4, 0]} maxBarSize={16} isAnimationActive={false}>
          {data.map((datum) => (
            <Cell key={datum.label} fill={datum.muted ? SERIES_MUTED : SERIES} />
          ))}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}
