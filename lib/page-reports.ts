// Excel reports for the Dashboard, Analytics, Citations and Leaderboards pages.
// Each builder receives exactly the data the page is showing for its current filters
// and lays it out as a clean multi-sheet workbook (see lib/excel-report.ts).
import { ReportBuilder, SheetWriter, THEME, safeFileName, type CellValue, type ReportColumn } from "./excel-report.ts";
import { latestSnapshots, rankDisplay, type DailyMetric } from "./rank-snapshot.ts";

const MAX_LINKS = 5000;

export type ReportContext = {
  projectName: string;
  locationLabel: string;
  period: string;
  start: string;
  end: string;
  generatedAt?: Date;
};

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
export function formatDay(value: string) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  return m ? Number(m[3]) + " " + MONTHS[Number(m[2]) - 1] + " " + m[1] : value;
}
function generatedText(date = new Date()) {
  const text = new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Kuala_Lumpur", day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit", hour12: false }).format(date);
  return text.replace(",", "") + " (Malaysia time)";
}
function rangeText(ctx: ReportContext) {
  return ctx.start === ctx.end ? formatDay(ctx.start) : formatDay(ctx.start) + " to " + formatDay(ctx.end);
}
function commonFilters(ctx: ReportContext): Array<[string, string]> {
  return [
    ["Project", ctx.projectName],
    ["Tracking location", ctx.locationLabel],
    ["Reporting period", ctx.period],
    ["Date range", rangeText(ctx)],
  ];
}
function subtitle(ctx: ReportContext, extra = "") {
  return ctx.projectName + "  |  " + ctx.period + ": " + rangeText(ctx) + (extra ? "  |  " + extra : "");
}
const listText = (values: string[], all: string, total?: number) =>
  !values.length ? "None selected" : total !== undefined && values.length === total ? all : values.join(", ");

/** Mean of the stored per-topic/per-engine values for each date; shared by the Analytics charts and the Excel export. */
export function meanByDate<T extends { metric_date: string }>(rows: T[], key: keyof T) {
  const map = new Map<string, number[]>();
  for (const row of rows) {
    const value = row[key];
    if (typeof value === "number" && Number.isFinite(value)) map.set(row.metric_date, [...(map.get(row.metric_date) ?? []), value]);
  }
  return [...map.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([date, values]) => ({ label: date, value: values.reduce((a, b) => a + b, 0) / values.length }));
}

function colorChange(sheet: SheetWriter, rows: number[], col: number, values: Array<number | null>, numFmt = '"▲ "0;"▼ "0;"No change"') {
  rows.forEach((row, i) => {
    const v = values[i];
    const cell = sheet.ws.getCell(row, col);
    if (v === null || v === undefined) return;
    cell.numFmt = numFmt;
    cell.font = { name: "Calibri", size: 11, bold: true, color: { argb: "FF" + (v > 0 ? THEME.good : v < 0 ? THEME.bad : THEME.muted) } };
  });
}
const rangeRows = (first: number, last: number) => Array.from({ length: last - first + 1 }, (_, i) => first + i);

/* ------------------------------------------------------------------ Dashboard */

export type DashboardCitation = { url: string; page_name: string | null; brand_name: string | null; frequency: number };
export type DashboardReportInput = ReportContext & {
  topics: string[]; // card order, "Overall" first
  metrics: DailyMetric[];
  citationsByTopic: Record<string, DashboardCitation[]>;
};

export async function buildDashboardReport(input: DashboardReportInput) {
  const report = await ReportBuilder.create({ title: input.projectName + " Dashboard Report", subject: "AI visibility dashboard" });
  const topics = input.topics;
  const snapshots = latestSnapshots(input.metrics, topics);

  // Overview + rank cards
  const overview = report.addSheet("Overview", [24, 18, 10, 14, 14, 14, 18, 16, 14, 14, 18, 14, 34]);
  overview.banner("Dashboard Report", subtitle(input));
  overview.keyValues([
    ...commonFilters(input),
    ["Engine scope", "All answer engines combined (Overall metric)"],
    ["Topics", topics.length ? topics.join(", ") : "None"],
    ["Generated", generatedText(input.generatedAt)],
  ]);
  overview.section("Visibility rank cards", "The latest rank and score for each topic, with the change since the start of the selected period, exactly as the cards on the Dashboard show them. Rank 1 is the best position. A green up arrow is an improvement and a red down arrow is a decline.");
  const cardRows: CellValue[][] = [];
  const rankChanges: Array<number | null> = [];
  const scoreChanges: Array<number | null> = [];
  for (const topic of topics) {
    const snap = snapshots.get(topic);
    const display = rankDisplay(snap);
    const scoreChange = snap?.scoreChange == null ? null : Math.round(snap.scoreChange * 10) / 10;
    rankChanges.push(snap?.rankChange ?? null);
    scoreChanges.push(scoreChange);
    const notes = [display.note, snap && snap.startRank !== null && !snap.startRankVerified ? "Start-of-period rank population unverified" : null].filter(Boolean).join(". ");
    cardRows.push([
      topic, snap ? snap.metric_date : "No data", display.rank, display.population, snap?.rankChange ?? null, snap?.startRank ?? null, snap?.startRankDate ?? null,
      snap?.visibility_score ?? null, scoreChange, snap?.startScore ?? null, snap?.startScoreDate ?? null, display.text, notes,
    ]);
  }
  const cardColumns: ReportColumn[] = [
    { header: "Topic", type: "text" },
    { header: "Latest Data Date", type: "text", align: "left" },
    { header: "Rank", type: "rank" },
    { header: "Rank Population", type: "int" },
    { header: "Rank Change", type: "int" },
    { header: "Previous Rank", type: "rank" },
    { header: "Previous Rank Date", type: "text", align: "left" },
    { header: "Visibility Score", type: "pct" },
    { header: "Score Change", type: "decimal" },
    { header: "Previous Score", type: "pct" },
    { header: "Previous Score Date", type: "text", align: "left" },
    { header: "Rank as Shown", type: "text", align: "right" },
    { header: "Note", type: "text" },
  ];
  const cards = overview.table(cardColumns, cardRows, { emphasizeRow: (row) => row[0] === "Overall" });
  const cardLines = rangeRows(cards.firstRow, cards.lastRow);
  colorChange(overview, cardLines, 5, rankChanges);
  colorChange(overview, cardLines, 9, scoreChanges, '"▲ "0.0"%";"▼ "0.0"%";"No change"');
  overview.note("Previous Rank and Previous Score are the values from the first tracked day in the selected period. Rank change is the number of positions gained or lost, and score change is in percentage points. N/A means there is no earlier tracked day in the period to compare with.");

  // Daily trend tables and native line charts
  const trends = report.addSheet("Daily Trends", [16, 20, 20, 18, 4, 9, 9, 9, 9, 9, 9, 9, 9, 9, 9], { tab: THEME.orange });
  trends.banner("Daily Trends", subtitle(input));
  for (const topic of topics) {
    const rows = input.metrics.filter((m) => m.topic === topic).sort((a, b) => a.metric_date.localeCompare(b.metric_date));
    const overall = topic === "Overall";
    trends.trendBlock({
      heading: topic,
      description: "Daily visibility score and rank for " + (overall ? "all topics combined" : topic) + ". Dates without a tracking result are left out and the chart connects the recorded days.",
      dates: rows.map((r) => r.metric_date),
      series: [
        { header: "Visibility Score", kind: "score", values: rows.map((r) => r.visibility_score), chartTitle: topic + " Daily Visibility Score", yTitle: "Visibility (%)", color: overall ? THEME.orangeDark : THEME.green },
        { header: "Visibility Rank", kind: "rank", values: rows.map((r) => r.visibility_rank), chartTitle: topic + " Daily Visibility Rank", yTitle: "Rank (1 is best)", color: overall ? THEME.orangeDark : THEME.green },
      ],
      extraColumns: [{ column: { header: "Rank Population", type: "int", empty: "" }, values: rows.map((r) => (r.rank_population_status === "verified" ? r.rank_population_count : null)) }],
      emptyMessage: "No recorded values for this topic in the selected period.",
    });
  }

  // Top cited pages
  const cites = report.addSheet("Top Cited Pages", [8, 56, 40, 28, 20], { tab: "7A9C8B" });
  cites.banner("Top Cited Brand Pages", subtitle(input));
  cites.note("The five most frequently cited tracked-brand pages for each topic in the selected period, as listed at the bottom of the Dashboard.");
  for (const topic of topics.filter((t) => t !== "Overall")) {
    const list = (input.citationsByTopic[topic] ?? []).slice(0, 5);
    cites.section(topic);
    if (!list.length) { cites.note("No citations recorded for this topic and period."); continue; }
    cites.table(
      [{ header: "No.", type: "int", align: "center" }, { header: "Page", type: "link" }, { header: "Page Name", type: "text" }, { header: "Brand Name", type: "text" }, { header: "Citation Occurrences", type: "int" }],
      list.map((c, i) => [i + 1, { text: c.url, hyperlink: c.url }, c.page_name, c.brand_name, c.frequency]),
    );
  }
  return { buffer: await report.toBuffer(), filename: "lifewood-dashboard-" + safeFileName(input.projectName) + "-" + input.start + "-to-" + input.end + ".xlsx" };
}

/* ------------------------------------------------------------------ Analytics */

export type AnalyticsRow = {
  metric_date: string; topic: string; llm_provider: string;
  visibility_score: number | null; visibility_rank: number | null;
  share_of_voice_score: number | null; share_of_voice_rank: number | null;
  average_position: number | null; average_position_rank: number | null;
};
export type AnalyticsReportInput = ReportContext & {
  allTopics: string[]; selectedTopics: string[];
  engines: Array<{ id: string; label: string }>; selectedEngineIds: string[];
  /** Rows after the topic/engine filters (what the charts average). */
  filtered: AnalyticsRow[];
  /** Unfiltered rows for the period, used for the per-engine Overall snapshot. */
  rows: AnalyticsRow[];
};

export async function buildAnalyticsReport(input: AnalyticsReportInput) {
  const report = await ReportBuilder.create({ title: input.projectName + " Analytics Report", subject: "AI visibility analytics" });
  const engineLabels = input.engines.filter((e) => input.selectedEngineIds.includes(e.id)).map((e) => e.label);
  const topicsText = listText(input.selectedTopics, "All topics", input.allTopics.length);
  const enginesText = listText(engineLabels, "All engines", input.engines.length);
  const sub = subtitle(input, enginesText);
  const widths = [16, 22, 22, 4, 9, 9, 9, 9, 9, 9, 9, 9, 9, 9];

  const overview = report.addSheet("Overview", [38, 64, 16, 16]);
  overview.banner("Analytics Report", sub);
  overview.keyValues([
    ...commonFilters(input),
    ["Topics", topicsText],
    ["Answer engines", enginesText],
    ["Generated", generatedText(input.generatedAt)],
  ], 1);
  overview.section("What is in this workbook", "Each sheet matches a section of the Analytics page and follows the same filters.");
  overview.table(
    [{ header: "Sheet", type: "text" }, { header: "Contents", type: "text" }],
    [
      ["Mean Visibility", "Daily mean visibility score and rank, with line charts."],
      ["Mean Share of Voice", "Daily mean share of voice and rank, with line charts."],
      ["Mean Average", "Daily mean average position and its rank, with line charts."],
      ["Visibility Analytics", "Latest overall visibility score for each selected engine."],
      ["Detail Data", "Every topic and engine row behind the daily means."],
    ],
  );

  const sections: Array<{ sheet: string; heading: string; description: string; a: [keyof AnalyticsRow, string, string, string, number | undefined]; b: [keyof AnalyticsRow, string, string, string, number | undefined]; kindA: "score" | "rank" }> = [
    { sheet: "Mean Visibility", heading: "Mean Visibility", description: "How often the brand appears in AI answers, averaged over the selected topics and engines. The score shows how visible the brand is, and the rank shows how it compares with competitors.", kindA: "score",
      a: ["visibility_score", "Mean Visibility Score", "Mean Visibility Score", "Visibility (%)", undefined], b: ["visibility_rank", "Mean Visibility Rank", "Mean Visibility Rank", "Rank (1 is best)", 1] },
    { sheet: "Mean Share of Voice", heading: "Mean Share of Voice", description: "How much of the conversation the brand owns compared with every brand mentioned, averaged over the selected topics and engines.", kindA: "score",
      a: ["share_of_voice_score", "Mean Share of Voice", "Mean Share of Voice", "Share of voice (%)", undefined], b: ["share_of_voice_rank", "Mean Share of Voice Rank", "Mean Share of Voice Rank", "Rank (1 is best)", 1] },
    { sheet: "Mean Average", heading: "Mean Average", description: "How early the brand appears inside AI answers, averaged over the selected topics and engines. Position 1 is the first brand mentioned, so lower is better.", kindA: "rank",
      a: ["average_position", "Mean Average Position", "Mean Average Position", "Average position (1 is best)", 1], b: ["average_position_rank", "Mean Average Position Rank", "Mean Average Position Rank", "Rank (1 is best)", 1] },
  ];
  for (const s of sections) {
    const sheet = report.addSheet(s.sheet, widths, { tab: s === sections[1] ? THEME.orange : THEME.green });
    sheet.banner(s.heading, sub);
    const first = meanByDate(input.filtered, s.a[0]);
    const second = meanByDate(input.filtered, s.b[0]);
    const dates = [...new Set([...first.map((p) => p.label), ...second.map((p) => p.label)])].sort();
    const firstMap = new Map(first.map((p) => [p.label, p.value])), secondMap = new Map(second.map((p) => [p.label, p.value]));
    sheet.trendBlock({
      heading: s.heading,
      description: s.description + " Dates with no recorded value are left out.",
      dates,
      series: [
        { header: s.a[1], kind: s.kindA, values: dates.map((d) => firstMap.get(d) ?? null), chartTitle: s.a[2], yTitle: s.a[3], decimals: s.a[4], color: THEME.green },
        { header: s.b[1], kind: "rank", values: dates.map((d) => secondMap.get(d) ?? null), chartTitle: s.b[2], yTitle: s.b[3], decimals: s.b[4], color: THEME.orangeDark },
      ],
      emptyMessage: "No recorded values for the selected filters and period.",
    });
  }

  // Visibility Analytics: latest overall visibility per selected engine
  const snap = report.addSheet("Visibility Analytics", [26, 24, 22, 22], { tab: "7A9C8B" });
  snap.banner("Visibility Analytics", sub);
  snap.section("Latest values by engine", "The newest overall visibility score for each selected engine and the date it was recorded.");
  const snapRows: CellValue[][] = input.engines.filter((e) => input.selectedEngineIds.includes(e.id)).map((e) => {
    const latest = input.rows.filter((r) => r.llm_provider === e.id && r.topic === "Overall" && r.visibility_score != null).sort((a, b) => b.metric_date.localeCompare(a.metric_date))[0];
    return [e.label, latest ? latest.visibility_score : null, latest ? latest.metric_date : "No data"];
  });
  snap.table([{ header: "Answer Engine", type: "text" }, { header: "Overall Visibility Score", type: "pct" }, { header: "Date Recorded", type: "text", align: "left" }], snapRows);

  // Detail rows behind the means
  const detail = report.addSheet("Detail Data", [14, 24, 22, 16, 16, 18, 18, 16, 20], { gridlines: true, tab: "9AA7A0" });
  detail.banner("Detail Data", sub);
  const detailRows = [...input.filtered].sort((a, b) => a.metric_date.localeCompare(b.metric_date) || a.topic.localeCompare(b.topic) || a.llm_provider.localeCompare(b.llm_provider));
  const engineName = new Map(input.engines.map((e) => [e.id, e.label]));
  const t = detail.table(
    [
      { header: "Date", type: "date", align: "left" }, { header: "Topic", type: "text" }, { header: "Answer Engine", type: "text" },
      { header: "Visibility Score", type: "pct" }, { header: "Visibility Rank", type: "rank" }, { header: "Share of Voice", type: "pct" }, { header: "Share of Voice Rank", type: "rank" },
      { header: "Average Position", type: "decimal" }, { header: "Average Position Rank", type: "rank" },
    ],
    detailRows.map((r) => [new Date(r.metric_date + "T00:00:00Z"), r.topic, engineName.get(r.llm_provider) ?? r.llm_provider, r.visibility_score, r.visibility_rank, r.share_of_voice_score, r.share_of_voice_rank, r.average_position, r.average_position_rank]),
    { autoFilter: true },
  );
  report.freeze(detail, t.headerRow);
  return { buffer: await report.toBuffer(), filename: "lifewood-analytics-" + safeFileName(input.projectName) + "-" + input.start + "-to-" + input.end + ".xlsx" };
}

/* ------------------------------------------------------------------ Citations */

export type CitationPageRow = { url: string; page_name: string | null; brand_name: string | null; frequency: number };
export type ThirdPartyRow = { hostname: string; website_name: string | null; frequency: number; response_frequency: number; brand_coverage: number; source_types: string[]; example_url: string | null };
export type CitationsReportInput = ReportContext & {
  topicLabel: string; engineLabels: string[]; totalEngines: number;
  brandPages: CitationPageRow[]; allPages: CitationPageRow[]; thirdParty: ThirdPartyRow[];
};

export async function buildCitationsReport(input: CitationsReportInput) {
  const report = await ReportBuilder.create({ title: input.projectName + " Citations Report", subject: "AI citation intelligence" });
  const enginesText = listText(input.engineLabels, "All engines", input.totalEngines);
  const sub = subtitle(input, input.topicLabel + "  |  " + enginesText);
  const sum = (rows: CitationPageRow[]) => rows.reduce((total, r) => total + Number(r.frequency || 0), 0);

  const overview = report.addSheet("Overview", [38, 30, 20, 20]);
  overview.banner("Citations Report", sub);
  overview.keyValues([
    ...commonFilters(input),
    ["Topic", input.topicLabel],
    ["Answer engines", enginesText],
    ["Generated", generatedText(input.generatedAt)],
  ], 1);
  overview.section("Summary", "Totals for the selected filters. Each table sits on its own sheet.");
  overview.table(
    [{ header: "Measure", type: "text" }, { header: "Value", type: "int" }],
    [
      ["Brand-related pages cited", input.brandPages.length],
      ["Brand-related citation occurrences", sum(input.brandPages)],
      ["All pages cited", input.allPages.length],
      ["All citation occurrences", sum(input.allPages)],
      ["Third-party websites mentioned", input.thirdParty.length],
    ],
  );

  const pageColumns: ReportColumn[] = [
    { header: "No.", type: "int", align: "center" }, { header: "Page", type: "link" }, { header: "Page Name", type: "text" }, { header: "Brand Name", type: "text" }, { header: "Citation Occurrences", type: "int" },
  ];
  const pageSheet = (name: string, heading: string, rows: CitationPageRow[]) => {
    const sheet = report.addSheet(name, [8, 60, 42, 28, 20], { gridlines: true, tab: name === "All Cited Pages" ? "7A9C8B" : THEME.green });
    sheet.banner(heading, sub);
    const links = rows.length <= MAX_LINKS;
    const t = sheet.table(pageColumns, rows.map((r, i) => [i + 1, links ? { text: r.url, hyperlink: r.url } : r.url, r.page_name, r.brand_name, r.frequency]), { autoFilter: true });
    if (!rows.length) sheet.note("No citations recorded for these filters.");
    report.freeze(sheet, t.headerRow);
  };
  pageSheet("Brand-related Pages", "Brand-related Pages", input.brandPages);
  pageSheet("All Cited Pages", "All Cited Pages", input.allPages);

  const third = report.addSheet("Third-party Mentions", [8, 34, 32, 16, 16, 16, 40, 56], { gridlines: true, tab: THEME.orange });
  third.banner("Third-party Mentions", sub);
  const linkOk = input.thirdParty.length <= MAX_LINKS;
  const tt = third.table(
    [
      { header: "No.", type: "int", align: "center" }, { header: "Website", type: "text" }, { header: "Hostname", type: "text" }, { header: "URL Frequency", type: "int" },
      { header: "AI Responses", type: "int" }, { header: "Brands Featured", type: "int" }, { header: "Source Types", type: "text" }, { header: "Example URL", type: "link" },
    ],
    input.thirdParty.map((r, i) => [i + 1, r.website_name || r.hostname, r.hostname, Number(r.frequency || 0), Number(r.response_frequency || 0), Number(r.brand_coverage || 0), (r.source_types ?? []).join(", "),
      r.example_url ? (linkOk ? { text: r.example_url, hyperlink: r.example_url } : r.example_url) : null]),
    { autoFilter: true },
  );
  if (!input.thirdParty.length) third.note("No third-party mentions for these filters.");
  report.freeze(third, tt.headerRow);
  return { buffer: await report.toBuffer(), filename: "lifewood-citations-" + safeFileName(input.projectName) + "-" + input.start + "-to-" + input.end + ".xlsx" };
}

/* ---------------------------------------------------------------- Leaderboards */

export type LeaderboardRow = {
  rank: number; brand_name: string; website: string | null; isTracked: boolean;
  visibility_score: number; citations: number;
  previousRank: number | null; previousVisibility: number | null; previousCitations: number | null;
};
export type LeaderboardReportInput = ReportContext & {
  topicLabel: string; engineLabels: string[]; totalEngines: number;
  previousRange: { start: string; end: string } | null;
  rows: LeaderboardRow[];
  coverageNote?: string;
};

export async function buildLeaderboardReport(input: LeaderboardReportInput) {
  const report = await ReportBuilder.create({ title: input.projectName + " Leaderboard Report", subject: "AI visibility leaderboard" });
  const enginesText = listText(input.engineLabels, "All engines", input.totalEngines);
  const sub = subtitle(input, input.topicLabel + "  |  " + enginesText);
  const tracked = input.rows.find((r) => r.isTracked);

  const overview = report.addSheet("Overview", [38, 30, 20, 20]);
  overview.banner("Leaderboard Report", sub);
  overview.keyValues([
    ...commonFilters(input),
    ["Topic", input.topicLabel],
    ["Answer engines", enginesText],
    ["Compared with", input.previousRange ? formatDay(input.previousRange.start) + " to " + formatDay(input.previousRange.end) : "No earlier period for All Time"],
    ["Generated", generatedText(input.generatedAt)],
  ], 1);
  overview.section("Summary", "Where the tracked brand stands in the leaderboard for the selected filters.");
  overview.table(
    [{ header: "Measure", type: "text" }, { header: "Value", type: "text", align: "right" }],
    [
      ["Brands ranked", String(input.rows.length)],
      ["Tracked brand rank", tracked ? String(tracked.rank) : "N/A"],
      ["Tracked brand visibility score", tracked ? tracked.visibility_score.toFixed(1) + "%" : "N/A"],
      ["Tracked brand citation occurrences", tracked ? tracked.citations.toLocaleString("en-US") : "N/A"],
    ],
  );
  if (input.coverageNote) overview.note(input.coverageNote);
  overview.note("Ranks are ordered by visibility score, then citations, then name. A green ▲ means a brand moved up since the previous period and a red ▼ means it dropped.");

  const sheet = report.addSheet("Leaderboard", [10, 34, 38, 18, 22, 16, 16, 20, 22], { gridlines: true });
  sheet.banner("Direct Competitor Rankings", sub);
  const hasPrev = input.previousRange !== null;
  const changes: Array<number | null> = input.rows.map((r) => (r.previousRank !== null ? r.previousRank - r.rank : null));
  const links = input.rows.length <= MAX_LINKS;
  const t = sheet.table(
    [
      { header: "Rank", type: "rank", align: "center" }, { header: "Brand Name", type: "text" }, { header: "Website", type: "link" }, { header: "Visibility Score", type: "pct" },
      { header: "Citation Occurrences", type: "int" }, { header: "Previous Rank", type: "rank" }, { header: "Rank Change", type: "int" }, { header: "Previous Visibility Score", type: "pct" }, { header: "Previous Citation Occurrences", type: "int" },
    ],
    input.rows.map((r, i) => [r.rank, r.brand_name + (r.isTracked ? " (your brand)" : ""), r.website ? (links ? { text: r.website, hyperlink: r.website } : r.website) : null, r.visibility_score, r.citations,
      r.previousRank, changes[i] === null ? (hasPrev ? "New" : null) : changes[i], r.previousVisibility, r.previousCitations]),
    { autoFilter: true, emphasizeRow: (_row, i) => input.rows[i].isTracked },
  );
  colorChange(sheet, rangeRows(t.firstRow, t.lastRow), 7, changes);
  report.freeze(sheet, t.headerRow);
  return { buffer: await report.toBuffer(), filename: "lifewood-leaderboard-" + safeFileName(input.projectName) + "-" + input.start + "-to-" + input.end + ".xlsx" };
}
