// SVG charts for the audit report. Print-safe (no canvas, no JS needed to render), labelled, with a
// native <title> tooltip on every mark. Categorical palette validated with the dataviz validator
// (light mode): #0a7d4e, #e0901f, #3f6fb5, #b0457a — values are always printed beside marks
// because the orange is below 3:1 contrast.
import { arcPath, donutSlices, linePath, linearScale, niceMax, thinLabels } from "@/lib/chart-geometry";
import { rating, type Tone } from "@/lib/report-view";

export const SERIES = ["#0a7d4e", "#e0901f", "#3f6fb5", "#b0457a"] as const;
export const MUTED_MARK = "#b9c9bf";
const GRID = "#e4e0d6";
const INK = "#133020";
const MUTED = "#617064";
const TONE_COLOR: Record<Tone, string> = { good: "#0a7d4e", fair: "#e0901f", poor: "#a13f35" };

type Format = "number" | "percent";
const show = (v: number | null, format: Format = "number", dp = 1) =>
  v === null || !Number.isFinite(v) ? "—" : v.toLocaleString("en-GB", { maximumFractionDigits: dp }) + (format === "percent" ? "%" : "");

function Empty({ title }: { title: string }) {
  return <div className="report-chart"><p className="report-chart-title">{title}</p><p className="report-chart-empty">No data for this period</p></div>;
}

function Legend({ items }: { items: { name: string; color: string }[] }) {
  return <ul className="report-legend">{items.map((item) => <li key={item.name}><span style={{ background: item.color }} />{item.name}</li>)}</ul>;
}

/** 240° gauge with the score in the centre and its rating underneath (never colour alone). */
export function ScoreGauge({ label, score, max = 100 }: { label: string; score: number | null; max?: number }) {
  const r = rating(score);
  const value = score === null ? 0 : Math.max(0, Math.min(max, score));
  const end = -120 + (240 * value) / max;
  return <figure className="report-gauge" role="img" aria-label={`${label}: ${score === null ? "not measured" : Math.round(score) + " out of " + max}, ${r.label}`}>
    <svg viewBox="0 0 120 96">
      <title>{`${label}: ${score === null ? "not measured" : Math.round(score)}`}</title>
      <path d={arcPath(60, 60, 46, -120, 120)} fill="none" stroke={GRID} strokeWidth="10" strokeLinecap="round" />
      {score !== null && value > 0 && <path d={arcPath(60, 60, 46, -120, end)} fill="none" stroke={TONE_COLOR[r.tone]} strokeWidth="10" strokeLinecap="round" />}
      <text x="60" y="62" textAnchor="middle" fontSize="26" fontWeight="800" fill={INK}>{score === null ? "—" : Math.round(score)}</text>
      <text x="60" y="80" textAnchor="middle" fontSize="10" fontWeight="600" fill={MUTED}>{r.label}</text>
    </svg>
    <figcaption>{label}</figcaption>
  </figure>;
}

export type BarItem = { label: string; value: number | null; highlight?: boolean };

/** Horizontal bars, value at the tip. The highlighted bar (the client's brand) is green, others muted. */
export function BarChart({ title, items, format = "number", max }: { title: string; items: BarItem[]; format?: Format; max?: number }) {
  if (!items.length || items.every((i) => i.value === null)) return <Empty title={title} />;
  const rowH = 26;
  const labelW = 132;
  const width = 420;
  const top = max ?? niceMax(items.map((i) => i.value), { percent: format === "percent" && items.every((i) => (i.value ?? 0) <= 100) });
  const x = linearScale([0, top], [labelW, width - 56]);
  const height = items.length * rowH + 4;
  return <div className="report-chart">
    <p className="report-chart-title">{title}</p>
    <svg viewBox={`0 0 ${width} ${height}`} role="img" aria-label={title + ": " + items.map((i) => `${i.label} ${show(i.value, format)}`).join(", ")}>
      <title>{title}</title>
      <line x1={labelW} x2={labelW} y1={0} y2={height} stroke={GRID} />
      {items.map((item, i) => {
        const y = i * rowH + 5;
        const w = item.value === null ? 0 : Math.max(item.value > 0 ? 2 : 0, x(item.value) - labelW);
        return <g key={item.label + i}>
          <title>{`${item.label}: ${show(item.value, format)}`}</title>
          <text x={labelW - 8} y={y + 12} textAnchor="end" fontSize="11" fontWeight={item.highlight ? 700 : 500} fill={INK}>{truncate(item.label, 20)}</text>
          {w > 0 && <rect x={labelW} y={y + 2} width={w} height={16} rx={4} fill={item.highlight ? SERIES[0] : MUTED_MARK} />}
          <text x={labelW + w + 6} y={y + 14} fontSize="11" fontWeight="600" fill={INK}>{show(item.value, format)}</text>
        </g>;
      })}
    </svg>
  </div>;
}

/** Several series per group (e.g. current vs target), horizontal, with a legend. */
export function GroupedBarChart({ title, groups, series, format = "number" }: {
  title: string; groups: string[]; series: { name: string; color: string; values: (number | null)[] }[]; format?: Format;
}) {
  const all = series.flatMap((s) => s.values);
  if (!groups.length || all.every((v) => v === null)) return <Empty title={title} />;
  const barH = 12;
  const groupH = series.length * (barH + 2) + 12;
  const labelW = 132;
  const width = 420;
  const top = niceMax(all, { percent: format === "percent" && all.every((v) => (v ?? 0) <= 100) });
  const x = linearScale([0, top], [labelW, width - 56]);
  const height = groups.length * groupH;
  return <div className="report-chart">
    <p className="report-chart-title">{title}</p>
    <Legend items={series.map((s) => ({ name: s.name, color: s.color }))} />
    <svg viewBox={`0 0 ${width} ${height}`} role="img" aria-label={title}>
      <title>{title}</title>
      <line x1={labelW} x2={labelW} y1={0} y2={height} stroke={GRID} />
      {groups.map((group, g) => <g key={group}>
        <text x={labelW - 8} y={g * groupH + groupH / 2} textAnchor="end" fontSize="11" fontWeight="600" fill={INK}>{truncate(group, 20)}</text>
        {series.map((s, k) => {
          const v = s.values[g];
          const y = g * groupH + 4 + k * (barH + 2);
          const w = v === null ? 0 : Math.max(v > 0 ? 2 : 0, x(v) - labelW);
          return <g key={s.name}>
            <title>{`${group} · ${s.name}: ${show(v, format)}`}</title>
            {w > 0 && <rect x={labelW} y={y} width={w} height={barH} rx={4} fill={s.color} />}
            <text x={labelW + w + 6} y={y + barH - 2} fontSize="10" fill={INK}>{show(v, format)}</text>
          </g>;
        })}
      </g>)}
    </svg>
  </div>;
}

/** Horizontal stacked bars with a 2px surface gap between parts and a legend. */
export function StackedBarChart({ title, items }: { title: string; items: { label: string; parts: { name: string; value: number; color: string }[] }[] }) {
  const totals = items.map((i) => i.parts.reduce((s, p) => s + Math.max(0, p.value), 0));
  if (!items.length || totals.every((t) => t === 0)) return <Empty title={title} />;
  const rowH = 26;
  const labelW = 132;
  const width = 420;
  const top = niceMax(totals);
  const x = linearScale([0, top], [0, width - labelW - 48]);
  const height = items.length * rowH + 4;
  const names = items[0].parts.map((p) => ({ name: p.name, color: p.color }));
  return <div className="report-chart">
    <p className="report-chart-title">{title}</p>
    <Legend items={names} />
    <svg viewBox={`0 0 ${width} ${height}`} role="img" aria-label={title}>
      <title>{title}</title>
      {items.map((item, i) => {
        const y = i * rowH + 5;
        let cursor = labelW;
        return <g key={item.label + i}>
          <text x={labelW - 8} y={y + 12} textAnchor="end" fontSize="11" fontWeight="600" fill={INK}>{truncate(item.label, 20)}</text>
          {item.parts.map((part) => {
            const w = x(Math.max(0, part.value));
            const rect = w > 0 ? <rect key={part.name} x={cursor} y={y + 2} width={Math.max(1, w - 2)} height={16} rx={3} fill={part.color}><title>{`${item.label} · ${part.name}: ${part.value}`}</title></rect> : null;
            cursor += w;
            return rect;
          })}
          <text x={cursor + 4} y={y + 14} fontSize="11" fontWeight="600" fill={INK}>{totals[i]}</text>
        </g>;
      })}
    </svg>
  </div>;
}

/** Donut with a legend; the centre shows the highlighted item's share. */
export function DonutChart({ title, items }: { title: string; items: { label: string; value: number; highlight?: boolean }[] }) {
  const slices = donutSlices(items.map((i) => ({ label: i.label, value: i.value })));
  if (!slices.length) return <Empty title={title} />;
  const highlighted = slices.find((_, i) => items[i].highlight) ?? slices[0];
  return <div className="report-chart report-donut">
    <p className="report-chart-title">{title}</p>
    <div className="report-donut-body">
      <svg viewBox="0 0 120 120" role="img" aria-label={title + ": " + slices.map((s) => `${s.label} ${s.pct}%`).join(", ")}>
        <title>{title}</title>
        {slices.map((s, i) => s.end - s.start > 0.5 && <path key={s.label} d={arcPath(60, 60, 44, s.start + 0.8, s.end - 0.8)} fill="none" stroke={SERIES[i % SERIES.length]} strokeWidth="18"><title>{`${s.label}: ${s.pct}%`}</title></path>)}
        <text x="60" y="62" textAnchor="middle" fontSize="18" fontWeight="800" fill={INK}>{highlighted.pct}%</text>
        <text x="60" y="76" textAnchor="middle" fontSize="8" fill={MUTED}>{truncate(highlighted.label, 18)}</text>
      </svg>
      <ul className="report-legend report-legend-column">{slices.map((s, i) => <li key={s.label}><span style={{ background: SERIES[i % SERIES.length] }} />{s.label} <b>{s.pct}%</b></li>)}</ul>
    </div>
  </div>;
}

/** Daily line with a light area wash, gridlines and the latest value labelled. */
export function LineChart({ title, points, format = "percent" }: { title: string; points: { date: string; value: number | null }[]; format?: Format }) {
  if (!points.length || points.every((p) => p.value === null)) return <Empty title={title} />;
  const width = 640;
  const height = 200;
  const pad = { l: 36, r: 44, t: 10, b: 24 };
  const top = niceMax(points.map((p) => p.value), { percent: format === "percent" && points.every((p) => (p.value ?? 0) <= 100) });
  const x = linearScale([0, Math.max(1, points.length - 1)], [pad.l, width - pad.r]);
  const y = linearScale([0, top], [height - pad.b, pad.t]);
  const coords = points.map((p, i) => ({ x: x(i), y: p.value === null ? null : y(p.value) }));
  const line = linePath(coords);
  const solid = coords.filter((c): c is { x: number; y: number } => c.y !== null);
  const area = solid.length > 1 ? `${linePath(solid)} L ${solid.at(-1)!.x} ${height - pad.b} L ${solid[0].x} ${height - pad.b} Z` : "";
  const last = [...points].reverse().find((p) => p.value !== null)!;
  const lastIndex = points.lastIndexOf(last);
  const ticks = [0, top / 2, top];
  return <div className="report-chart">
    <p className="report-chart-title">{title}</p>
    <svg viewBox={`0 0 ${width} ${height}`} role="img" aria-label={`${title}: latest ${show(last.value, format)} on ${last.date}`}>
      <title>{title}</title>
      {ticks.map((t) => <g key={t}><line x1={pad.l} x2={width - pad.r} y1={y(t)} y2={y(t)} stroke={GRID} /><text x={pad.l - 6} y={y(t) + 3} textAnchor="end" fontSize="10" fill={MUTED}>{show(t, format, 0)}</text></g>)}
      {area && <path d={area} fill={SERIES[0]} opacity="0.1" />}
      <path d={line} fill="none" stroke={SERIES[0]} strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />
      {coords.map((c, i) => c.y !== null && <circle key={i} cx={c.x} cy={c.y} r={points.length > 40 ? 0 : 3} fill={SERIES[0]}><title>{`${points[i].date}: ${show(points[i].value, format)}`}</title></circle>)}
      <circle cx={x(lastIndex)} cy={y(last.value as number)} r="4" fill={SERIES[0]} stroke="#fff" strokeWidth="2" />
      <text x={x(lastIndex) + 7} y={y(last.value as number) + 4} fontSize="11" fontWeight="700" fill={INK}>{show(last.value, format)}</text>
      {thinLabels(points.length, 8).map((i) => <text key={i} x={x(i)} y={height - 6} textAnchor="middle" fontSize="10" fill={MUTED}>{shortDate(points[i].date)}</text>)}
    </svg>
  </div>;
}

export function Sparkline({ points }: { points: { date: string; value: number | null }[] }) {
  if (points.filter((p) => p.value !== null).length < 2) return null;
  const top = niceMax(points.map((p) => p.value));
  const x = linearScale([0, points.length - 1], [2, 118]);
  const y = linearScale([0, top], [30, 2]);
  return <svg className="report-sparkline" viewBox="0 0 120 32" role="img" aria-label="Visibility score trend">
    <path d={linePath(points.map((p, i) => ({ x: x(i), y: p.value === null ? null : y(p.value) })))} fill="none" stroke={SERIES[0]} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
  </svg>;
}

const STATUS = {
  allowed: { color: "#0a7d4e", text: "Allowed" },
  partial: { color: "#e0901f", text: "Partly blocked" },
  blocked: { color: "#a13f35", text: "Blocked" },
} as const;

/** Crawler access as dot + word (never colour alone). */
export function StatusGrid({ title, rows }: { title: string; rows: { label: string; status: keyof typeof STATUS }[] }) {
  if (!rows.length) return <Empty title={title} />;
  return <div className="report-chart">
    <p className="report-chart-title">{title}</p>
    <ul className="report-status-grid">{rows.map((row) => <li key={row.label}>
      <span className="report-status-dot" style={{ background: STATUS[row.status].color }} aria-hidden="true" />
      <span className="report-status-name">{row.label}</span>
      <span className="report-status-text">{STATUS[row.status].text}</span>
    </li>)}</ul>
  </div>;
}

function truncate(text: string, max: number) {
  return text.length > max ? text.slice(0, max - 1) + "…" : text;
}

function shortDate(date: string) {
  const d = new Date(date + "T00:00:00Z");
  return d.toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "UTC" });
}
