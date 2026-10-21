export const MIN_TRACKING_DATE = "2026-10-15";

export const REPORTING_PERIODS = [
  "Today",
  "Last 2 Days",
  "Last 3 Days",
  "Last 7 Days",
  "Last 14 Days",
  "Last 30 Days",
  "Last 90 Days",
  "All Time",
  "Custom",
] as const;

export type ReportingPeriod = (typeof REPORTING_PERIODS)[number];

export function malaysiaDateString(date = new Date()) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Kuala_Lumpur",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}

export function shiftDateString(dateString: string, days: number) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateString);
  if (!match) return malaysiaDateString();
  const date = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])));
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

/** Shared inclusive date boundaries for every project reporting page.
 * Preset periods include today and the previous N-1 calendar days in MYT.
 */
export function reportingDateRange(
  period: string,
  customStart = "",
  customEnd = "",
  today = malaysiaDateString(),
) {
  if (period === "Custom") {
    const requestedStart = customStart || today;
    const requestedEnd = customEnd || today;
    const start = requestedStart <= requestedEnd ? requestedStart : requestedEnd;
    const end = requestedStart <= requestedEnd ? requestedEnd : requestedStart;
    const clampedStart = start < MIN_TRACKING_DATE ? MIN_TRACKING_DATE : start;
    const clampedEnd = end < MIN_TRACKING_DATE ? MIN_TRACKING_DATE : end;
    return { start: clampedStart, end: clampedEnd };
  }
  if (period === "All Time") return { start: MIN_TRACKING_DATE, end: today };
  const daysBack: Record<string, number> = {
    Today: 0,
    "Last 2 Days": 1,
    "Last 3 Days": 2,
    "Last 7 Days": 6,
    "Last 14 Days": 13,
    "Last 30 Days": 29,
    "Last 90 Days": 89,
  };
  const days = daysBack[period] ?? 6;
  const requestedStart = shiftDateString(today, -days);
  return { start: requestedStart < MIN_TRACKING_DATE ? MIN_TRACKING_DATE : requestedStart, end: today };
}

export function malaysiaDayStart(dateString: string) {
  return new Date(`${dateString}T00:00:00+08:00`);
}

export function malaysiaDayEndExclusive(dateString: string) {
  return malaysiaDayStart(shiftDateString(dateString, 1));
}
