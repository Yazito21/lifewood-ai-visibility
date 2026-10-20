"use client";
// Build verification trigger: deploy the latest main revision.
import { useEffect, useMemo, useState } from "react";
import { ExternalLink, Search } from "lucide-react";
import { useParams } from "next/navigation";
import { ProjectShell } from "@/components/project-shell";
import { TrackingDataScope } from "@/components/tracking-data-scope";
import { supabase } from "@/lib/supabase";
import { malaysiaDateString, shiftDateString } from "@/lib/reporting-date";
import { brandDisplayName } from "@/lib/brand-display";

type AggregatedRow = { url: string; page_name: string | null; brand_name: string | null; frequency: number };
const LLMS = ["chatgpt", "gemini", "perplexity", "google_ai_overview", "claude"];
const labels: Record<string, string> = { chatgpt: "ChatGPT", gemini: "Gemini", perplexity: "Perplexity", google_ai_overview: "Google AI Overview", claude: "Claude" };

function CitationTable({ title, data }: { title: string; data: AggregatedRow[] }) {
  const [query, setQuery] = useState("");
  const [expanded, setExpanded] = useState(false);
  const filteredData = useMemo(() => {
    const term = query.trim().toLocaleLowerCase();
    if (!term) return data;
    return data.filter((row) =>
      [row.url, row.page_name ?? "", row.brand_name ?? ""].some((value) =>
        value.toLocaleLowerCase().includes(term)
      )
    );
  }, [data, query]);
  const visibleData = expanded ? filteredData : filteredData.slice(0, 10);

  return (
    <section className="platform-card p-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h3 className="text-lg font-semibold">{title}</h3>
        <span className="text-sm text-[#66736c]">{filteredData.length.toLocaleString()} {filteredData.length === 1 ? "page" : "pages"}</span>
      </div>
      <label className="mt-4 flex w-full max-w-xl items-center gap-2 rounded-xl border border-[var(--line)] bg-white px-3 py-2.5 focus-within:border-[var(--green)]">
        <Search size={16} className="shrink-0 text-[#66736c]" aria-hidden="true" />
        <input
          type="search"
          value={query}
          onChange={(event) => { setQuery(event.target.value); setExpanded(false); }}
          placeholder="Search by brand, page name, or URL…"
          aria-label={`Search ${title}`}
          className="w-full bg-transparent text-sm text-[var(--ink)] outline-none placeholder:text-[#87918b]"
        />
      </label>
      <div className="mt-4 overflow-x-auto">
        <table className="platform-table min-w-[760px]">
          <thead><tr className="border-b border-[var(--line)] text-xs uppercase tracking-[0.12em] text-[#66736c]">
            <th className="px-3 py-3">No.</th><th className="px-3 py-3">Page</th><th className="px-3 py-3">Page Name</th><th className="px-3 py-3">Brand Name</th><th className="px-3 py-3">Frequency</th>
          </tr></thead>
          <tbody>
            {visibleData.map((row, index) => <tr key={row.url} className="border-b border-[#eef0ee]">
              <td className="px-3 py-3">{index + 1}</td>
              <td className="max-w-[380px] px-3 py-3"><a href={row.url} target="_blank" rel="noreferrer" title={row.url} className="inline-flex max-w-[360px] items-center gap-1 truncate font-semibold text-[var(--green)] hover:underline">{row.url}<ExternalLink size={13} className="shrink-0" /></a></td>
              <td className="px-3 py-3">{row.page_name || "—"}</td>
              <td className="px-3 py-3">{brandDisplayName(row.brand_name, row.url) || "—"}</td>
              <td className="px-3 py-3 font-semibold">{row.frequency}</td>
            </tr>)}
            {!visibleData.length && <tr><td colSpan={5} className="px-3 py-10 text-center text-sm text-[#66736c]">{query.trim() ? "No pages match your search." : "No citations found."}</td></tr>}
          </tbody>
        </table>
      </div>
      {filteredData.length > 10 && <div className="mt-4 flex flex-wrap items-center justify-between gap-3 border-t border-[var(--line)] pt-4">
        <p className="text-sm text-[#66736c]">Showing {visibleData.length.toLocaleString()} of {filteredData.length.toLocaleString()} pages</p>
        <button type="button" onClick={() => setExpanded((value) => !value)} className="ops-filter-btn">
          {expanded ? "Show first 10" : `Show all ${filteredData.length.toLocaleString()} pages`}
        </button>
      </div>}
    </section>
  );
}

export default function CitationsPage() {
  const { projectId } = useParams<{ projectId: string }>();
  const [brandPages, setBrandPages] = useState<AggregatedRow[]>([]);
  const [trackingLocation, setTrackingLocation] = useState("MY");
  const [scope, setScope] = useState<"current" | "legacy">("current");
  const [allPages, setAllPages] = useState<AggregatedRow[]>([]);
  const [topics, setTopics] = useState<string[]>([]);
  const [topic, setTopic] = useState("All");
  const [llms, setLlms] = useState<string[]>(["chatgpt"]);
  const [period, setPeriod] = useState("Last 7 Days");
  const [customStart, setCustomStart] = useState("");
  const [customEnd, setCustomEnd] = useState(malaysiaDateString());
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const start = useMemo(() => {
    const today = malaysiaDateString();
    if (period === "Custom") return customStart || today;
    const days = period === "Today" ? 0 : period === "Last 2 Days" ? 1 : period === "Last 14 Days" ? 13 : period === "Last 30 Days" ? 29 : period === "Last 90 Days" ? 89 : period === "All Time" ? 36500 : 6;
    return shiftDateString(today, -days);
  }, [period, customStart]);
  const end = period === "Custom" ? customEnd : malaysiaDateString();

  useEffect(() => {
    let cancelled = false;
    async function load() {
      setLoading(true);
      setError("");
      const { data: project, error: projectError } = await supabase.from("projects").select("topics,tracking_market").eq("id", projectId).single();
      const location = project?.tracking_market ?? "MY";
      const dataLocation = scope === "legacy" ? "LEGACY" : location;
      if (!llms.length) {
        if (cancelled) return;
        setTopics(project?.topics ?? []);
        setTrackingLocation(location);
        if (projectError) setError(projectError.message);
        setBrandPages([]);
        setAllPages([]);
        setLoading(false);
        return;
      }
      async function loadAllCitationRows(brandRelatedOnly: boolean) {
        const allRows: AggregatedRow[] = [];
        for (let offset = 0; ; offset += 1000) {
          const { data: batch, error } = await supabase.rpc("get_cumulative_citations", {
            p_project_id: projectId, p_start_date: start, p_end_date: end,
            p_topic: topic === "All" ? null : topic, p_engines: llms,
            p_brand_related_only: brandRelatedOnly, p_tracking_location: dataLocation,
          }).range(offset, offset + 999);
          if (error) return { data: null as AggregatedRow[] | null, error };
          const rows = (batch ?? []) as AggregatedRow[];
          allRows.push(...rows);
          if (rows.length < 1000) break;
        }
        return { data: allRows, error: null };
      }
      const [{ data: brandRows, error: brandError }, { data: pageRows, error: pagesError }] = await Promise.all([
        loadAllCitationRows(true),
        loadAllCitationRows(false),
      ]);
      if (cancelled) return;
      setTopics(project?.topics ?? []);
      setTrackingLocation(location);
      if (projectError || brandError || pagesError) setError((projectError || brandError || pagesError)?.message ?? "Unable to load citation data.");
      setBrandPages((brandRows ?? []) as AggregatedRow[]);
      setAllPages((pageRows ?? []) as AggregatedRow[]);
      setLoading(false);
    }
    void load();
    return () => { cancelled = true; };
  }, [projectId, start, end, topic, llms, scope]);



  return <ProjectShell><div className="ops-page">
    <p className="page-eyebrow">Citations</p>
    <h2 className="page-title mt-1">Citation intelligence</h2>
    <p className="page-description mt-2">Cumulative cited-page frequency for the selected reporting dataset.</p>
    <TrackingDataScope trackingLocation={trackingLocation} scope={scope} onScopeChange={setScope} />
    <div className="mt-8 ops-filter-panel">
      <div className="ops-filter-row"><span className="ops-filter-label">Period</span>{["Today", "Last 2 Days", "Last 7 Days", "Last 14 Days", "Last 30 Days", "Last 90 Days", "All Time", "Custom"].map((value) => <button key={value} onClick={() => setPeriod(value)} className={`ops-filter-btn ${period === value ? "is-active" : ""}`}>{value}</button>)}{period === "Custom" && <><label className="sr-only" htmlFor="period-start">Start date</label><input id="period-start" type="date" value={customStart} max={customEnd} onChange={(event) => setCustomStart(event.target.value)} className="platform-input max-w-[180px] text-xs" /><span className="text-xs font-semibold text-[var(--muted-foreground)]">to</span><label className="sr-only" htmlFor="period-end">End date</label><input id="period-end" type="date" value={customEnd} min={customStart || undefined} onChange={(event) => setCustomEnd(event.target.value)} className="platform-input max-w-[180px] text-xs" /></>}
      </div>
      <div className="ops-filter-row"><span className="ops-filter-label">Topic</span><button onClick={() => setTopic("All")} className={`ops-filter-pill ${topic === "All" ? "is-active" : ""}`}>All</button>{topics.map((value) => <button key={value} onClick={() => setTopic(value)} className={`ops-filter-pill ${topic === value ? "is-active" : ""}`}>{value}</button>)}</div>
      <div className="ops-filter-row"><span className="ops-filter-label">Engines</span>{LLMS.map((engine) => <button key={engine} onClick={() => setLlms((current) => current.includes(engine) ? current.filter((item) => item !== engine) : [...current, engine])} className={`ops-filter-pill ${llms.includes(engine) ? "is-active" : ""}`}>{labels[engine]}</button>)}</div>
    </div>
    {error && <div className="mt-5 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>}
    <div className="mt-6 space-y-5">{loading ? <div className="h-80 animate-pulse platform-card" /> : <>
      <CitationTable title="Brand-related Pages" data={brandPages} />
      <CitationTable title="All Cited Pages" data={allPages} />
    </>}</div>
  </div></ProjectShell>;
}
