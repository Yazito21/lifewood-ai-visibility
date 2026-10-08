"use client";

export type ChartPoint = { label: string; value: number | null };

export function MetricChart({ data, title, format = "number", invert = false }: { data: ChartPoint[]; title: string; format?: "number" | "percent"; invert?: boolean }) {
  const valid = data.filter((point) => point.value !== null) as { label: string; value: number }[];
  if (!valid.length) return <div className="flex min-h-[19rem] items-center justify-center rounded-2xl border border-[var(--border)] bg-[var(--card)] px-6 text-center text-sm text-[var(--muted-foreground)]">No data for this period.</div>;
  const values = valid.map((point) => point.value);
  const min = Math.min(...values), max = Math.max(...values), range = max - min || 1;
  const w = 900, h = 270, padX = 42, padY = 28;
  const points = valid.map((point, index) => {
    const x = padX + (index / Math.max(valid.length - 1, 1)) * (w - padX * 2);
    const normalized = (point.value - min) / range;
    const y = invert ? padY + normalized * (h - padY * 2) : padY + (1 - normalized) * (h - padY * 2);
    return { x, y, ...point };
  });
  const path = points.map((point, index) => (index ? "L" : "M") + point.x.toFixed(1) + " " + point.y.toFixed(1)).join(" ");
  const display = (value: number) => format === "percent" ? value.toFixed(1) + "%" : Number.isInteger(value) ? String(value) : value.toFixed(1);
  return <div className="ops-card p-5 sm:p-6">
    <div className="mb-3 flex items-center justify-between gap-4"><h4 className="text-sm font-semibold">{title}</h4><span className="shrink-0 text-xs font-semibold text-[var(--muted-foreground)]">{display(valid[valid.length - 1].value)} latest</span></div>
    <svg viewBox={"0 0 " + w + " " + h} className="h-64 w-full" role="img" aria-label={title}>
      <line x1={padX} y1={h - padY} x2={w - padX} y2={h - padY} stroke="#d9ded9" /><line x1={padX} y1={padY} x2={padX} y2={h - padY} stroke="#d9ded9" />
      <path d={path} fill="none" stroke="#0d5b3a" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
      {points.map((point, index) => <circle key={index} cx={point.x} cy={point.y} r="4" fill="#f5b64c" stroke="#0d5b3a" strokeWidth="2"><title>{point.label}: {display(point.value)}</title></circle>)}
    </svg>
    <div className="flex justify-between text-[11px] font-medium text-[var(--muted-foreground)]"><span>{valid[0].label}</span><span>{valid[valid.length - 1].label}</span></div>
  </div>;
}