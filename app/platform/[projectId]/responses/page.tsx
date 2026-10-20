"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useParams } from "next/navigation";
import { CalendarDays, ChevronDown, ChevronRight, Download, ExternalLink, FileText, Search } from "lucide-react";
import * as XLSX from "xlsx";
import { ProjectShell } from "@/components/project-shell";
import { TrackingDataScope } from "@/components/tracking-data-scope";
import { supabase } from "@/lib/supabase";

type ResponseRow = {
  id: string;
  prompt_id: string | null;
  llm_provider: string;
  captured_at: string;
  prompt_snapshot: string | null;
  raw_response: unknown;
  response_text: string | null;
  response_status: string;
  error_message: string | null;
  run_id: string | null;
  tracking_location: string | null;
  brand_name_snapshot: string | null;
  project_snapshot: Record<string, unknown> | null;
};

const PAGE_SIZE = 50;
const providerLabels: Record<string, string> = {
  chatgpt: "ChatGPT", gemini: "Gemini", perplexity: "Perplexity",
  google_ai_overview: "Google AI Overview", claude: "Claude",
};

function dateValue(date: Date) {
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60000);
  return local.toISOString().slice(0, 10);
}
function formatDate(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString(undefined, {
    year: "numeric", month: "short", day: "numeric", hour: "2-digit", minute: "2-digit",
  });
}
function responseText(row: ResponseRow) {
  let text = "";
  if (row.response_text) text = row.response_text;
  else if (row.raw_response && typeof row.raw_response === "object") {
    const raw = row.raw_response as Record<string, unknown>;
    if (typeof raw.output_text === "string") text = raw.output_text;
    else if (typeof raw.text === "string") text = raw.text;
  }
  return text.replace(/\\\\([*_[\]()])/g, "$1")
    .replace(/\[([^\]]+)\]\s+\((https?:\/\/[^)]+)\)/g, "[$1]($2)")
    .replace(/\*\*\s+([^*\n]+?)\s+\*\*/g, "**$1**");
}

export default function ResponsesPage() {
  const { projectId } = useParams<{ projectId: string }>();
  const today = useMemo(() => dateValue(new Date()), []);
  const sevenDaysAgo = useMemo(() => {
    const date = new Date();
    date.setDate(date.getDate() - 6);
    return dateValue(date);
  }, []);
  const [fromDate, setFromDate] = useState("");
  const [toDate, setToDate] = useState(today);
  const [provider, setProvider] = useState<string[]>([]);
  const [status, setStatus] = useState("all");
  const [topicOptions, setTopicOptions] = useState<string[]>([]);
  const [hasUnclassifiedLegacy, setHasUnclassifiedLegacy] = useState(false);
  const [trackingLocation, setTrackingLocation] = useState("MY");
  const [scope, setScope] = useState<"current" | "legacy">("current");
  const [topics, setTopics] = useState<string[]>([]);
  const [searched, setSearched] = useState(false);
  const [search, setSearch] = useState("");
  const [rows, setRows] = useState<ResponseRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [page, setPage] = useState(1);
  const [expanded, setExpanded] = useState<string[]>([]);

  const loadResponses = useCallback(async () => {
    if (!fromDate || !toDate || !topics.length || !provider.length) { setError("Choose a date range, at least one topic, and at least one AI engine."); return; }
    setLoading(true);
    setSearched(true);
    setError("");
    const start = new Date(fromDate + "T00:00:00");
    const end = new Date(toDate + "T00:00:00");
    if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || start > end) {
      setError("Choose a valid date range. The start date must be on or before the end date.");
      setRows([]);
      setLoading(false);
      return;
    }
    const endExclusive = new Date(end);
    endExclusive.setDate(endExclusive.getDate() + 1);
    const result: ResponseRow[] = [];
    let queryError: { message: string } | null = null;
    for (let offset = 0; ; offset += 1000) {
      const { data: batch, error: batchError } = await supabase
        .from("ai_responses")
        .select("id,prompt_id,llm_provider,captured_at,prompt_snapshot,raw_response,response_text,response_status,error_message,run_id,tracking_location,brand_name_snapshot,project_snapshot")
        .eq("project_id", projectId)
        .eq("tracking_location", scope === "legacy" ? "LEGACY" : trackingLocation)
        .in("llm_provider", provider)
        .gte("captured_at", start.toISOString())
        .lt("captured_at", endExclusive.toISOString())
        .order("captured_at", { ascending: false })
        .order("id", { ascending: true })
        .range(offset, offset + 999);
      if (batchError) { queryError = batchError; break; }
      const batchRows = (batch ?? []) as ResponseRow[];
      result.push(...batchRows);
      if (batchRows.length < 1000) break;
    }
    if (queryError) {
      setError(queryError.message);
      setRows([]);
    } else {
      const ids = [...new Set(result.map((r) => r.prompt_id).filter((id): id is string => Boolean(id)))];
      const topicByPrompt = new Map<string, string>();
      if (ids.length) {
        const { data: promptRows, error: promptLookupError } = await supabase.from("prompts")
          .select("id,topic").eq("project_id", projectId).in("id", ids);
        if (promptLookupError) setError(promptLookupError.message);
        for (const prompt of (promptRows ?? []) as Array<Record<string, unknown>>) topicByPrompt.set(String(prompt.id), String(prompt.topic ?? ""));
      }
      setRows(result.filter((r) => r.prompt_id
        ? topics.includes(topicByPrompt.get(r.prompt_id) || "")
        : topics.includes("Unclassified legacy prompts")));
    }
    setPage(1);
    setExpanded([]);
    setLoading(false);
  }, [projectId, fromDate, toDate, topics, provider, scope, trackingLocation]);

  useEffect(() => {
    let cancelled = false;
    async function loadFilters() {
      const [{ data: project }, { data: promptRows }, { count: unclassifiedCount }] = await Promise.all([
        supabase.from("projects").select("tracking_market").eq("id", projectId).single(),
        supabase.from("prompts").select("id,topic").eq("project_id", projectId).limit(2000),
        supabase.from("ai_responses").select("id", { count: "exact", head: true })
          .eq("project_id", projectId).eq("tracking_location", "LEGACY").is("prompt_id", null),
      ]);
      if (cancelled) return;
      setTrackingLocation(project?.tracking_market ?? "MY");
      setTopicOptions([...new Set((promptRows ?? []).map((p) => String((p as Record<string, unknown>).topic ?? "")).filter(Boolean))].sort());
      setHasUnclassifiedLegacy((unclassifiedCount ?? 0) > 0);
    }
    void loadFilters();
    return () => { cancelled = true; };
  }, [projectId]);
  const visibleTopicOptions = scope === "legacy" && hasUnclassifiedLegacy
    ? [...topicOptions, "Unclassified legacy prompts"]
    : topicOptions;

  const filtered = useMemo(() => rows.filter((row) => {
    if (provider.length && !provider.includes(row.llm_provider)) return false;
    if (status !== "all" && row.response_status !== status) return false;
    const needle = search.trim().toLowerCase();
    if (!needle) return true;
    return [
      row.prompt_snapshot ?? "", row.response_text ?? "", row.llm_provider,
      row.tracking_location ?? "", row.run_id ?? "", row.response_status,
      row.error_message ?? "",
    ].some((value) => value.toLowerCase().includes(needle));
  }), [rows, provider, status, search]);

  const grouped = useMemo(() => { const map = new Map<string, ResponseRow[]>(); for (const row of filtered) { const key = row.prompt_id || row.prompt_snapshot || row.id; map.set(key, [...(map.get(key) || []), row]); } return [...map.entries()].map(([key, responses]) => ({key, prompt: responses[0].prompt_snapshot || "Prompt unavailable", responses})); }, [filtered]);
  const pageCount = Math.max(1, Math.ceil(grouped.length / PAGE_SIZE));
  const visible = grouped.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  function exportExcel() {
    const workbook = XLSX.utils.book_new();
    const exportRows = filtered.map((row) => ({
      Captured_At: row.captured_at,
      Prompt: row.prompt_snapshot ?? "",
      Platform: providerLabels[row.llm_provider] ?? row.llm_provider,
      Region: row.tracking_location ?? "",
      Status: row.response_status,
      Response: responseText(row),
      Raw_Response_JSON: row.raw_response == null ? "" : JSON.stringify(row.raw_response),
      Error: row.error_message ?? "",
      Run_ID: row.run_id ?? "",
      Response_ID: row.id,
    }));
    XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet(exportRows), "Raw Responses");
    XLSX.writeFile(workbook, `lifewood-responses-${fromDate}-to-${toDate}.xlsx`);
  }

  return (
    <ProjectShell>
      <div className="ops-page space-y-6">
        <header>
          <p className="page-eyebrow">Tracking data</p>
          <h1 className="page-title mt-1">Responses</h1>
          <p className="page-description mt-2">Browse the full AI answers captured by tracking runs, inspect the raw provider payload, and export responses for a selected period.</p>
        </header>

        <TrackingDataScope trackingLocation={trackingLocation} scope={scope} onScopeChange={setScope} />

        <section className="ops-card p-5 sm:p-6">
          <h2 className="mb-4 text-sm font-semibold">Filter responses</h2>
          <div className="grid gap-4 md:grid-cols-2">
            <label className="text-xs font-semibold text-[var(--muted-foreground)]">Start date
              <input type="date" value={fromDate} max={toDate || today} onChange={(e) => setFromDate(e.target.value)} className="platform-input mt-2 text-sm"/>
            </label>
            <label className="text-xs font-semibold text-[var(--muted-foreground)]">End date
              <input type="date" value={toDate} min={fromDate || undefined} max={today} onChange={(e) => setToDate(e.target.value)} className="platform-input mt-2 text-sm"/>
            </label>
          </div>
          <div className="mt-4"><p className="mb-2 text-xs font-semibold text-[var(--muted-foreground)]">Topics</p><div className="flex flex-wrap gap-2">
            {visibleTopicOptions.map((topic) => <label key={topic} className="inline-flex items-center gap-2 rounded-lg border border-[var(--border)] px-3 py-2 text-xs"><input type="checkbox" checked={topics.includes(topic)} onChange={(e) => setTopics((s) => e.target.checked ? [...s, topic] : s.filter((x) => x !== topic))} className="accent-emerald-600"/>{topic}</label>)}
            {!topicOptions.length && <span className="text-xs text-[var(--muted-foreground)]">No topics found.</span>}
          </div></div>
          <div className="mt-4"><p className="mb-2 text-xs font-semibold text-[var(--muted-foreground)]">AI engines</p><div className="flex flex-wrap gap-2">
            {Object.entries(providerLabels).map(([id,label]) => <label key={id} className="inline-flex items-center gap-2 rounded-lg border border-[var(--border)] px-3 py-2 text-xs"><input type="checkbox" checked={provider.includes(id)} onChange={(e) => setProvider((s) => e.target.checked ? [...s,id] : s.filter((x) => x !== id))} className="accent-emerald-600"/>{label}</label>)}
          </div></div>
          <div className="mt-5 flex justify-end border-t border-[var(--border)] pt-4"><button type="button" onClick={() => void loadResponses()} disabled={loading} className="platform-btn platform-btn-primary h-10 px-5">{loading ? "Loading…" : "Show responses"}</button></div>
        </section>
        <div className="flex flex-wrap items-center justify-between gap-3 text-sm text-[var(--muted-foreground)]">
          <span>{searched ? `${grouped.length} prompts · ${filtered.length} responses` : "Choose filters to view responses"}</span>
          {searched && <div className="flex gap-2"><input value={search} onChange={(e) => {setSearch(e.target.value);setPage(1)}} placeholder="Search prompts or responses…" className="platform-input text-sm"/><button type="button" onClick={exportExcel} disabled={!filtered.length} className="platform-btn h-10 gap-2"><Download size={15}/> Export Excel</button></div>}
        </div>

        {error && <div role="alert" className="platform-notice-error rounded-xl px-4 py-3 text-sm">{error}</div>}

        <section className="ops-card overflow-hidden">
          {loading ? <div className="space-y-3 p-5">{[0,1,2,3,4].map((n) => <div key={n} className="h-16 animate-pulse rounded-lg bg-[var(--soft)]"/>)}</div> :
            !searched ? <div className="px-6 py-16 text-center"><FileText size={28} className="mx-auto text-[var(--muted-foreground)]"/><h2 className="mt-3 font-semibold">Choose filters to get started</h2><p className="mt-1 text-sm text-[var(--muted-foreground)]">Select a date range, topics, and AI engines to view responses.</p></div> : !visible.length ? <div className="px-6 py-16 text-center">
              <FileText size={28} className="mx-auto text-[var(--muted-foreground)]"/>
              <h2 className="mt-3 font-semibold">No responses found</h2>
              <p className="mt-1 text-sm text-[var(--muted-foreground)]">Try another date range or filter. Responses are saved when a persistent tracking run completes.</p>
            </div> :
            <div className="divide-y divide-[var(--border)]">
              {visible.map((group) => {
                const isOpen = expanded.includes(group.key);
                const byDate = new Map<string, ResponseRow[]>();
                for (const response of group.responses) {
                  const dateKey = dateValue(new Date(response.captured_at));
                  byDate.set(dateKey, [...(byDate.get(dateKey) || []), response]);
                }
                return <article key={group.key} className="min-w-0">
                  <button type="button" onClick={() => setExpanded(isOpen ? expanded.filter((x) => x !== group.key && !x.startsWith(group.key + "::")) : [...expanded, group.key])} className="flex w-full min-w-0 items-center gap-3 p-4 text-left transition hover:bg-[var(--accent)]/50 sm:px-5">
                    <span className="shrink-0 text-[var(--muted-foreground)]">{isOpen ? <ChevronDown size={17}/> : <ChevronRight size={17}/>}</span>
                    <span className="min-w-0 flex-1">
                      <span className="block text-sm font-semibold text-[var(--foreground)]">{group.prompt}</span>
                      <span className="mt-1 block text-xs text-[var(--muted-foreground)]">{group.responses.length} engine response{group.responses.length === 1 ? "" : "s"} across {byDate.size} date{byDate.size === 1 ? "" : "s"}</span>
                    </span>
                    <span className="shrink-0 text-xs text-[var(--muted-foreground)]">{isOpen ? "Collapse prompt" : "Expand prompt"}</span>
                  </button>
                  {isOpen && <div className="space-y-3 border-t border-[var(--border)] bg-[var(--soft)]/30 p-3 sm:p-4">
                    {[...byDate.entries()].sort(([a], [b]) => b.localeCompare(a)).map(([dateKey, dateResponses]) => {
                      const dateId = group.key + "::date::" + dateKey;
                      const dateOpen = expanded.includes(dateId);
                      return <section key={dateId} className="overflow-hidden rounded-xl border border-[var(--border)] bg-[var(--card)]">
                        <button type="button" onClick={() => setExpanded(dateOpen ? expanded.filter((x) => x !== dateId && !x.startsWith(dateId + "::")) : [...expanded, dateId])} className="flex w-full items-center gap-3 px-4 py-3 text-left hover:bg-[var(--accent)]/40">
                          <span className="text-[var(--muted-foreground)]">{dateOpen ? <ChevronDown size={16}/> : <ChevronRight size={16}/>}</span>
                          <CalendarDays size={15} className="text-[var(--primary)]"/>
                          <span className="flex-1 text-sm font-semibold">{new Date(dateKey + "T12:00:00").toLocaleDateString(undefined, { year: "numeric", month: "long", day: "numeric" })}</span>
                          <span className="text-xs text-[var(--muted-foreground)]">{dateResponses.length} engine{dateResponses.length === 1 ? "" : "s"}</span>
                        </button>
                        {dateOpen && <div className="space-y-2 border-t border-[var(--border)] p-3 sm:p-4">
                          {dateResponses.slice().sort((a, b) => a.llm_provider.localeCompare(b.llm_provider) || a.captured_at.localeCompare(b.captured_at)).map((response) => {
                            const engineId = dateId + "::engine::" + response.id;
                            const engineOpen = expanded.includes(engineId);
                            const answer = responseText(response);
                            const links = [...new Set((answer.match(/https?:\/\/[^\s<>"')\]]+/g) || []).map((url) => url.replace(/[.,;:!?]+$/, "")))];
                            const rawJson = JSON.stringify(response.raw_response, null, 2) ?? "null";
                            return <section key={response.id} className="overflow-hidden rounded-lg border border-[var(--border)]">
                              <button type="button" onClick={() => setExpanded(engineOpen ? expanded.filter((x) => x !== engineId && !x.startsWith(engineId + "::")) : [...expanded, engineId])} className="flex w-full items-center gap-3 px-3 py-3 text-left hover:bg-[var(--accent)]/40 sm:px-4">
                                <span className="text-[var(--muted-foreground)]">{engineOpen ? <ChevronDown size={15}/> : <ChevronRight size={15}/>}</span>
                                <span className="flex-1">
                                  <span className="block text-sm font-semibold">{providerLabels[response.llm_provider] || response.llm_provider}</span>
                                  <span className="mt-0.5 block text-xs text-[var(--muted-foreground)]">{formatDate(response.captured_at)}{response.tracking_location ? " · " + response.tracking_location : ""}</span>
                                </span>
                                <span className={response.response_status === "completed" ? "rounded-full bg-emerald-500/10 px-2 py-1 text-[10px] font-semibold text-emerald-700 dark:text-emerald-300" : "rounded-full bg-red-500/10 px-2 py-1 text-[10px] font-semibold text-red-700 dark:text-red-300"}>{response.response_status}</span>
                              </button>
                              {engineOpen && <div className="space-y-4 border-t border-[var(--border)] bg-[var(--background)] p-4 sm:p-5">
                                {response.error_message && <p className="rounded-lg border border-red-500/20 bg-red-500/5 p-3 text-sm">{response.error_message}</p>}
                                {answer ? <div className="whitespace-pre-wrap break-words text-sm leading-7 text-[var(--foreground)]">{answer.split(/(\*\*[^*]+\*\*|\[[^\]]+\]\(https?:\/\/[^\s)]+\))/g).map((part, i) => { const link = part.match(/^\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)$/); if (link) return <a key={i} href={link[2]} target="_blank" rel="noreferrer" className="text-emerald-700 underline underline-offset-2 dark:text-emerald-300">{link[1]}</a>; return part.startsWith("**") && part.endsWith("**") ? <strong key={i}>{part.slice(2, -2).trim()}</strong> : part; })}</div> : <p className="text-sm italic text-[var(--muted-foreground)]">No readable response text is available for this engine.</p>}
                                <details className="overflow-hidden rounded-lg border border-[var(--border)]">
                                  <summary className="flex cursor-pointer list-none items-center gap-2 px-3 py-3 text-xs font-semibold hover:bg-[var(--accent)]/40"><ChevronRight size={14}/> Cited pages <span className="ml-auto text-[var(--muted-foreground)]">{links.length} sources</span></summary>
                                  <div className="border-t border-[var(--border)] p-3">
                                    {links.length ? <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">{links.map((url, i) => { let domain = url; try { domain = new URL(url).hostname.replace(/^www\./, ""); } catch {} return <a key={url} href={url} target="_blank" rel="noreferrer" className="group min-w-0 rounded-xl border border-[var(--border)] bg-[var(--card)] p-3 transition hover:border-emerald-600/50"><div className="flex items-center gap-2"><span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md bg-[var(--soft)] text-[10px] font-bold text-[var(--muted-foreground)]">{i + 1}</span><span className="truncate text-[11px] font-medium text-[var(--muted-foreground)]">{domain}</span><ExternalLink size={12} className="ml-auto shrink-0"/></div><p className="mt-2 break-words text-sm font-semibold text-[var(--foreground)]">{url}</p></a>})}</div> : <p className="text-xs text-[var(--muted-foreground)]">No cited page URLs were found in this response.</p>}
                                  </div>
                                </details>
                                <details className="overflow-hidden rounded-lg border border-[var(--border)]">
                                  <summary className="flex cursor-pointer list-none items-center gap-2 px-3 py-3 text-xs font-semibold hover:bg-[var(--accent)]/40"><ChevronRight size={14}/> Raw JSON <span className="ml-auto text-[var(--muted-foreground)]">Provider payload</span></summary>
                                  <div className="border-t border-[var(--border)]">
                                    <div className="flex items-center justify-between gap-3 px-3 py-2"><span className="text-xs text-[var(--muted-foreground)]">Original response payload in JSON format</span><a href={"data:application/json;charset=utf-8," + encodeURIComponent(rawJson)} download={"response-" + response.id + ".json"} className="platform-btn h-8 gap-2 px-3 text-xs"><Download size={13}/> Download JSON</a></div>
                                    <pre className="max-h-96 overflow-auto whitespace-pre-wrap break-words border-t border-[var(--border)] bg-[var(--soft)]/40 p-3 text-xs leading-5">{rawJson}</pre>
                                  </div>
                                </details>
                              </div>}
                            </section>;
                          })}
                        </div>}
                      </section>;
                    })}
                  </div>}
                </article>;
              })}
            </div>}
          {!loading && grouped.length > PAGE_SIZE && <div className="flex items-center justify-between border-t border-[var(--border)] p-4">
            <span className="text-xs text-[var(--muted-foreground)]">Page {page} of {pageCount}</span>
            <div className="flex gap-2">
              <button type="button" disabled={page <= 1} onClick={() => {setPage((p) => p - 1); setExpanded([]);}} className="platform-btn h-9 disabled:opacity-40">Previous</button>
              <button type="button" disabled={page >= pageCount} onClick={() => {setPage((p) => p + 1); setExpanded([]);}} className="platform-btn h-9 disabled:opacity-40">Next</button>
            </div>
          </div>}
        </section>
      </div>
    </ProjectShell>
  );
}
