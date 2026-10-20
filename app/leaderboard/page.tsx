"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { ArrowDown, ArrowUp, Minus, Search, Trophy } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { malaysiaDateString, shiftDateString } from "@/lib/reporting-date";
import { brandDisplayName } from "@/lib/brand-display";

type CompetitorSnapshot = {
  project_id: string;
  metric_date: string;
  topic: string;
  llm_provider: string;
  brand_name: string;
  website: string | null;
  visibility_score: number | string | null;
  citation_count: number | null;
  tracking_location: string | null;
};
type CitationSnapshot = {
  project_id: string;
  metric_date: string;
  topic: string;
  llm_provider: string;
  url: string;
  brand_name: string | null;
  frequency: number | null;
  tracking_location: string | null;
};
type BrandMetric = {
  key: string;
  brand_name: string;
  website: string | null;
  location: string;
  visibility: number | null;
  citations: number;
};
type RankedBrand = BrandMetric & {
  rank: number;
  previousRank: number | null;
  previousVisibility: number | null;
  previousCitations: number | null;
};
const ENGINES = [
  ["chatgpt", "ChatGPT"], ["gemini", "Gemini"], ["perplexity", "Perplexity"],
  ["google_ai_overview", "Google AI Overview"], ["claude", "Claude"],
];
const PERIODS = ["Today", "Last 2 Days", "Last 7 Days", "Last 14 Days", "Last 30 Days", "Last 90 Days", "All Time", "Custom"];

function startFor(period: string, customStart: string) {
  const today = malaysiaDateString();
  if (period === "Custom") return customStart || today;
  const days = period === "Today" ? 0 : period === "Last 2 Days" ? 1 : period === "Last 7 Days" ? 6 : period === "Last 14 Days" ? 13 : period === "Last 30 Days" ? 29 : period === "Last 90 Days" ? 89 : period === "All Time" ? 36500 : 6;
  return shiftDateString(today, -days);
}
function number(value: number | string | null | undefined) {
  const n = Number(value ?? 0);
  return Number.isFinite(n) ? n : 0;
}
function hostFromUrl(value: string | null | undefined) {
  if (!value) return null;
  try { return new URL(value.includes("://") ? value : "https://" + value).hostname.toLowerCase().replace(/^www\./, "").replace(/\.$/, ""); }
  catch { return null; }
}
function rootWebsite(value: string | null | undefined) {
  const host = hostFromUrl(value);
  return host ? "https://" + host : null;
}
function keyFor(name: string | null | undefined, website: string | null | undefined) {
  return hostFromUrl(website) ?? hostFromUrl(name) ?? (name ?? "").trim().toLowerCase();
}
function locationLabel(value: string | null | undefined) {
  if (!value || value === "LEGACY") return value === "LEGACY" ? "Legacy data" : "Unknown";
  if (value.toLowerCase() === "global") return "Global";
  if (value.toUpperCase() === "MY") return "Malaysia";
  return value;
}
function collectMetrics(competitors: CompetitorSnapshot[], citations: CitationSnapshot[], selectedLocation: string) {
  const map = new Map<string, { brand_name: string; website: string | null; locations: Set<string>; visibility: number[]; citations: number }>();
  function ensure(key: string, name: string | null | undefined, website: string | null | undefined, location: string | null | undefined) {
    if (!key) return null;
    let item = map.get(key);
    if (!item) {
      item = { brand_name: name?.trim() || hostFromUrl(website) || key, website: rootWebsite(website), locations: new Set<string>(), visibility: [], citations: 0 };
      map.set(key, item);
    }
    if (name && name.trim().length > item.brand_name.length) item.brand_name = name.trim();
    if (!item.website && website) item.website = rootWebsite(website);
    if (location) item.locations.add(locationLabel(location));
    return item;
  }
  for (const row of competitors) {
    if (selectedLocation !== "All locations" && (row.tracking_location ?? "Unknown") !== selectedLocation) continue;
    const key = keyFor(row.brand_name, row.website);
    const item = ensure(key, row.brand_name, row.website, row.tracking_location);
    if (item && row.visibility_score != null) item.visibility.push(number(row.visibility_score));
    if (item && row.citation_count != null) item.citations += number(row.citation_count);
  }
  for (const row of citations) {
    if (selectedLocation !== "All locations" && (row.tracking_location ?? "Unknown") !== selectedLocation) continue;
    const website = rootWebsite(row.url);
    const key = keyFor(row.brand_name, website);
    const item = ensure(key, row.brand_name || hostFromUrl(website), website, row.tracking_location);
    if (item) item.citations += number(row.frequency) || 1;
  }
  return [...map.entries()].map(([key, value]) => ({
    key,
    brand_name: value.brand_name,
    website: value.website,
    location: [...value.locations].sort().join(", ") || "Unknown",
    visibility: value.visibility.length ? value.visibility.reduce((sum, v) => sum + v, 0) / value.visibility.length : null,
    citations: value.citations,
  }));
}
function ranked(rows: BrandMetric[]) {
  return [...rows].sort((a, b) => {
    if (a.visibility != null && b.visibility != null && a.visibility !== b.visibility) return b.visibility - a.visibility;
    if (a.visibility != null && b.visibility == null) return -1;
    if (a.visibility == null && b.visibility != null) return 1;
    return b.citations - a.citations || a.brand_name.localeCompare(b.brand_name);
  }).map((row, index) => ({ ...row, rank: index + 1 }));
}
function Change({ value, suffix = "", lowerIsBetter = false }: { value: number | null; suffix?: string; lowerIsBetter?: boolean }) {
  if (value === null || !Number.isFinite(value)) return <span className="ml-2 text-xs font-medium text-[#87918b]">—</span>;
  if (Math.abs(value) < 0.0001) return <span className="ml-2 inline-flex items-center gap-1 text-xs font-medium text-[#87918b]"><Minus size={12} /> 0{suffix}</span>;
  const positive = value > 0;
  const good = lowerIsBetter ? !positive : positive;
  return <span className={`ml-2 inline-flex items-center gap-1 whitespace-nowrap text-xs font-semibold ${good ? "text-emerald-700" : "text-rose-700"}`}>
    {positive ? <ArrowUp size={12} /> : <ArrowDown size={12} />}{Math.abs(value).toLocaleString(undefined, { maximumFractionDigits: 1 })}{suffix}
  </span>;
}

export default function PlatformLeaderboardPage() {
  const [competitors, setCompetitors] = useState<CompetitorSnapshot[]>([]);
  const [citations, setCitations] = useState<CitationSnapshot[]>([]);
  const [topics, setTopics] = useState<string[]>([]);
  const [locations, setLocations] = useState<string[]>([]);
  const [topic, setTopic] = useState("All");
  const [engines, setEngines] = useState<string[]>(["chatgpt"]);
  const [location, setLocation] = useState("All locations");
  const [period, setPeriod] = useState("Last 7 Days");
  const [customStart, setCustomStart] = useState("");
  const [customEnd, setCustomEnd] = useState(malaysiaDateString());
  const [search, setSearch] = useState("");
  const [expanded, setExpanded] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const start = useMemo(() => startFor(period, customStart), [period, customStart]);
  const end = period === "Custom" ? customEnd : malaysiaDateString();
  const previousRange = useMemo(() => {
    if (period === "All Time" || !start || !end || end < start) return null;
    const duration = Math.round((Date.parse(end + "T00:00:00Z") - Date.parse(start + "T00:00:00Z")) / 86400000) + 1;
    const previousEnd = shiftDateString(start, -1);
    return { start: shiftDateString(previousEnd, -duration + 1), end: previousEnd };
  }, [period, start, end]);

  useEffect(() => {
    let cancelled = false;
    async function loadRows<T extends Record<string, unknown>>(table: string, columns: string, from: string, to: string, selectedTopic: string, selectedEngines: string[]) {
      const all: T[] = [];
      for (let offset = 0; ; offset += 1000) {
        let query = supabase.from(table).select(columns).gte("metric_date", from).lte("metric_date", to).order("metric_date", { ascending: true }).range(offset, offset + 999);
        if (selectedEngines.length) query = query.in("llm_provider", selectedEngines);
        if (selectedTopic !== "All") query = query.eq("topic", selectedTopic);
        const { data, error: queryError } = await query;
        if (queryError) throw queryError;
        const batch = (data ?? []) as T[];
        all.push(...batch);
        if (batch.length < 1000) break;
      }
      return all;
    }
    async function load() {
      setLoading(true);
      setError("");
      try {
        const [{ data: projects, error: projectsError }, currentCompetitors, currentCitations, previousCompetitors, previousCitations] = await Promise.all([
          supabase.from("projects").select("topics,tracking_market,tracking_locations"),
          loadRows<CompetitorSnapshot>("competitors", "project_id,metric_date,topic,llm_provider,brand_name,website,visibility_score,citation_count,tracking_location", start, end, topic === "All" ? "Overall" : topic, engines),
          loadRows<CitationSnapshot>("citations", "project_id,metric_date,topic,llm_provider,url,brand_name,frequency,tracking_location", start, end, topic, engines),
          previousRange ? loadRows<CompetitorSnapshot>("competitors", "project_id,metric_date,topic,llm_provider,brand_name,website,visibility_score,citation_count,tracking_location", previousRange.start, previousRange.end, topic === "All" ? "Overall" : topic, engines) : Promise.resolve([] as CompetitorSnapshot[]),
          previousRange ? loadRows<CitationSnapshot>("citations", "project_id,metric_date,topic,llm_provider,url,brand_name,frequency,tracking_location", previousRange.start, previousRange.end, topic, engines) : Promise.resolve([] as CitationSnapshot[]),
        ]);
        if (projectsError) throw projectsError;
        if (cancelled) return;
        const topicValues = new Set<string>();
        const locationValues = new Set<string>();
        for (const project of projects ?? []) {
          for (const value of project.topics ?? []) if (value && value !== "Overall") topicValues.add(value);
          for (const value of project.tracking_locations ?? []) if (value) locationValues.add(value);
          if (project.tracking_market) locationValues.add(project.tracking_market);
        }
        for (const row of [...currentCompetitors, ...currentCitations, ...previousCompetitors, ...previousCitations]) {
          if (row.tracking_location) locationValues.add(row.tracking_location);
          if (row.topic && row.topic !== "Overall") topicValues.add(row.topic);
        }
        setTopics([...topicValues].sort((a, b) => a.localeCompare(b)));
        setLocations([...locationValues].sort((a, b) => a.localeCompare(b)));
        setCompetitors(currentCompetitors);
        setCitations(currentCitations);
        // Keep previous-period rows in state through closure for comparison calculations.
        setPreviousData({ competitors: previousCompetitors, citations: previousCitations });
      } catch (cause) {
        if (!cancelled) setError(cause instanceof Error ? cause.message : "Unable to load platform leaderboard.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    void load();
    return () => { cancelled = true; };
  }, [start, end, topic, engines, previousRange]);

  const [previousData, setPreviousData] = useState<{ competitors: CompetitorSnapshot[]; citations: CitationSnapshot[] }>({ competitors: [], citations: [] });
  const currentRows = useMemo(() => collectMetrics(competitors, citations, location), [competitors, citations, location]);
  const previousRows = useMemo(() => collectMetrics(previousData.competitors, previousData.citations, location), [previousData, location]);
  const previousByKey = useMemo(() => new Map(ranked(previousRows).map((row) => [row.key, row])), [previousRows]);
  const rankedRows = ranked(currentRows).map((row) => {
    const old = previousByKey.get(row.key);
    return { ...row, previousRank: old?.rank ?? null, previousVisibility: old?.visibility ?? null, previousCitations: old?.citations ?? null } satisfies RankedBrand;
  });
  const term = search.trim().toLocaleLowerCase();
  const filtered = rankedRows.filter((row) => [row.brand_name, brandDisplayName(row.brand_name, row.website), row.website ?? ""].some((v) => v.toLocaleLowerCase().includes(term)));
  const visible = expanded ? filtered : filtered.slice(0, 10);

  return <main className="min-h-screen min-w-0 bg-[var(--background)] text-[var(--foreground)]">
    <header className="relative overflow-hidden border-b border-[var(--border)] bg-[var(--lw-dark-serpent)] text-white shadow-[0_10px_35px_rgba(19,48,32,0.16)]">
      <div className="pointer-events-none absolute inset-0 opacity-25 [background-image:linear-gradient(rgba(255,255,255,.055)_1px,transparent_1px),linear-gradient(90deg,rgba(255,255,255,.055)_1px,transparent_1px)] [background-size:28px_28px]" />
      <div className="relative mx-auto flex min-h-[82px] w-full max-w-[1500px] items-center justify-between gap-4 px-4 py-4 sm:px-7 lg:px-8">
        <div><Link href="/home" className="text-sm font-semibold text-white/80 hover:text-white">← Home</Link><p className="mt-2 text-[10px] font-semibold uppercase tracking-[0.18em] text-white/50">Cross-project intelligence</p><h1 className="mt-1 text-xl font-semibold">Platform Leaderboard</h1></div>
        <span className="inline-flex items-center gap-2 rounded-full border border-white/15 bg-white/5 px-3 py-2 text-xs font-semibold"><Trophy size={15} className="text-[var(--lw-saffaron)]" /> All brands</span>
      </div>
    </header>
    <div className="mx-auto w-full max-w-[1500px] p-4 sm:p-7 lg:p-8">
      <p className="page-description">A cross-project view of every brand found in available citation and competitor records. Ranking uses recorded visibility score first, then citation volume.</p>
      <section className="mt-6 ops-filter-panel">
        <div className="ops-filter-row"><span className="ops-filter-label">Period</span>{PERIODS.map((value) => <button key={value} onClick={() => setPeriod(value)} className={`ops-filter-btn ${period === value ? "is-active" : ""}`}>{value}</button>)}{period === "Custom" && <><label className="sr-only" htmlFor="leaderboard-start">Start date</label><input id="leaderboard-start" type="date" value={customStart} max={customEnd} onChange={(event) => setCustomStart(event.target.value)} className="platform-input max-w-[180px] text-xs" /><span className="text-xs font-semibold text-[var(--muted-foreground)]">to</span><label className="sr-only" htmlFor="leaderboard-end">End date</label><input id="leaderboard-end" type="date" value={customEnd} min={customStart || undefined} onChange={(event) => setCustomEnd(event.target.value)} className="platform-input max-w-[180px] text-xs" /></>}</div>
        <div className="ops-filter-row"><span className="ops-filter-label">Topic</span><button onClick={() => setTopic("All")} className={`ops-filter-pill ${topic === "All" ? "is-active" : ""}`}>All</button>{topics.map((value) => <button key={value} onClick={() => setTopic(value)} className={`ops-filter-pill ${topic === value ? "is-active" : ""}`}>{value}</button>)}</div>
        <div className="ops-filter-row"><span className="ops-filter-label">Engines</span>{ENGINES.map(([value, label]) => <button key={value} onClick={() => setEngines((current) => current.includes(value) ? current.filter((item) => item !== value) : [...current, value])} className={`ops-filter-pill ${engines.includes(value) ? "is-active" : ""}`}>{label}</button>)}</div>
        <div className="ops-filter-row"><span className="ops-filter-label">Location</span><button onClick={() => setLocation("All locations")} className={`ops-filter-pill ${location === "All locations" ? "is-active" : ""}`}>All locations</button>{locations.map((value) => <button key={value} onClick={() => setLocation(value)} className={`ops-filter-pill ${location === value ? "is-active" : ""}`}>{locationLabel(value)}</button>)}</div>
      </section>
      {error && <div className="mt-5 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>}
      <section className="mt-6 platform-card p-6">
        <div className="flex flex-wrap items-center justify-between gap-3"><div><h2 className="text-lg font-semibold">Brand rankings</h2><p className="mt-1 text-xs text-[var(--muted-foreground)]">Previous-period changes compare with the immediately preceding period of equal length.</p></div><span className="text-sm text-[var(--muted-foreground)]">{filtered.length.toLocaleString()} brands</span></div>
        <label className="mt-4 flex w-full max-w-xl items-center gap-2 rounded-xl border border-[var(--line)] bg-white px-3 py-2.5 focus-within:border-[var(--green)]"><Search size={16} className="shrink-0 text-[#66736c]" aria-hidden="true" /><input type="search" value={search} onChange={(event) => { setSearch(event.target.value); setExpanded(false); }} placeholder="Search brand or website…" aria-label="Search leaderboard" className="w-full bg-transparent text-sm text-[var(--ink)] outline-none placeholder:text-[#87918b]" /></label>
        <div className="mt-4 overflow-x-auto"><table className="platform-table min-w-[1120px]"><thead><tr className="border-b border-[var(--line)] text-xs uppercase tracking-[0.12em] text-[#66736c]"><th className="px-3 py-3 text-left">Rank</th><th className="px-3 py-3 text-left">Brand Name</th><th className="px-3 py-3 text-left">Website</th><th className="px-3 py-3 text-left">Location (State, Country)</th><th className="px-3 py-3 text-left">Visibility Score</th><th className="px-3 py-3 text-left">Number of Citations</th></tr></thead>
          <tbody>{loading ? <tr><td colSpan={6} className="px-3 py-10 text-center">Loading platform leaderboard…</td></tr> : visible.map((row) => <tr key={row.key} className="border-b border-[#eef0ee]">
            <td className="whitespace-nowrap px-3 py-3"><span className="font-semibold">{row.rank}</span>{row.previousRank === null && previousRange ? <span className="ml-2 text-xs font-medium text-[#87918b]">New</span> : <Change value={row.previousRank === null ? null : row.previousRank - row.rank} lowerIsBetter />}</td>
            <td className="px-3 py-3 font-semibold">{brandDisplayName(row.brand_name, row.website)}</td>
            <td className="max-w-[260px] px-3 py-3">{row.website ? <a href={row.website} target="_blank" rel="noreferrer" title={row.website} className="break-all text-[var(--green)] hover:underline">{row.website}</a> : "—"}</td>
            <td className="px-3 py-3 text-sm text-[#66736c]">{row.location === "Unknown" ? "Not available" : row.location}</td>
            <td className="whitespace-nowrap px-3 py-3"><span className="font-semibold">{row.visibility === null ? "—" : row.visibility.toFixed(1) + "%"}</span><Change value={row.visibility === null || row.previousVisibility === null ? null : row.visibility - row.previousVisibility} suffix=" pp" /></td>
            <td className="whitespace-nowrap px-3 py-3"><span className="font-semibold">{row.citations.toLocaleString()}</span><Change value={row.previousCitations === null ? null : row.citations - row.previousCitations} /></td>
          </tr>)}
          {!loading && !filtered.length && <tr><td colSpan={6} className="px-3 py-10 text-center text-sm text-[#66736c]">{term ? "No brands match your search." : "No brands found for these filters."}</td></tr>}</tbody>
        </table></div>
        {!loading && filtered.length > 10 && <div className="mt-4 flex flex-wrap items-center justify-between gap-3 border-t border-[var(--line)] pt-4"><p className="text-sm text-[#66736c]">Showing {visible.length.toLocaleString()} of {filtered.length.toLocaleString()} brands</p><button type="button" onClick={() => setExpanded((value) => !value)} className="ops-filter-btn">{expanded ? "Show first 10" : `Show all ${filtered.length.toLocaleString()} brands`}</button></div>}
        <p className="mt-4 text-xs text-[#87918b]">The current source records do not consistently store each brand’s state or country; location shows the tracked dataset location, or Not available. A dash means a visibility score was not recorded for that brand in the selected data.</p>
      </section>
    </div>
  </main>;
}
