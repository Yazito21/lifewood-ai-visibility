// Geometry for the report's SVG charts. Pure functions so they can be unit-tested.

export function linearScale(domain: [number, number], range: [number, number]): (v: number) => number {
  const [d0, d1] = domain;
  const [r0, r1] = range;
  const span = d1 - d0;
  return (v: number) => (span === 0 ? r0 : r0 + ((v - d0) / span) * (r1 - r0));
}

const STEPS = [1, 2, 2.5, 4, 5, 10];

/** Smallest clean axis maximum ≥ the largest value; 100 for percentages. */
export function niceMax(values: (number | null | undefined)[], options: { percent?: boolean } = {}): number {
  if (options.percent) return 100;
  const max = Math.max(0, ...values.filter((v): v is number => typeof v === "number" && Number.isFinite(v)));
  if (max <= 0) return 1;
  const magnitude = 10 ** Math.floor(Math.log10(max));
  for (const step of STEPS) {
    const candidate = step * magnitude;
    if (candidate >= max - 1e-9) return Number(candidate.toPrecision(12));
  }
  return 10 * magnitude;
}

const fmt = (n: number) => String(Math.round(n * 100) / 100);

function point(cx: number, cy: number, r: number, deg: number): [number, number] {
  const rad = (deg * Math.PI) / 180;
  return [cx + r * Math.sin(rad), cy - r * Math.cos(rad)];
}

/** SVG arc from startDeg to endDeg; 0° is 12 o'clock, angles grow clockwise. */
export function arcPath(cx: number, cy: number, r: number, startDeg: number, endDeg: number): string {
  const sweep = Math.min(359.99, Math.max(0, endDeg - startDeg));
  const [x0, y0] = point(cx, cy, r, startDeg);
  const [x1, y1] = point(cx, cy, r, startDeg + sweep);
  return `M ${fmt(x0)} ${fmt(y0)} A ${fmt(r)} ${fmt(r)} 0 ${sweep > 180 ? 1 : 0} 1 ${fmt(x1)} ${fmt(y1)}`;
}

export function donutSlices(values: { label: string; value: number }[]) {
  const total = values.reduce((sum, v) => sum + Math.max(0, v.value), 0);
  if (total <= 0) return [];
  let angle = 0;
  return values.map((v) => {
    const share = Math.max(0, v.value) / total;
    const start = angle;
    angle += share * 360;
    return { label: v.label, value: v.value, start, end: angle, pct: Math.round(share * 1000) / 10 };
  });
}

/** Polyline path that starts a new segment after every null value. */
export function linePath(points: { x: number; y: number | null }[]): string {
  const parts: string[] = [];
  let pen = false;
  for (const p of points) {
    if (p.y === null || !Number.isFinite(p.y)) {
      pen = false;
      continue;
    }
    parts.push(`${pen ? "L" : "M"} ${fmt(p.x)} ${fmt(p.y)}`);
    pen = true;
  }
  return parts.join(" ");
}

/** Indices of at most `max` evenly spaced axis labels, always including the last. */
export function thinLabels(count: number, max: number): number[] {
  if (count <= max) return Array.from({ length: count }, (_, i) => i);
  const step = Math.ceil((count - 1) / (max - 1));
  const out: number[] = [];
  for (let i = count - 1; i >= 0; i -= step) out.unshift(i);
  return out;
}
