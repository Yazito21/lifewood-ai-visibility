"use client";

import { useState } from "react";

export type ChartPoint = { label: string; value: number | null };

function dateLabel(date: string) {
  return new Date(date + "T00:00:00+08:00").toLocaleDateString(undefined, { timeZone: "Asia/Kuala_Lumpur", month: "short", day: "numeric" });
}

function datesBetween(start: string, end: string) {
  const dates: string[] = [];
  const from = new Date(start + "T00:00:00Z");
  const to = new Date(end + "T00:00:00Z");
  if (!Number.isFinite(from.getTime()) || !Number.isFinite(to.getTime()) || from > to) return dates;
  for (const current = new Date(from); current <= to; current.setUTCDate(current.getUTCDate() + 1)) {
    dates.push(current.toISOString().slice(0, 10));
  }
  return dates;
}

export function MetricChart({
  data,
  title,
  description,
  format = "number",
  invert = false,
  tone = "default",
  dateRange,
  valueDecimals,
}: {
  data: ChartPoint[];
  title: string;
  description?: string;
  format?: "number" | "percent";
  /** True for rank/position metrics: zero is at the top and values increase downward. */
  invert?: boolean;
  tone?: "default" | "overall";
  dateRange?: { start: string; end: string };
  /** Decimal places for hover values on rank/position charts (axis ticks stay whole numbers). */
  valueDecimals?: number;
}) {
  const [activeDate, setActiveDate] = useState<string | null>(null);
  const chartDescription = description ?? (format === "percent"
    ? "Daily visibility score expressed as a percentage of recorded AI responses. Only observed dates are plotted."
    : "Daily visibility rank from recorded results; lower values indicate a stronger position. Only observed dates are plotted.");
  const valueByDate = new Map(data.map((point) => [point.label, point.value]));
  const observedDates = data
    .filter((point) => point.value !== null && Number.isFinite(point.value))
    .map((point) => point.label)
    .filter((label) => /^\d{4}-\d{2}-\d{2}$/.test(label))
    .sort();
  const requestedStart = dateRange?.start || observedDates[0];
  // Start at the first real observation for this specific series, not at another
  // topic's earlier date. Missing dates after the first observation remain gaps.
  const start = requestedStart && observedDates[0] && observedDates[0] > requestedStart
    ? observedDates[0]
    : requestedStart;
  const end = dateRange?.end || observedDates[observedDates.length - 1];
  const axisDates = start && end ? datesBetween(start, end) : observedDates;
  const allPoints = axisDates.map((date) => ({ label: date, value: valueByDate.get(date) ?? null }));
  const valid = allPoints.filter((point): point is { label: string; value: number } => point.value !== null && Number.isFinite(point.value));
  const display = (value: number) => invert ? (valueDecimals === undefined ? String(Math.round(value)) : value.toFixed(valueDecimals)) : format === "percent" ? value.toFixed(1) + "%" : Number.isInteger(value) ? String(value) : value.toFixed(1);
  const cardClass = "platform-card min-w-0 p-5 sm:p-6 " + (tone === "overall" ? "platform-card-overall" : "");
  if (!valid.length) return <div className={cardClass + " min-h-[19rem]"}><h4 className="text-base font-semibold">{title}</h4>{chartDescription && <p className="mt-1 text-base leading-relaxed text-[var(--muted-foreground)]">{chartDescription}</p>}<div className="flex min-h-[13rem] items-center justify-center text-center text-sm text-[var(--muted-foreground)]">No recorded values for this period. A new tracking run may be needed to populate this metric.</div></div>;

  const rawMax = Math.max(0, ...valid.map((point) => point.value));
  // Rank axes use whole-number ranks starting at 1 (best) at the top.
  const rankMax = Math.max(2, Math.ceil(rawMax));
  // Score charts use a fixed scale: labelled every 5.0% with a lighter gridline every 2.5%.
  const fixedPercent = format === "percent" && !invert;
  const percentTop = Math.max(5, Math.ceil(rawMax / 5) * 5);
  const max = fixedPercent ? percentTop : rawMax > 0 ? rawMax * 1.08 : 1;
  // 16:9 chart canvas with room for larger x-axis labels and title.
  const w = 1440, h = 810, left = 160, right = 48, top = 58, bottom = 150;
  const plotW = w - left - right, plotH = h - top - bottom;
  const points = allPoints.map((point, index) => {
    const x = left + (index / Math.max(allPoints.length - 1, 1)) * plotW;
    const normalized = Math.max(0, point.value ?? 0) / max;
    const y = invert
      ? top + ((Math.max(1, point.value ?? 1) - 1) / (rankMax - 1)) * plotH
      : top + (1 - normalized) * plotH;
    return { x, y, ...point };
  });
  // Connect consecutive observed values across missing dates. This is only a
  // visual bridge: null dates remain without markers or fabricated values.
  let drawingSegment = false;
  const path = points.map((point) => {
    if (point.value === null || !Number.isFinite(point.value)) return "";
    const command = drawingSegment ? "L" : "M";
    drawingSegment = true;
    return command + point.x.toFixed(1) + " " + point.y.toFixed(1);
  }).filter(Boolean).join(" ");
  const active = activeDate === null ? null : points.find((point) => point.label === activeDate && point.value !== null) ?? null;
  const yAxisTitle = format === "percent" ? (title.toLowerCase().includes("share of voice") ? "Share of voice (%)" : "Visibility (%)") : /position/i.test(title) ? "Average position" : /rank/i.test(title) ? "Rank" : "Value";
  // Whole ranks up to 25, then 1 followed by every 5th rank so large rank populations stay readable.
  const rankTicks = rankMax <= 25
    ? Array.from({ length: rankMax }, (_, i) => i + 1)
    : [1, ...Array.from({ length: Math.floor(rankMax / 5) }, (_, i) => (i + 1) * 5)];
  const tickValues = invert
    ? rankTicks
    : fixedPercent
      ? Array.from({ length: percentTop / 2.5 + 1 }, (_, i) => percentTop - i * 2.5)
      : Array.from({ length: 5 }, (_, i) => max - (max * i) / 4);
  const showMinorLabels = percentTop <= 30;
  const tickStep = axisDates.length <= 14 ? 1 : axisDates.length <= 31 ? 2 : axisDates.length <= 90 ? 7 : Math.ceil(axisDates.length / 10);
  const tickIndexes = axisDates.map((_, index) => index).filter((index) =>
    index === 0 || index === axisDates.length - 1 || index % tickStep === 0
  );
  const tooltipX = active ? Math.max(left + 54, Math.min(w - right - 54, active.x)) : 0;
  const tooltipY = active ? Math.max(top + 23, active.y - 34) : 0;

  return <div className={cardClass}>
    <div className="mb-4"><h4 className="text-lg font-semibold">{title}</h4>{chartDescription && <p className="mt-1 text-base leading-relaxed text-[var(--muted-foreground)]">{chartDescription}</p>}</div>
    <svg viewBox={"0 0 " + w + " " + h} className="block h-auto w-full overflow-visible" role="img" aria-label={title}>
      {tickValues.map((value, i) => {
        const y = invert ? top + ((value - 1) / (rankMax - 1)) * plotH : fixedPercent ? top + (1 - value / max) * plotH : top + (i / 4) * plotH;
        const minor = fixedPercent && value % 5 !== 0;
        const label = invert ? String(Math.round(value)) : display(value);
        return <g key={i}>
          <line x1={left} y1={y} x2={w - right} y2={y} stroke="var(--muted-foreground)" strokeOpacity={minor ? 0.1 : 0.18} strokeDasharray="4 6" strokeWidth={minor ? 1 : 1.5} />
          {(!minor || showMinorLabels) && <text x={left - 14} y={y + (minor ? 4 : 5)} textAnchor="end" fontSize={minor ? 18 : 24} fontWeight={minor ? 500 : 600} fill="var(--muted-foreground)" fillOpacity={minor ? 0.75 : 1}>{label}</text>}
        </g>;
      })}
      {tickIndexes.map((index) => {
        const date = axisDates[index];
        const x = left + (index / Math.max(axisDates.length - 1, 1)) * plotW;
        return <g key={date}>
          <line x1={x} y1={top} x2={x} y2={top + plotH} stroke="var(--muted-foreground)" strokeOpacity="0.10" strokeDasharray="3 6" />
          <text
            x={x}
            y={top + plotH + (axisDates.length <= 14 ? 42 : 32)}
            transform={axisDates.length <= 14 ? "rotate(-35 " + x + " " + (top + plotH + 38) + ")" : undefined}
            textAnchor={axisDates.length <= 14 ? "end" : index === 0 ? "start" : index === axisDates.length - 1 ? "end" : "middle"}
            fontSize="22"
            fontWeight="600"
            fill="var(--muted-foreground)"
          >{dateLabel(date)}</text>
        </g>;
      })}
      <line x1={left} y1={top} x2={left} y2={top + plotH} stroke="var(--foreground)" strokeOpacity="0.65" strokeWidth="2.2" />
      <line x1={left} y1={top + plotH} x2={w - right} y2={top + plotH} stroke="var(--foreground)" strokeOpacity="0.65" strokeWidth="2.2" />
      <text x={22} y={top + plotH / 2} transform={"rotate(-90 22 " + (top + plotH / 2) + ")"} textAnchor="middle" fontSize="24" fontWeight="700" fill="var(--foreground)">{yAxisTitle}</text>
      <text x={left + plotW / 2} y={h - 22} textAnchor="middle" fontSize="25" fontWeight="700" fill="var(--foreground)">Tracking date</text>
      <path d={path} fill="none" stroke={tone === "overall" ? "var(--orange)" : "var(--primary)"} strokeWidth="5.5" strokeLinecap="round" strokeLinejoin="round" />
      {points.map((point) => point.value === null || !Number.isFinite(point.value) ? null : <circle key={point.label} cx={point.x} cy={point.y} r={activeDate === point.label ? 13 : 11} fill={tone === "overall" ? "var(--orange)" : "var(--primary)"} stroke="var(--card)" strokeWidth="3" tabIndex={0} role="button" aria-label={dateLabel(point.label) + ": " + display(point.value)} onMouseEnter={() => setActiveDate(point.label)} onMouseLeave={() => setActiveDate(null)} onFocus={() => setActiveDate(point.label)} onBlur={() => setActiveDate(null)}><title>{dateLabel(point.label)}: {display(point.value)}</title></circle>)}
      {active && active.value !== null && <g pointerEvents="none">
        <line x1={active.x} y1={active.y} x2={active.x} y2={top + plotH} stroke="var(--primary)" strokeOpacity="0.38" strokeDasharray="4 4" />
        <rect x={tooltipX - 54} y={tooltipY - 22} width="108" height="30" rx="8" fill="var(--foreground)" />
        <text x={tooltipX} y={tooltipY - 2} textAnchor="middle" fontSize="17" fontWeight="700" fill="var(--background)">{display(active.value)}</text>
      </g>}
    </svg>
  </div>;
}
