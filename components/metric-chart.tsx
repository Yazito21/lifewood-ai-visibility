"use client";

import { useState } from "react";

export type ChartPoint = { label: string; value: number | null };

export function MetricChart({ data, title, description, format = "number", invert = false, tone = "default" }: { data: ChartPoint[]; title: string; description?: string; format?: "number" | "percent"; invert?: boolean; tone?: "default" | "overall" }) {
  const [activeIndex, setActiveIndex] = useState<number | null>(null);
  const valid = data.filter((point) => point.value !== null) as { label: string; value: number }[];
  const display = (value: number) => format === "percent" ? value.toFixed(1) + "%" : Number.isInteger(value) ? String(value) : value.toFixed(1);
  const cardClass = "platform-card min-w-0 p-5 sm:p-6 " + (tone === "overall" ? "platform-card-overall" : "");
  if (!valid.length) return <div className={cardClass + " min-h-[19rem]"}><h4 className="text-base font-semibold">{title}</h4>{description && <p className="mt-1 text-sm text-[var(--muted-foreground)]">{description}</p>}<div className="flex min-h-[13rem] items-center justify-center text-center text-sm text-[var(--muted-foreground)]">No recorded values for this period. A new tracking run may be needed to populate this metric.</div></div>;

  const values = valid.map((point) => point.value);
  const rawMin = Math.min(...values), rawMax = Math.max(...values);
  const range = rawMax - rawMin || Math.max(Math.abs(rawMax) * 0.1, 1);
  const min = rawMin === rawMax ? rawMin - range * 0.5 : rawMin - range * 0.08;
  const max = rawMin === rawMax ? rawMax + range * 0.5 : rawMax + range * 0.08;
  const w = 900, h = 370, left = 94, right = 30, top = 38, bottom = 78;
  const plotW = w - left - right, plotH = h - top - bottom;
  const points = valid.map((point, index) => {
    const x = left + (index / Math.max(valid.length - 1, 1)) * plotW;
    const normalized = (point.value - min) / (max - min);
    const y = invert ? top + normalized * plotH : top + (1 - normalized) * plotH;
    return { x, y, ...point };
  });
  const path = points.map((point, index) => (index ? "L" : "M") + point.x.toFixed(1) + " " + point.y.toFixed(1)).join(" ");
  const active = activeIndex === null ? null : points[activeIndex];
  const yAxisTitle = format === "percent" ? "Visibility (%)" : /rank/i.test(title) ? "Rank (1 = best)" : /position/i.test(title) ? "Average position" : "Value";
  const tickValues = Array.from({ length: 5 }, (_, i) => max - ((max - min) * i) / 4);
  const xTickIndexes = Array.from(new Set(Array.from({ length: Math.min(5, points.length) }, (_, i) => Math.round(i * (points.length - 1) / Math.max(Math.min(5, points.length) - 1, 1)))));
  const tooltipX = active ? Math.max(left + 54, Math.min(w - right - 54, active.x)) : 0;
  const tooltipY = active ? Math.max(top + 23, active.y - 34) : 0;

  return <div className={cardClass}>
    <div className="mb-3"><h4 className="text-base font-semibold">{title}</h4>{description && <p className="mt-1 text-sm text-[var(--muted-foreground)]">{description}</p>}</div>
    <svg viewBox={"0 0 " + w + " " + h} className="h-[330px] w-full overflow-visible sm:h-[350px]" role="img" aria-label={title}>
      {tickValues.map((value, i) => {
        const y = top + (i / 4) * plotH;
        return <g key={i}>
          <line x1={left} y1={y} x2={w - right} y2={y} stroke="var(--muted-foreground)" strokeOpacity="0.18" strokeDasharray="4 6" strokeWidth="1.2" />
          <text x={left - 14} y={y + 5} textAnchor="end" fontSize="14" fontWeight="600" fill="var(--muted-foreground)">{display(value)}</text>
        </g>;
      })}
      {xTickIndexes.map((index) => {
        const point = points[index];
        return <g key={point.label + index}>
          <line x1={point.x} y1={top} x2={point.x} y2={top + plotH} stroke="var(--muted-foreground)" strokeOpacity="0.10" strokeDasharray="3 6" />
          <text x={point.x} y={top + plotH + 26} textAnchor={index === 0 ? "start" : index === points.length - 1 ? "end" : "middle"} fontSize="13" fontWeight="600" fill="var(--muted-foreground)">{point.label}</text>
        </g>;
      })}
      <line x1={left} y1={top} x2={left} y2={top + plotH} stroke="var(--foreground)" strokeOpacity="0.65" strokeWidth="1.8" />
      <line x1={left} y1={top + plotH} x2={w - right} y2={top + plotH} stroke="var(--foreground)" strokeOpacity="0.65" strokeWidth="1.8" />
      <text x={22} y={top + plotH / 2} transform={"rotate(-90 22 " + (top + plotH / 2) + ")"} textAnchor="middle" fontSize="13" fontWeight="700" fill="var(--foreground)">{yAxisTitle}</text>
      <text x={left + plotW / 2} y={h - 12} textAnchor="middle" fontSize="13" fontWeight="700" fill="var(--foreground)">Tracking date</text>
      <path d={path} fill="none" stroke={tone === "overall" ? "var(--orange)" : "var(--primary)"} strokeWidth="3.5" strokeLinecap="round" strokeLinejoin="round" />
      {points.map((point, index) => <circle key={point.label + index} cx={point.x} cy={point.y} r={activeIndex === index ? 7 : 5} fill={tone === "overall" ? "var(--orange)" : "var(--primary)"} stroke="var(--card)" strokeWidth="2.5" tabIndex={0} role="button" aria-label={point.label + ": " + display(point.value)} onMouseEnter={() => setActiveIndex(index)} onMouseLeave={() => setActiveIndex(null)} onFocus={() => setActiveIndex(index)} onBlur={() => setActiveIndex(null)}><title>{point.label}: {display(point.value)}</title></circle>)}
      {active && <g pointerEvents="none">
        <line x1={active.x} y1={active.y} x2={active.x} y2={top + plotH} stroke="var(--primary)" strokeOpacity="0.38" strokeDasharray="4 4" />
        <rect x={tooltipX - 54} y={tooltipY - 22} width="108" height="30" rx="8" fill="var(--foreground)" />
        <text x={tooltipX} y={tooltipY - 2} textAnchor="middle" fontSize="14" fontWeight="700" fill="var(--background)">{display(active.value)}</text>
      </g>}
    </svg>
  </div>;
}
