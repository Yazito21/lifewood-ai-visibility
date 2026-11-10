"use client";

import { useState } from "react";
import { BarChart, DonutChart, GroupedBarChart, LineChart, MUTED_MARK, ScoreGauge, SERIES, Sparkline, StackedBarChart, StatusGrid } from "./charts";
import { Editable } from "./editable";
import { ReportPage, type ReportBrand } from "./report-page";
import { fmtDate, fmtPercent, fmtScore, targetsFor, textFor, type TargetRow } from "@/lib/report-view";
import { trackingLocationLabel } from "@/lib/tracking-locations";
import type { Audit, AuditReportRow, BenchmarkRow, CompetitorCheck, Narrative, PillarKey, ReportEdits, ReportSnapshot } from "@/lib/report-types";

export type ReportView = {
  row: AuditReportRow;
  snapshot: ReportSnapshot;
  audit: Audit;
  narrative: Narrative | null;
  edits: ReportEdits;
  brand: ReportBrand;
  canEdit: boolean;
  saveEdits: (next: ReportEdits) => void;
};

const KEY_CRAWLERS = ["GPTBot", "OAI-SearchBot", "ChatGPT-User", "ClaudeBot", "PerplexityBot", "Google-Extended"];
const PILLARS: { key: PillarKey; title: string }[] = [
  { key: "website", title: "Website content & structure" },
  { key: "knowledge", title: "Knowledge assets & resources" },
  { key: "authority", title: "Branding & authority" },
  { key: "community", title: "Community engagement" },
  { key: "monitoring", title: "Monitoring & research" },
];
const GEO_LABELS: { key: keyof Audit["scores"]; label: string; weight: number }[] = [
  { key: "citability", label: "AI citability", weight: 25 },
  { key: "brand", label: "Brand authority", weight: 20 },
  { key: "eeat", label: "Content E-E-A-T", weight: 20 },
  { key: "technical", label: "Technical GEO", weight: 15 },
  { key: "schema", label: "Schema & structured data", weight: 10 },
  { key: "platform", label: "Platform visibility", weight: 10 },
];

function EditText({ view, path, as = "span", placeholder }: { view: ReportView; path: string; as?: "span" | "p"; placeholder?: string }) {
  const value = textFor(view.narrative, view.edits, path);
  const edited = typeof view.edits.text?.[path] === "string";
  const save = (p: string, v: string | null) => {
    const text = { ...(view.edits.text ?? {}) };
    if (v === null) delete text[p];
    else text[p] = v;
    view.saveEdits({ ...view.edits, text });
  };
  return <Editable path={path} value={value} edited={edited} canEdit={view.canEdit} onSave={save} as={as} placeholder={placeholder} />;
}

function Bullets({ view, base, count = 3 }: { view: ReportView; base: string; count?: number }) {
  const items = Array.from({ length: count }, (_, i) => `${base}.${i}`)
    .filter((path) => view.canEdit || textFor(view.narrative, view.edits, path));
  if (!items.length) return <p className="report-muted">No findings recorded.</p>;
  return <ul className="report-bullets">{items.map((path) => <li key={path}><EditText view={view} path={path} placeholder="Add a point" /></li>)}</ul>;
}

function NotAudited({ audit }: { audit: Audit }) {
  return <div className="report-notice">Could not be audited: {audit.site.error ?? "the website was not reachable."} AI visibility results elsewhere in this report are unaffected.</div>;
}

function NoTracking() {
  return <div className="report-notice">No tracking runs in this period. Run tracking from the Dashboard, then generate a new report.</div>;
}

const competitorCheck = (audit: Audit, row: BenchmarkRow): CompetitorCheck | undefined => audit.competitors.find((c) => c.name === row.name);
const assetTotal = (assets: Record<string, number>) => Object.values(assets ?? {}).reduce((a, b) => a + b, 0);

// ---------- 1. Cover ----------
export function CoverPage({ view }: { view: ReportView }) {
  const { snapshot, row, brand } = view;
  return <ReportPage number={1} brand={brand} variant="cover">
    <div className="report-cover">
      <p className="report-eyebrow">{brand.name}</p>
      <h1>AI Visibility &amp; GEO Audit Report</h1>
      <p className="report-cover-period">{fmtDate(snapshot.period.start)} – {fmtDate(snapshot.period.end)} · {trackingLocationLabel(snapshot.location)}</p>
      <p className="report-cover-line">Generated on {fmtDate(row.created_at)} as part of the SEO/GEO project operations for {brand.name}.</p>
    </div>
  </ReportPage>;
}

// ---------- 2. Executive summary ----------
function Kpi({ label, value, note }: { label: string; value: string; note: React.ReactNode }) {
  return <div className="report-kpi"><p className="report-kpi-label">{label}</p><p className="report-kpi-value">{value}</p><div className="report-kpi-note">{note}</div></div>;
}

export function ExecutiveSummaryPage({ view }: { view: ReportView }) {
  const { snapshot: s, audit } = view;
  return <ReportPage number={2} section="1.0" title="Executive Summary" brand={view.brand}>
    <div className="report-kpis">
      <Kpi label="Overall visibility score" value={fmtPercent(s.overall.visibilityScore)} note={<EditText view={view} path="kpiNotes.visibility" />} />
      <Kpi label="Overall rank" value={s.overall.rankText || "N/A"} note={<EditText view={view} path="kpiNotes.rank" />} />
      <Kpi label="Website citations in AI" value={s.overall.brandCitations.toLocaleString("en-GB")} note={<EditText view={view} path="kpiNotes.citations" />} />
      <Kpi label="Share of voice" value={fmtPercent(s.overall.shareOfVoice)} note={<EditText view={view} path="kpiNotes.shareOfVoice" />} />
    </div>
    <div className="report-two-col">
      <div>
        <div className="report-gauges">
          <ScoreGauge label="AI Visibility" score={view.row.ai_visibility_score} />
          <ScoreGauge label="GEO Score" score={audit.scores.geo} />
          <ScoreGauge label="SEO Health" score={audit.scores.seo} />
        </div>
        {s.trend.length > 1 && <div className="report-sparkline-row"><span>Visibility over the period</span><Sparkline points={s.trend.map((t) => ({ date: t.date, value: t.score }))} /></div>}
      </div>
      <div>
        <h3 className="report-h3">1.1 The brand&apos;s current position</h3>
        <Bullets view={view} base="executiveSummary.position" />
      </div>
    </div>
  </ReportPage>;
}

// ---------- 3. Competitor benchmark table ----------
export function CompetitorBenchmarkPage({ view }: { view: ReportView }) {
  const { snapshot: s, audit } = view;
  const rows = s.competitors;
  const da = view.edits.manual?.domainAuthority ?? {};
  const saveDa = (name: string, value: string | null) => {
    const next = { ...da };
    if (value === null || value === "") delete next[name];
    else next[name] = value;
    view.saveEdits({ ...view.edits, manual: { ...(view.edits.manual ?? {}), domainAuthority: next } });
  };
  const brandAllowed = KEY_CRAWLERS.filter((c) => audit.site.robots.crawlers[c] === "allowed").length;
  const cells = (fn: (row: BenchmarkRow) => React.ReactNode) => rows.map((row) => <td key={row.name} className={row.isTracked ? "is-tracked" : ""}>{fn(row)}</td>);
  const unavailable = (row: BenchmarkRow) => !row.isTracked && !competitorCheck(audit, row)?.reachable;
  return <ReportPage number={3} section="2.0" title="Competitor Benchmark" brand={view.brand}>
    {rows.length < 2 && <div className="report-notice">No competitor results for this period. Add competitors in Settings and run tracking to compare.</div>}
    <table className="report-table report-benchmark">
      <thead><tr><th />{rows.map((row) => <th key={row.name} className={row.isTracked ? "is-tracked" : ""}>{row.name}</th>)}</tr></thead>
      <tbody>
        <tr><th>2.1 Visibility rank</th>{cells((r) => r.rank ?? "N/A")}</tr>
        <tr><th>2.2 Visibility score</th>{cells((r) => fmtPercent(r.visibilityScore))}</tr>
        <tr><th>2.3 Share of voice</th>{cells((r) => fmtPercent(r.shareOfVoice))}</tr>
        <tr><th>2.4 Citations</th>{cells((r) => r.citations.toLocaleString("en-GB"))}</tr>
        <tr><th>2.5 Knowledge assets</th>{cells((r) => r.isTracked ? (audit.site.reachable ? assetTotal(audit.site.knowledgeAssets) : "—") : unavailable(r) ? "Unavailable" : (competitorCheck(audit, r)?.knowledgeAssets ?? "—"))}</tr>
        <tr><th>2.6 External presence<small>social · directories · websites &amp; news</small></th>{cells((r) => `${r.presence.social} · ${r.presence.directories} · ${r.presence.websites}`)}</tr>
        <tr><th>2.7 Domain authority<small>entered manually</small></th>{cells((r) => <Editable path={r.name} value={da[r.name] ?? ""} edited={Boolean(da[r.name])} canEdit={view.canEdit} onSave={saveDa} multiline={false} />)}</tr>
        <tr className="report-subhead"><th colSpan={rows.length + 1}>GEO quick checks</th></tr>
        <tr><th>AI crawler access</th>{cells((r) => r.isTracked
          ? (audit.site.reachable ? `${brandAllowed} of ${KEY_CRAWLERS.length} key crawlers` : "—")
          : unavailable(r) ? "Unavailable" : `${competitorCheck(audit, r)?.aiCrawlersAllowed} of ${competitorCheck(audit, r)?.aiCrawlersTotal} crawlers`)}</tr>
        <tr><th>llms.txt</th>{cells((r) => r.isTracked ? (audit.site.reachable ? (audit.site.llmsTxt.exists ? "Yes" : "No") : "—") : unavailable(r) ? "Unavailable" : (competitorCheck(audit, r)?.llmsTxt ? "Yes" : "No"))}</tr>
        <tr><th>Organization schema</th>{cells((r) => r.isTracked ? (audit.site.reachable ? (audit.site.schema.hasOrganization ? "Yes" : "No") : "—") : unavailable(r) ? "Unavailable" : (competitorCheck(audit, r)?.schemaTypes.some((t) => /Organization|Business|Corporation/.test(t)) ? "Yes" : "No"))}</tr>
        <tr><th>Citability (homepage / site)</th>{cells((r) => r.isTracked ? fmtScore(audit.scores.citability, 0) : unavailable(r) ? "Unavailable" : fmtScore(competitorCheck(audit, r)?.citability ?? null, 0))}</tr>
      </tbody>
    </table>
    <EditText view={view} path="competitorSummary" as="p" placeholder="Add a one-line summary" />
  </ReportPage>;
}

// ---------- 4. Competitor charts ----------
export function CompetitorChartsPage({ view }: { view: ReportView }) {
  const { snapshot: s, audit } = view;
  const rows = s.competitors;
  return <ReportPage number={4} section="2.1" title="Competitor Charts" brand={view.brand}>
    <div className="report-chart-grid">
      <BarChart title="Visibility score" format="percent" items={rows.map((r) => ({ label: r.name, value: r.visibilityScore, highlight: r.isTracked }))} />
      <DonutChart title="Share of voice" items={rows.map((r) => ({ label: r.name, value: r.shareOfVoice ?? 0, highlight: r.isTracked }))} />
      <BarChart title="Citations in AI answers" items={rows.map((r) => ({ label: r.name, value: r.citations, highlight: r.isTracked }))} />
      <BarChart title="Knowledge assets (sitemap)" items={rows.map((r) => ({
        label: r.name, highlight: r.isTracked,
        value: r.isTracked ? (audit.site.reachable ? assetTotal(audit.site.knowledgeAssets) : null) : (competitorCheck(audit, r)?.knowledgeAssets ?? null),
      }))} />
      <StackedBarChart title="External presence (cited websites)" items={rows.map((r) => ({
        label: r.name,
        parts: [
          { name: "Social", value: r.presence.social, color: SERIES[0] },
          { name: "Directories", value: r.presence.directories, color: SERIES[1] },
          { name: "Websites & news", value: r.presence.websites, color: SERIES[2] },
        ],
      }))} />
    </div>
  </ReportPage>;
}

// ---------- 5. AI visibility detail (charts) ----------
export function AiVisibilityPage({ view }: { view: ReportView }) {
  const s = view.snapshot;
  return <ReportPage number={5} section="3.0" title="AI Visibility in Detail" brand={view.brand}>
    {!s.hasData ? <NoTracking /> : <div className="report-ai-grid">
      <div className="report-span-2"><LineChart title="Overall visibility score by day" points={s.trend.map((t) => ({ date: t.date, value: t.score }))} /></div>
      <BarChart title="Visibility by AI engine" format="percent" items={s.byEngine.map((e) => ({ label: e.label, value: e.visibilityScore, highlight: true }))} />
      <BarChart title="Visibility by category" format="percent" items={s.byCategory.map((c) => ({ label: c.category, value: c.visibilityScore, highlight: true }))} />
    </div>}
  </ReportPage>;
}

// ---------- 6. Gaps and citations ----------
export function GapsAndCitationsPage({ view }: { view: ReportView }) {
  const s = view.snapshot;
  return <ReportPage number={6} section="3.1" title="Where Competitors Appear and What AI Cites" brand={view.brand}>
    {!s.hasData ? <NoTracking /> : <div className="report-two-col">
      <div>
        <h3 className="report-h3">Prompts where competitors appear but {view.brand.name} does not</h3>
        {s.gaps.length ? <table className="report-table report-compact">
          <thead><tr><th>Prompt</th><th>Competitors named</th></tr></thead>
          <tbody>{s.gaps.slice(0, 10).map((g) => <tr key={g.prompt}><td>{g.prompt}</td><td>{g.competitors.join(", ")}</td></tr>)}</tbody>
        </table> : <p className="report-muted">No gaps: whenever a competitor appeared, {view.brand.name} appeared too.</p>}
      </div>
      <div>
        <p className={`report-callout ${s.brandSiteCited ? "is-good" : "is-poor"}`}>
          {s.brandSiteCited ? `${view.brand.name}'s own website is cited in AI answers.` : `${view.brand.name}'s own website was not cited in AI answers in this period.`}
        </p>
        <h3 className="report-h3">Most cited pages</h3>
        <ol className="report-list">{s.topCitedPages.slice(0, 6).map((p) => <li key={p.url}><span className={p.isBrand ? "is-brand" : ""}>{shortUrl(p.url)}</span><b>{p.frequency}</b></li>)}</ol>
        <h3 className="report-h3">Most cited third-party websites</h3>
        <ol className="report-list">{s.topCitedDomains.slice(0, 6).map((d) => <li key={d.hostname}><span>{d.hostname}</span><b>{d.responses}</b></li>)}</ol>
      </div>
    </div>}
  </ReportPage>;
}

// ---------- 7. GEO audit ----------
export function GeoAuditPage({ view }: { view: ReportView }) {
  const { audit } = view;
  return <ReportPage number={7} section="4.0" title="GEO Audit" brand={view.brand}>
    {!audit.site.reachable && <NotAudited audit={audit} />}
    <div className="report-geo-grid">
      <div>
        <ScoreGauge label="GEO Score" score={audit.scores.geo} />
        {audit.site.reachable && <StatusGrid title="AI crawler access (robots.txt)" rows={KEY_CRAWLERS.map((c) => ({ label: c, status: audit.site.robots.crawlers[c] ?? "allowed" }))} />}
      </div>
      <BarChart title="Category scores (weight)" max={100} items={GEO_LABELS.map((g) => ({ label: `${g.label} (${g.weight}%)`, value: audit.scores[g.key], highlight: true }))} />
      <div className="report-findings">
        {GEO_LABELS.map((g) => {
          const items = audit.findings[g.key as keyof Audit["findings"]] ?? [];
          return items.length ? <div key={g.key}><h4>{g.label}</h4><ul>{items.slice(0, 2).map((f) => <li key={f}>{f}</li>)}</ul></div> : null;
        })}
      </div>
    </div>
  </ReportPage>;
}

// ---------- 8. SEO audit ----------
export function SeoAuditPage({ view }: { view: ReportView }) {
  const { audit } = view;
  const pages = audit.site.pages;
  const share = (fn: (p: (typeof pages)[number]) => boolean) => (pages.length ? Math.round((100 * pages.filter(fn).length) / pages.length) : null);
  const checks = audit.site.siteChecks;
  const siteRows: [string, boolean][] = [
    ["HTTPS", checks.https], ["robots.txt", checks.robotsTxt], ["XML sitemap", checks.sitemap],
    ["Canonical tag (homepage)", checks.canonical], ["Mobile viewport", checks.viewport], ["Content readable without JavaScript", checks.serverRendered],
  ];
  return <ReportPage number={8} section="5.0" title="SEO Audit" brand={view.brand}>
    {!audit.site.reachable ? <NotAudited audit={audit} /> : <div className="report-seo-grid">
      <div>
        <ScoreGauge label="SEO Health" score={audit.scores.seo} />
        <ul className="report-checks">{siteRows.map(([label, ok]) => <li key={label} className={ok ? "is-pass" : "is-fail"}><span aria-hidden="true">{ok ? "✓" : "✗"}</span>{label}<em>{ok ? "Pass" : "Fail"}</em></li>)}</ul>
      </div>
      <BarChart title="Pages passing each check" format="percent" items={[
        { label: "Status 200", value: share((p) => p.status === 200), highlight: true },
        { label: "Title 30–65 chars", value: share((p) => p.titleLength >= 30 && p.titleLength <= 65), highlight: true },
        { label: "Meta description", value: share((p) => p.metaDescriptionLength >= 70 && p.metaDescriptionLength <= 160), highlight: true },
        { label: "One H1", value: share((p) => p.h1Count === 1), highlight: true },
        { label: "300+ words", value: share((p) => p.wordCount >= 300), highlight: true },
        { label: "Structured data", value: share((p) => p.hasSchema), highlight: true },
      ]} />
      <table className="report-table report-compact report-span-2">
        <thead><tr><th>Page</th><th>Title</th><th>Meta</th><th>H1</th><th>Words</th><th>Schema</th><th>Status</th></tr></thead>
        <tbody>{pages.slice(0, 11).map((p) => <tr key={p.url}>
          <td>{shortUrl(p.url)}</td><td>{p.title ? `${p.titleLength} chars` : "Missing"}</td><td>{p.metaDescription ? `${p.metaDescriptionLength} chars` : "Missing"}</td>
          <td>{p.h1Count}</td><td>{p.wordCount.toLocaleString("en-GB")}</td><td>{p.hasSchema ? "Yes" : "No"}</td><td>{p.status}</td>
        </tr>)}</tbody>
      </table>
    </div>}
  </ReportPage>;
}

// ---------- 9. Current position ----------
export function CurrentPositionPage({ view }: { view: ReportView }) {
  return <ReportPage number={9} section="6.0" title="The Brand's Current Position" brand={view.brand}>
    <div className="report-pillars">{PILLARS.map((p) => <div key={p.key} className="report-pillar">
      <h3>{p.title}</h3>
      <Bullets view={view} base={`pillars.${p.key}.position`} />
    </div>)}</div>
  </ReportPage>;
}

// ---------- 10. Initial targets ----------
function TargetCell({ value, canEdit, onSave, suffix = "" }: { value: number | null; canEdit: boolean; onSave: (v: number | null) => void; suffix?: string }) {
  const [draft, setDraft] = useState(value === null ? "" : String(value));
  if (!canEdit) return <>{value === null ? "—" : value + suffix}</>;
  return <input className="report-target-input" inputMode="decimal" value={draft} aria-label="Target"
    onChange={(e) => setDraft(e.target.value)}
    onBlur={() => { const n = Number(draft); onSave(draft.trim() === "" || !Number.isFinite(n) ? null : n); }} />;
}

export function TargetsPage({ view }: { view: ReportView }) {
  const rows = targetsFor(view.snapshot, view.edits);
  const save = (row: TargetRow, patch: Partial<TargetRow>) => {
    const others = (view.edits.targets ?? []).filter((t) => t.scope !== row.scope);
    const next = { ...row, ...patch };
    view.saveEdits({ ...view.edits, targets: [...others, { scope: row.scope, targetScore: next.targetScore, targetRank: next.targetRank }] });
  };
  return <ReportPage number={10} section="7.0" title="Initial Targets" brand={view.brand}>
    <div className="report-two-col">
      <div>
        <table className="report-table">
          <thead><tr><th>Scope</th><th>Visibility now</th><th>Target</th><th>Rank now</th><th>Target rank</th></tr></thead>
          <tbody>{rows.map((r) => <tr key={r.scope}>
            <td>{r.scope}</td><td>{fmtPercent(r.currentScore)}</td>
            <td><TargetCell value={r.targetScore} canEdit={view.canEdit} suffix="%" onSave={(v) => save(r, { targetScore: v })} /></td>
            <td>{r.currentRank ?? "—"}</td>
            <td><TargetCell value={r.targetRank} canEdit={view.canEdit} onSave={(v) => save(r, { targetRank: v })} /></td>
          </tr>)}</tbody>
        </table>
        <EditText view={view} path="targetNotes" as="p" placeholder="Add a note about these targets" />
      </div>
      <GroupedBarChart title="Visibility score: now vs target" format="percent" groups={rows.map((r) => r.scope)} series={[
        { name: "Now", color: MUTED_MARK, values: rows.map((r) => r.currentScore) },
        { name: "Target", color: SERIES[0], values: rows.map((r) => r.targetScore) },
      ]} />
    </div>
  </ReportPage>;
}

// ---------- 11. Methodology ----------
export function MethodologyPage({ view }: { view: ReportView }) {
  const { snapshot: s, audit } = view;
  return <ReportPage number={11} title="Methodology" brand={view.brand}>
    <div className="report-method">
      <div>
        <h3 className="report-h3">AI visibility</h3>
        <p>{s.promptCount} tracked prompts were asked on {s.engines.length ? s.engines.join(", ") : "the tracked AI engines"} between {fmtDate(s.period.start)} and {fmtDate(s.period.end)} ({trackingLocationLabel(s.location)}). Visibility score is the share of AI answers that mention the brand. Rank compares the brand with its registered competitors on the same prompts. Share of voice in the benchmark is each brand&apos;s visibility as a share of the compared brands&apos; total.</p>
        <h3 className="report-h3">GEO Score</h3>
        <p>Weighted average of six categories: AI citability 25%, brand authority 20%, content E-E-A-T 20%, technical GEO 15%, schema 10%, platform visibility 10%. Categories that could not be measured are left out and the remaining weights are scaled up.</p>
      </div>
      <div>
        <h3 className="report-h3">SEO Health</h3>
        <p>40 points for site-wide checks (HTTPS, robots.txt, sitemap, canonical, viewport, content readable without JavaScript) and 60 points for page checks across the homepage and up to 10 key pages.</p>
        <h3 className="report-h3">Verified vs manual</h3>
        <p>Crawler access, llms.txt, structured data, page checks, citability and Wikipedia/Wikidata are checked automatically. Domain authority is entered manually. Presence on these platforms should be checked by hand: {audit.site.manualCheckLinks.map((l) => l.platform).join(", ")}.</p>
        {(audit.notices.length > 0 || audit.budgetSkipped.length > 0) && <div className="report-notice">
          {audit.notices.map((n) => <p key={n}>{n}</p>)}
          {audit.budgetSkipped.length > 0 && <p>Skipped to stay within the time limit: {audit.budgetSkipped.join(", ")}.</p>}
        </div>}
      </div>
    </div>
  </ReportPage>;
}

// ---------- 12. Thank you ----------
export function ThankYouPage({ view }: { view: ReportView }) {
  return <ReportPage number={12} brand={view.brand} variant="closing">
    <div className="report-closing"><h1>Thank you</h1><p>{view.brand.name} · AI Visibility &amp; GEO Audit Report</p></div>
  </ReportPage>;
}

function shortUrl(url: string) {
  try {
    const u = new URL(url);
    const path = u.pathname === "/" ? "" : u.pathname;
    const text = u.hostname.replace(/^www\./, "") + path;
    return text.length > 60 ? text.slice(0, 59) + "…" : text;
  } catch {
    return url;
  }
}
