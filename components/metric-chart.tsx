"use client";

export type ChartPoint = { label: string; value: number | null };

export function MetricChart({ data, title, format = "number", invert = false }: { data: ChartPoint[]; title: string; format?: "number" | "percent"; invert?: boolean }) {
  const valid = data.filter((point) => point.value !== null) as { label: string; value: number }[];
  const display = (value: number) => format === "percent" ? value.toFixed(1) + "%" : Number.isInteger(value) ? String(value) : value.toFixed(1);
  if (!valid.length) return <div className="platform-card flex min-h-[19rem] items-center justify-center px-6 text-center text-sm text-[var(--muted-foreground)]">No data for this period.</div>;

  const values = valid.map((point) => point.value);
  const min = Math.min(...values), max = Math.max(...values), range = max - min || 1;
  const w = 900, h = 270, padX = 42, padY = 32;
  const points = valid.map((point, index) => {
    const x = padX + (index / Math.max(valid.length - 1, 1)) * (w - padX * 2);
    const normalized = (point.value - min) / range;
    const y = invert ? padY + normalized * (h - padY * 2) : padY + (1 - normalized) * (h - padY * 2);
    return { x, y, ...point };
  });
  const path = points.map((point, index) => (index ? "L" : "M") + point.x.toFixed(1) + " " + point.y.toFixed(1)).join(" ");
  const latest = points[points.length - 1];
  const latestLabelY = latest.y < 52 ? latest.y + 23 : latest.y - 13;
  const latestLabelX = latest.x >= w - 100 ? latest.x - 9 : latest.x + 9;
  const latestLabelAnchor = latest.x >= w - 100 ? "end" : "start";

  return <div className="platform-card min-w-0 p-5 sm:p-6">
    <div className="mb-4"><h4 className="text-sm font-semibold">{title}</h4></div>
    <svg viewBox={"0 0 " + w + " " + h} className="h-64 w-full overflow-visible" role="img" aria-label={title}>
      <line x1={padX} y1={h - padY} x2={w - padX} y2={h - padY} stroke="var(--input)" />
      <line x1={padX} y1={padY} x2={padX} y2={h - padY} stroke="var(--input)" />
      <path d={path} fill="none" stroke="var(--primary)" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
      {points.map((point, index) => <circle key={index} cx={point.x} cy={point.y} r={index === points.length - 1 ? 5 : 3.5} fill={index === points.length - 1 ? "var(--orange)" : "var(--primary)"} stroke="var(--card)" strokeWidth="2"><title>{point.label}: {display(point.value)}</title></circle>)}
      <text
        x={latestLabelX}
        y={latestLabelY}
        textAnchor={latestLabelAnchor}
        fontSize="15"
        fontWeight="700"
        fill="var(--foreground)"
        stroke="var(--card)"
        strokeWidth="4"
        strokeLinejoin="round"
        paintOrder="stroke"
      >{display(latest.value)}</text>
    </svg>
    <div className="flex justify-between text-[11px] font-medium text-[var(--muted-foreground)]"><span>{valid[0].label}</span><span>{valid[valid.length - 1].label}</span></div>
  </div>;
}
