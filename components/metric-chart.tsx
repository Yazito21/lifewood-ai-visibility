"use client";

export type ChartPoint = { label: string; value: number | null };

export function MetricChart({ data, title, description, format = "number", invert = false, tone = "default" }: { data: ChartPoint[]; title: string; description?: string; format?: "number" | "percent"; invert?: boolean; tone?: "default" | "overall" }) {
  const valid = data.filter((point) => point.value !== null) as { label: string; value: number }[];
  const display = (value: number) => format === "percent" ? value.toFixed(1) + "%" : Number.isInteger(value) ? String(value) : value.toFixed(1);
  if (!valid.length) return <div className={"platform-card min-w-0 min-h-[19rem] p-5 sm:p-6 " + (tone === "overall" ? "platform-card-overall" : "")}><h4 className="text-base font-semibold">{title}</h4>{description && <p className="mt-1 text-sm text-[var(--muted-foreground)]">{description}</p>}<div className="flex min-h-[13rem] items-center justify-center text-center text-sm text-[var(--muted-foreground)]">No recorded values for this period. A new tracking run may be needed to populate this metric.</div></div>;

  const values = valid.map((point) => point.value);
  const min = Math.min(...values), max = Math.max(...values), range = max - min || 1;
  const w = 900, h = 300, padX = 56, padY = 42;
  const points = valid.map((point, index) => {
    const x = padX + (index / Math.max(valid.length - 1, 1)) * (w - padX * 2);
    const normalized = (point.value - min) / range;
    const y = invert ? padY + normalized * (h - padY * 2) : padY + (1 - normalized) * (h - padY * 2);
    return { x, y, ...point };
  });
  const path = points.map((point, index) => (index ? "L" : "M") + point.x.toFixed(1) + " " + point.y.toFixed(1)).join(" ");
  const latest = points[points.length - 1];
  const latestLabelY = latest.y < 62 ? latest.y + 29 : latest.y - 16;
  const latestLabelX = latest.x >= w - 120 ? latest.x - 12 : latest.x + 12;
  const latestLabelAnchor = latest.x >= w - 100 ? "end" : "start";

  return <div className={"platform-card min-w-0 p-5 sm:p-6 " + (tone === "overall" ? "platform-card-overall" : "")}>
    <div className="mb-4"><h4 className="text-base font-semibold">{title}</h4>{description && <p className="mt-1 text-xs text-[var(--muted-foreground)]">{description}</p>}</div>
    <svg viewBox={"0 0 " + w + " " + h} className="h-72 w-full overflow-visible" role="img" aria-label={title}>
      <line x1={padX} y1={h - padY} x2={w - padX} y2={h - padY} stroke="var(--input)" strokeWidth="1.5" />
      <line x1={padX} y1={padY} x2={padX} y2={h - padY} stroke="var(--input)" strokeWidth="1.5" />
      <path d={path} fill="none" stroke={tone === "overall" ? "var(--orange)" : "var(--primary)"} strokeWidth="5" strokeLinecap="round" strokeLinejoin="round" />
      {points.map((point, index) => <circle key={index} cx={point.x} cy={point.y} r={index === points.length - 1 ? 6.5 : 4.5} fill={tone === "overall" ? "var(--orange)" : index === points.length - 1 ? "var(--orange)" : "var(--primary)"} stroke="var(--card)" strokeWidth="2.5"><title>{point.label}: {display(point.value)}</title></circle>)}
      <text
        x={latestLabelX}
        y={latestLabelY}
        textAnchor={latestLabelAnchor}
        fontSize="18"
        fontWeight="700"
        fill="var(--foreground)"
        stroke="var(--card)"
        strokeWidth="4"
        strokeLinejoin="round"
        paintOrder="stroke"
      >{display(latest.value)}</text>
    </svg>
    <div className="flex justify-between text-sm font-semibold text-[var(--muted-foreground)]"><span>{valid[0].label}</span><span>{valid[valid.length - 1].label}</span></div>
  </div>;
}
