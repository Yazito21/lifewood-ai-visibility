"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useParams } from "next/navigation";
import { CalendarDays, ChevronDown, ChevronRight, Download, FileText, Search } from "lucide-react";
import * as XLSX from "xlsx";
import { ProjectShell } from "@/components/project-shell";
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
  if (row.response_text) return row.response_text;
  if (row.raw_response && typeof row.raw_response === "object") {
    const raw = row.raw_response as Record<string, unknown>;
    if (typeof raw.output_text === "string") return raw.output_text;
    if (typeof raw.text === "string") return raw.text;
  }
  return "";
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
  const [topics, setTopics] = useState<string[]>([]);
  const [searched, setSearched] = useState(false);
  const [search, setSearch] = useState("");
  const [rows, setRows] = useState<ResponseRow[]>([]);
  const [loading, setLoading] = useState(true);
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
    const { data, error: queryError } = await supabase
      .from("ai_responses")
      .select("id,prompt_id,llm_provider,captured_at,prompt_snapshot,raw_response,response_text,response_status,error_message,run_id,tracking_location,brand_name_snapshot,project_snapshot")
      .eq("project_id", projectId)
      .in("llm_provider", provider)
      .gte("captured_at", start.toISOString())
      .lt("captured_at", endExclusive.toISOString())
      .order("captured_at", { ascending: false })
      .limit(5000);
    if (queryError) {
      setError(queryError.message);
      setRows([]);
    } else {
      setRows((data ?? []) as ResponseRow[]);
    }
    setPage(1);
    setExpanded([]);
    setLoading(false);
  }, [projectId, fromDate, toDate]);

  useEffect(() => { void supabase.from("prompts").select("*").eq("project_id", projectId).limit(2000).then(({data}) => { if (data) setTopicOptions([...new Set((data as Array<Record<string, unknown>>).map((p) => String(p.topic_name || p.topic || "")).filter(Boolean))].sort()); }); }, [projectId]);

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
            {topicOptions.map((topic) => <label key={topic} className="inline-flex items-center gap-2 rounded-lg border border-[var(--border)] px-3 py-2 text-xs"><input type="checkbox" checked={topics.includes(topic)} onChange={(e) => setTopics((s) => e.target.checked ? [...s, topic] : s.filter((x) => x !== topic))} className="accent-emerald-600"/>{topic}</label>)}
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
                const row = group.responses[0];
                const isOpen = expanded.includes(group.key);
                const text = responseText(row);
                return <article key={row.id} className="min-w-0">
                  <button type="button" onClick={() => setExpanded(isOpen ? expanded.filter((x) => x !== group.key) : [...expanded, group.key])} className="flex w-full min-w-0 items-start gap-3 p-4 text-left transition hover:bg-[var(--accent)]/50 sm:items-center sm:px-5">
                    <span className="mt-0.5 shrink-0 text-[var(--muted-foreground)]">{isOpen ? <ChevronDown size={17}/> : <ChevronRight size={17}/>}</span>
                    <span className="min-w-0 flex-1">
                      <span className="flex flex-wrap items-center gap-2 text-[11px] text-[var(--muted-foreground)]">
                        <span className="font-semibold text-[var(--primary)]">{providerLabels[row.llm_provider] ?? row.llm_provider}</span>
                        <span>·</span><span>{formatDate(row.captured_at)}</span>
                        {row.tracking_location && <><span>·</span><span>{row.tracking_location}</span></>}
                        <span className={row.response_status === "completed" ? "rounded-full bg-emerald-500/10 px-2 py-0.5 font-semibold text-emerald-700 dark:text-emerald-300" : "rounded-full bg-red-500/10 px-2 py-0.5 font-semibold text-red-700 dark:text-red-300"}>{row.response_status}</span>
                      </span>
                      <span className="mt-1.5 block text-sm font-semibold text-[var(--foreground)]">{group.prompt}</span>
                      <span className="mt-1 block line-clamp-2 whitespace-pre-wrap text-xs leading-5 text-[var(--muted-foreground)]">{row.error_message || text || "No text response available. Expand to inspect the raw payload."}</span>
                    </span>
                    <span className="hidden shrink-0 text-xs text-[var(--muted-foreground)] lg:block">{row.run_id ? `Run ${row.run_id.slice(0, 8)}` : "No run ID"}</span>
                  </button>
                  {isOpen && <div className="space-y-4 border-t border-[var(--border)] bg-[var(--soft)]/40 p-4 sm:p-5">
                    {group.responses.map((response) => {
                      const answer = responseText(response);
                      const links = [...new Set((answer.match(/https?:\\/\\/[^\\s<>"\\)]+/g) || []).map((url) => url.replace(/[.,;:!?]+$/, "")))];
                      return <section key={response.id} className="rounded-xl border border-[var(--border)] bg-[var(--card)] p-4 sm:p-5">
                        <div className="mb-4 flex flex-wrap items-center gap-2 border-b border-[var(--border)] pb-3 text-xs"><span className="rounded-full border border-[var(--border)] bg-[var(--soft)] px-2.5 py-1 font-semibold">{providerLabels[response.llm_provider] || response.llm_provider}</span><span className="text-[var(--muted-foreground)]">{formatDate(response.captured_at)}</span>{response.tracking_location && <span className="text-[var(--muted-foreground)]">· {response.tracking_location}</span>}</div>
                        {response.error_message && <p className="mb-3 rounded-lg border border-red-500/20 bg-red-500/5 p-3 text-sm">{response.error_message}</p>}
                        <div className="whitespace-pre-wrap break-words text-sm leading-7 text-[var(--foreground)]">{answer.split(/(\\*\\*[^*]+\\*\\*)/g).map((part, i) => part.startsWith("**") && part.endsWith("**") ? <strong key={i}>{part.slice(2, -2)}</strong> : part.startsWith("[") && part.includes("](") ? <span key={i}>{part}</span> : part)}</div>
                        {links.length > 0 && <div className="mt-6 border-t border-[var(--border)] pt-4"><div className="mb-3 flex items-center justify-between"><h4 className="text-xs font-bold uppercase tracking-wider text-[var(--muted-foreground)]">Citations</h4><span className="text-xs text-[var(--muted-foreground)]">{links.length} sources</span></div><div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">{links.map((url, i) => { let domain = url; try { domain = new URL(url).hostname.replace(/^www\\./, ""); } catch {} return <a key={url} href={url} target="_blank" rel="noreferrer" className="group min-w-0 rounded-xl border border-[var(--border)] bg-[var(--background)] p-3 transition hover:border-emerald-600/50"><div className="flex items-center gap-2"><span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md bg-[var(--soft)] text-[10px] font-bold text-[var(--muted-foreground)]">{i + 1}</span><span className="truncate text-[11px] font-medium text-[var(--muted-foreground)]">{domain}</span><ExternalLink size={12} className="ml-auto shrink-0"/></div><p className="mt-2 break-words text-sm font-semibold text-[var(--foreground)]">{url}</p></a>})}</div></div>}
                        <details className="mt-5 rounded-lg border border-[var(--border)]"><summary className="cursor-pointer px-3 py-2 text-xs font-semibold text-[var(--muted-foreground)]">Raw response payload</summary><pre className="max-h-96 overflow-auto whitespace-pre-wrap break-words border-t border-[var(--border)] p-3 text-xs">{JSON.stringify(response.raw_response, null, 2) ?? "null"}</pre></details>
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
              <button type="button" disabled={page >= pageCount} onClick={() => {setPage((p) => p + 1); setExpanded(null);}} className="platform-btn h-9 disabled:opacity-40">Next</button>
            </div>
          </div>}
        </section>
      </div>
    </ProjectShell>
  );
}
