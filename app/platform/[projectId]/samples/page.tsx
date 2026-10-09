"use client";

import { useEffect, useMemo, useState } from "react";
import { Download, FlaskConical, Play, RefreshCw, CheckSquare, Square, ExternalLink, Search } from "lucide-react";
import { useParams } from "next/navigation";
import * as XLSX from "xlsx";
import { ProjectShell } from "@/components/project-shell";
import { supabase } from "@/lib/supabase";

type Prompt = { id: string; prompt_number: number; prompt: string; topic: string; language: string; active: boolean };
type SampleResult = {
  prompt_id: string; prompt_number: number; prompt: string; topic: string; language: string;
  provider: string; status: string; response_text?: string; raw_response?: unknown; error_message?: string;
  brand_mentioned: boolean; citations: { url: string; page_name: string; brand_name: string; is_brand_related: boolean; topic: string; prompt: string; provider: string; domain?: string; citation_source?: string }[];
  competitor_hosts: string[]; model?: string; usage?: unknown;
};
type SamplePayload = {
  summary: { total_prompts: number; completed: number; failed: number; visibility_score: number; visibility_rank: number };
  results: SampleResult[];
  citations: SampleResult["citations"];
  competitors: { domain: string; mentions: number }[];
  project: { brand_name: string };
};

const engines = [
  { id: "chatgpt", label: "ChatGPT", ready: true },
  { id: "gemini", label: "Gemini", ready: false },
  { id: "perplexity", label: "Perplexity", ready: false },
  { id: "google_ai_overview", label: "Google AI Overview", ready: false },
  { id: "claude", label: "Claude", ready: false },
];

export default function SamplesPage() {
  const { projectId } = useParams<{ projectId: string }>();
  const [prompts, setPrompts] = useState<Prompt[]>([]);
  const [selected, setSelected] = useState<string[]>([]);
  const [selectedEngines, setSelectedEngines] = useState<string[]>(["chatgpt"]);
  const [search, setSearch] = useState("");
  const [topic, setTopic] = useState("All topics");
  const [loadingPrompts, setLoadingPrompts] = useState(true);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState("");
  const [payload, setPayload] = useState<SamplePayload | null>(null);
  const [runNumber, setRunNumber] = useState(0);
  const [resultSearch, setResultSearch] = useState("");
  const [pagesSearch, setPagesSearch] = useState("");
  const [competitorsSearch, setCompetitorsSearch] = useState("");
  const [resultsExpanded, setResultsExpanded] = useState(false);
  const [pagesExpanded, setPagesExpanded] = useState(false);
  const [competitorsExpanded, setCompetitorsExpanded] = useState(false);

  useEffect(() => {
    let alive = true;
    async function load() {
      setLoadingPrompts(true);
      const { data, error } = await supabase.from("prompts")
        .select("id,prompt_number,prompt,topic,language,active")
        .eq("project_id", projectId).eq("active", true).order("prompt_number");
      if (!alive) return;
      if (error) setError(error.message);
      const rows = data ?? [];
      setPrompts(rows);
      setSelected(rows.slice(0, Math.min(5, rows.length)).map((p) => p.id));
      setLoadingPrompts(false);
    }
    void load();
    return () => { alive = false; };
  }, [projectId]);

  const topics = useMemo(() => ["All topics", ...new Set(prompts.map((p) => p.topic))], [prompts]);
  const filtered = prompts.filter((p) =>
    (topic === "All topics" || p.topic === topic) &&
    (p.prompt.toLowerCase().includes(search.toLowerCase()) || p.topic.toLowerCase().includes(search.toLowerCase()))
  );
  const selectedPrompts = prompts.filter((p) => selected.includes(p.id));
  const filteredResults = (payload?.results ?? []).filter((r) =>
    [r.prompt, r.topic, r.provider, r.status, String(r.prompt_number)].some((value) =>
      value.toLowerCase().includes(resultSearch.trim().toLowerCase())
    )
  );
  const visibleResults = resultsExpanded ? filteredResults : filteredResults.slice(0, 10);
  const filteredCompetitors = (payload?.competitors ?? []).filter((c) =>
    c.domain.toLowerCase().includes(competitorsSearch.trim().toLowerCase())
  );
  const visibleCompetitors = competitorsExpanded ? filteredCompetitors : filteredCompetitors.slice(0, 10);

  function togglePrompt(id: string) {
    setSelected((current) => current.includes(id) ? current.filter((x) => x !== id) : current.length >= 25 ? current : [...current, id]);
  }
  function toggleEngine(id: string) {
    if (!engines.find((e) => e.id === id)?.ready) return;
    setSelectedEngines((current) => current.includes(id) ? current.filter((x) => x !== id) : [...current, id]);
  }

  async function runSample() {
    setError("");
    if (!selected.length) { setError("Select at least one prompt."); return; }
    if (selected.length > 25) { setError("A sample run can include up to 25 prompts."); return; }
    if (!selectedEngines.length) { setError("Select at least one available AI engine."); return; }
    setRunning(true);
    setPayload(null);
    try {
      const { data, error } = await supabase.functions.invoke("visibility-tracking", {
        body: { mode: "sample", project_id: projectId, prompt_ids: selected, providers: selectedEngines },
      });
      if (error) {
        let message = error.message;
        if (error.context instanceof Response) {
          try {
            const body = await error.context.clone().json();
            message = body?.details
              ? `${body.error}: ${JSON.stringify(body.details)}`
              : (body?.error || message);
          } catch { /* keep SDK message */ }
        }
        throw new Error(message);
      }
      if (data?.error) throw new Error(data.error);
      setPayload(data as SamplePayload);
      setRunNumber((n) => n + 1);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setRunning(false);
    }
  }

  function downloadExcel() {
    if (!payload) return;
    const wb = XLSX.utils.book_new();
    const summary = [{
      Run: runNumber, Brand: payload.project?.brand_name ?? "",
      Engines: selectedEngines.join(", "), Prompts: payload.summary.total_prompts,
      Completed: payload.summary.completed, Failed: payload.summary.failed,
      "Visibility Score (%)": payload.summary.visibility_score,
      "Visibility Rank": payload.summary.visibility_rank,
      "Generated At": new Date().toISOString(),
      Note: "Temporary sample run. This data is not stored in the platform database.",
    }];
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(summary), "Summary");
    const rows = payload.results.map((r) => ({
      Prompt_No: r.prompt_number, Prompt_ID: r.prompt_id, Prompt: r.prompt, Topic: r.topic, Language: r.language,
      Engine: r.provider, Status: r.status, "Brand Mentioned": r.brand_mentioned ? "Yes" : "No",
      "Response Text (Full)": r.response_text ?? "", "Raw API Response JSON": r.raw_response ? JSON.stringify(r.raw_response) : "",
      "Error": r.error_message ?? "", Model: r.model ?? "",
      "Token Usage": r.usage ? JSON.stringify(r.usage) : "",
      "Pages Cited (URL)": r.citations.map((c) => c.url).join("\n"),
      "Pages Cited (Title + URL)": r.citations.map((c) => (c.page_name ? c.page_name + " — " : "") + c.url).join("\n"),
      "Brand Page URLs": r.citations.filter((c) => c.is_brand_related).map((c) => c.url).join("\n"),
      "Competitor Domains": r.competitor_hosts.join(", "),
    }));
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(rows), "Prompt Results");
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(payload.citations.map((c) => ({
      Engine: c.provider, Topic: c.topic, Prompt: c.prompt, URL: c.url, "Page Title": c.page_name,
      Domain: c.domain ?? "", "Citation Source": c.citation_source ?? "",
      "Brand / Site": c.brand_name, "Tracked Brand Page": c.is_brand_related ? "Yes" : "No",
    }))), "Pages by Prompt");
    const pageFrequency = new Map<string, { url: string; title: string; domain: string; frequency: number; prompts: Set<string>; engines: Set<string>; brandRelated: boolean }>();
    for (const c of payload.citations) {
      const item = pageFrequency.get(c.url) ?? { url: c.url, title: c.page_name || "", domain: c.domain || "", frequency: 0, prompts: new Set<string>(), engines: new Set<string>(), brandRelated: false };
      item.frequency += 1; item.prompts.add(c.prompt); item.engines.add(c.provider); item.brandRelated ||= c.is_brand_related;
      if (!item.title && c.page_name) item.title = c.page_name;
      if (!item.domain && c.domain) item.domain = c.domain;
      pageFrequency.set(c.url, item);
    }
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet([...pageFrequency.values()].sort((a,b)=>b.frequency-a.frequency).map((p) => ({
      Frequency: p.frequency, "Distinct Prompts": p.prompts.size, "Page Title": p.title, Domain: p.domain, URL: p.url,
      Engines: [...p.engines].join(", "), "Tracked Brand Page": p.brandRelated ? "Yes" : "No",
    }))), "Page Frequency");
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(payload.competitors), "Competitors");
    XLSX.writeFile(wb, `lifewood-sample-run-${runNumber}-${new Date().toISOString().slice(0,10)}.xlsx`);
  }

  return (
    <ProjectShell>
      <div className="ops-page space-y-7">
        <header>
          <p className="page-eyebrow">Testing Lab</p>
          <h1 className="page-title mt-1">Samples</h1>
          <p className="page-description mt-2">Run temporary tests against selected prompts and AI answer engines without changing your platform analytics.</p>
        </header>

        <div className="sample-notice rounded-2xl px-4 py-3 text-sm">
          <strong>Temporary runs:</strong> sample results are held only in this page's current session. They are not saved to the database and are excluded from Dashboard and Analytics. Download the Excel workbook before leaving or refreshing the page.
        </div>

        {error && <div role="alert" className="sample-error rounded-xl px-4 py-3 text-sm">{error}</div>}

        <section className="ops-card overflow-hidden">
          <div className="border-b border-[var(--border)] p-5 sm:p-6">
            <div className="flex items-center gap-3">
              <span className="platform-icon"><FlaskConical size={18}/></span>
              <div><h2 className="text-lg font-semibold">Configure sample run</h2><p className="mt-1 text-sm text-[var(--muted-foreground)]">Choose up to 25 prompts and one or more available engines.</p></div>
            </div>
          </div>
          <div className="grid gap-6 p-5 sm:p-6 xl:grid-cols-[minmax(0,1.3fr)_minmax(300px,.7fr)]">
            <div>
              <div className="flex flex-col gap-3 sm:flex-row">
                <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search prompts…" className="platform-input text-sm"/>
                <select value={topic} onChange={(e) => setTopic(e.target.value)} className="platform-input text-sm sm:max-w-[220px]">{topics.map((t) => <option key={t}>{t}</option>)}</select>
              </div>
              <div className="mt-3 flex flex-wrap items-center justify-between gap-2 text-xs text-[var(--muted-foreground)]">
                <span>{selected.length} of 25 prompts selected</span>
                <div className="flex gap-2">
                  <button onClick={() => setSelected((s) => [...new Set([...s, ...filtered.map((p) => p.id)])].slice(0,25))} className="font-semibold text-[var(--primary)]">Select visible</button>
                  <button onClick={() => setSelected([])} className="font-semibold text-[var(--primary)]">Clear</button>
                </div>
              </div>
              <div className="mt-3 max-h-[440px] overflow-y-auto rounded-xl border border-[var(--border)]">
                {loadingPrompts ? <div className="p-6 text-sm text-[var(--muted-foreground)]">Loading prompts…</div> :
                  filtered.map((p) => {
                    const checked = selected.includes(p.id);
                    const disabled = !checked && selected.length >= 25;
                    return <button key={p.id} disabled={disabled} onClick={() => togglePrompt(p.id)} className="flex w-full items-start gap-3 border-b border-[color-mix(in_srgb,var(--border)_25%,transparent)] p-3 text-left last:border-0 hover:bg-[var(--accent)] disabled:opacity-40">
                      <span className="mt-0.5 text-[var(--primary)]">{checked ? <CheckSquare size={17}/> : <Square size={17}/>}</span>
                      <span className="min-w-0 flex-1"><span className="text-xs font-bold text-[var(--muted-foreground)]">#{p.prompt_number} · {p.topic} · {p.language}</span><span className="mt-1 block text-sm">{p.prompt}</span></span>
                    </button>;
                  })}
                {!loadingPrompts && !filtered.length && <div className="p-6 text-sm text-[var(--muted-foreground)]">No prompts match these filters.</div>}
              </div>
            </div>
            <div className="space-y-5">
              <div>
                <h3 className="font-semibold">AI answer engines</h3>
                <p className="mt-1 text-sm text-[var(--muted-foreground)]">ChatGPT is available in this release. Other engines will be enabled as their runners are implemented.</p>
                <div className="mt-3 space-y-2">
                  {engines.map((engine) => {
                    const checked = selectedEngines.includes(engine.id);
                    return <button key={engine.id} onClick={() => toggleEngine(engine.id)} disabled={!engine.ready} className={"flex w-full items-center justify-between rounded-xl border p-3 text-left " + (checked ? "border-[var(--primary)] bg-[var(--soft)]" : "border-[var(--border)] bg-[var(--card)]") + (!engine.ready ? " cursor-not-allowed opacity-55" : " hover:border-[var(--primary)]")}>
                      <span className="flex items-center gap-3"><span className="text-[var(--primary)]">{checked ? <CheckSquare size={17}/> : <Square size={17}/>}</span><span className="text-sm font-semibold">{engine.label}</span></span>
                      {!engine.ready && <span className="text-[10px] font-bold uppercase tracking-wider text-[var(--muted-foreground)]">Coming soon</span>}
                    </button>;
                  })}
                </div>
              </div>
              <div className="rounded-xl bg-[var(--soft)] p-4">
                <div className="text-xs font-bold uppercase tracking-wider text-[var(--muted-foreground)]">Estimated request count</div>
                <div className="mt-1 text-3xl font-semibold">{selected.length * selectedEngines.length}</div>
                <p className="mt-1 text-xs text-[var(--muted-foreground)]">Each prompt-engine combination makes one API request. API charges may apply.</p>
              </div>
              <button onClick={runSample} disabled={running || loadingPrompts || !selected.length || !selectedEngines.length} className="inline-flex w-full items-center justify-center gap-2 platform-btn platform-btn-primary disabled:opacity-50">
                {running ? <RefreshCw size={16} className="animate-spin"/> : <Play size={16}/>}
                {running ? "Running sample…" : payload ? "Run again (replace current results)" : "Run sample"}
              </button>
              <p className="text-xs text-[var(--muted-foreground)]">Maximum 25 prompts per run. Running again replaces the previous temporary result set.</p>
            </div>
          </div>
        </section>

        {payload && <section className="space-y-5">
          <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-end">
            <div><p className="page-eyebrow">Run {runNumber} · Results</p><h2 className="mt-1 text-xl font-semibold">Sample visibility results</h2><p className="mt-1 text-sm text-[var(--muted-foreground)]">Generated just now · not stored in platform analytics</p></div>
            <button onClick={downloadExcel} className="inline-flex items-center justify-center gap-2 platform-btn platform-btn-primary"><Download size={16}/> Download Excel</button>
          </div>
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            <div className="ops-kpi"><div className="ops-kpi-label">Visibility score</div><div className="ops-kpi-value">{payload.summary.visibility_score.toFixed(1)}%</div><div className="ops-kpi-meta">Across selected prompts</div></div>
            <div className="ops-kpi"><div className="ops-kpi-label">Visibility rank</div><div className="ops-kpi-value">#{payload.summary.visibility_rank}</div><div className="ops-kpi-meta">Estimated from observed competitor citations</div></div>
            <div className="ops-kpi"><div className="ops-kpi-label">Completed</div><div className="ops-kpi-value">{payload.summary.completed}</div><div className="ops-kpi-meta">Successful responses</div></div>
            <div className="ops-kpi"><div className="ops-kpi-label">Failed</div><div className="ops-kpi-value">{payload.summary.failed}</div><div className="ops-kpi-meta">Failed prompt requests</div></div>
          </div>
          <div className="ops-card overflow-hidden sample-table-card">
            <div className="p-5"><h3 className="font-semibold">Prompt-level results</h3><p className="mt-1 text-sm text-[var(--muted-foreground)]">Responses and brand mentions for this temporary run.</p>
              <div className="sample-table-tools mt-4">
                <label className="sample-search"><Search size={16} aria-hidden="true"/><input value={resultSearch} onChange={(e) => { setResultSearch(e.target.value); setResultsExpanded(false); }} placeholder="Search results…" aria-label="Search prompt-level results"/></label>
                <span className="text-xs text-[var(--muted-foreground)]">Showing {visibleResults.length} of {filteredResults.length} matching rows</span>
              </div>
            </div>
            <div className="sample-table-wrap overflow-x-auto"><table className="platform-table sample-data-table min-w-[850px]"><thead><tr><th>Prompt</th><th>Topic</th><th>Engine</th><th>Status</th><th>Brand mentioned</th><th>Brand pages cited</th></tr></thead><tbody>
              {visibleResults.map((r, i) => <tr key={r.prompt_id + r.provider + i}><td className="max-w-[420px]"><div className="text-xs font-bold text-[var(--muted-foreground)]">#{r.prompt_number}</div><div className="mt-1 whitespace-normal">{r.prompt}</div>{r.response_text && <details className="mt-2"><summary className="cursor-pointer text-xs font-semibold text-[var(--primary)]">View full response</summary><p className="mt-2 max-w-2xl whitespace-pre-wrap text-xs leading-5">{r.response_text}</p></details>}{r.error_message && <p className="mt-1 text-xs text-red-700">{r.error_message}</p>}</td><td>{r.topic}</td><td>{r.provider}</td><td><span className={"ops-status " + (r.status === "completed" ? "text-[var(--primary)]" : "text-red-700")}>{r.status}</span></td><td>{r.status === "completed" ? (r.brand_mentioned ? "Yes" : "No") : "—"}</td><td>{r.citations.filter((c) => c.is_brand_related).length}</td></tr>)}
            </tbody></table></div>
            {filteredResults.length > 10 && <div className="sample-table-footer"><button type="button" onClick={() => setResultsExpanded((value) => !value)} className="ops-filter-btn">{resultsExpanded ? "Show first 10" : "Show all " + filteredResults.length + " rows"}</button></div>}
          </div>
          <div className="ops-card overflow-hidden sample-table-card">
            <div className="p-5"><h3 className="font-semibold">All pages cited</h3><p className="mt-1 text-sm text-[var(--muted-foreground)]">Every distinct source page identified in the AI response's web-search citations, ranked by frequency across selected prompts. This includes brand and non-brand pages.</p></div>
            {(() => {
              const pages = new Map<string, { url: string; title: string; domain: string; frequency: number; prompts: Set<string>; brandRelated: boolean }>();
              for (const c of payload.citations) {
                let host = "";
                try { host = new URL(c.url).hostname.replace(/^www\\./, ""); } catch { /* ignore invalid URL */ }
                const item = pages.get(c.url) ?? { url: c.url, title: c.page_name || "", domain: c.domain || host, frequency: 0, prompts: new Set<string>(), brandRelated: false };
                item.frequency += 1; item.prompts.add(c.prompt); item.brandRelated ||= c.is_brand_related;
                if (!item.title && c.page_name) item.title = c.page_name;
                pages.set(c.url, item);
              }
              const sorted = [...pages.values()].sort((a,b) => b.frequency - a.frequency || a.title.localeCompare(b.title));
              const filteredPages = sorted.filter((p) => [p.title, p.domain, p.url].some((value) => value.toLowerCase().includes(pagesSearch.trim().toLowerCase())));
              const visiblePages = pagesExpanded ? filteredPages : filteredPages.slice(0, 10);
              return <>
                <div className="sample-table-tools px-5 pb-4">
                  <label className="sample-search"><Search size={16} aria-hidden="true"/><input value={pagesSearch} onChange={(e) => { setPagesSearch(e.target.value); setPagesExpanded(false); }} placeholder="Search cited pages…" aria-label="Search cited pages"/></label>
                  <span className="text-xs text-[var(--muted-foreground)]">Showing {visiblePages.length} of {filteredPages.length} matching rows</span>
                </div>
                <div className="sample-table-wrap overflow-x-auto"><table className="platform-table sample-data-table min-w-[850px]"><thead><tr><th>Frequency</th><th>Page title</th><th>Domain</th><th>URL</th><th>Prompts</th><th>Brand page</th></tr></thead><tbody>
                {visiblePages.map((p) => <tr key={p.url}><td><span className="font-semibold">{p.frequency}</span></td><td className="max-w-[260px] whitespace-normal">{p.title || "Untitled page"}</td><td>{p.domain}</td><td className="max-w-[360px]"><a className="inline-flex items-center gap-1 break-all font-semibold text-[var(--primary)] hover:underline" href={p.url} target="_blank" rel="noreferrer">{p.url}<ExternalLink size={12}/></a></td><td>{p.prompts.size}</td><td>{p.brandRelated ? "Yes" : "No"}</td></tr>)}
                {!filteredPages.length && <tr><td colSpan={6} className="py-8 text-center text-sm text-[var(--muted-foreground)]">No source pages were returned. The run may have had no usable web-search citations, or the API response may not include source metadata.</td></tr>}
              </tbody></table></div>
                {filteredPages.length > 10 && <div className="sample-table-footer"><button type="button" onClick={() => setPagesExpanded((value) => !value)} className="ops-filter-btn">{pagesExpanded ? "Show first 10" : "Show all " + filteredPages.length + " rows"}</button></div>}
              </>;
            })()}
          </div>
          <div className="ops-card overflow-hidden sample-table-card">
            <div className="p-5"><h3 className="font-semibold">Observed competitor domains</h3><p className="mt-1 text-sm text-[var(--muted-foreground)]">Non-brand domains found in response URLs; these are heuristic observations.</p>
              <div className="sample-table-tools mt-4">
                <label className="sample-search"><Search size={16} aria-hidden="true"/><input value={competitorsSearch} onChange={(e) => { setCompetitorsSearch(e.target.value); setCompetitorsExpanded(false); }} placeholder="Search competitors…" aria-label="Search competitor domains"/></label>
                <span className="text-xs text-[var(--muted-foreground)]">Showing {visibleCompetitors.length} of {filteredCompetitors.length} matching rows</span>
              </div>
            </div>
            <div className="sample-table-wrap overflow-x-auto"><table className="platform-table sample-data-table min-w-[500px]"><thead><tr><th>Domain</th><th>Prompt citations</th></tr></thead><tbody>
              {visibleCompetitors.map((c) => <tr key={c.domain}><td>{c.domain}</td><td>{c.mentions}</td></tr>)}
              {!filteredCompetitors.length && <tr><td colSpan={2} className="py-8 text-center text-sm text-[var(--muted-foreground)]">No competitor domains found.</td></tr>}
            </tbody></table></div>
            {filteredCompetitors.length > 10 && <div className="sample-table-footer"><button type="button" onClick={() => setCompetitorsExpanded((value) => !value)} className="ops-filter-btn">{competitorsExpanded ? "Show first 10" : "Show all " + filteredCompetitors.length + " rows"}</button></div>}
          </div>
        </section>}
      </div>
    </ProjectShell>
  );
}
