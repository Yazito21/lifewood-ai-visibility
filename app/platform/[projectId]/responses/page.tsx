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
  const [fromDate, setFromDate] = useState(sevenDaysAgo);
  const [toDate, setToDate] = useState(today);
  const [provider, setProvider] = useState("all");
  const [status, setStatus] = useState("all");
  const [search, setSearch] = useState("");
  const [rows, setRows] = useState<ResponseRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [page, setPage] = useState(1);
  const [expanded, setExpanded] = useState<string | null>(null);

  const loadResponses = useCallback(async () => {
    setLoading(true);
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
    setExpanded(null);
    setLoading(false);
  }, [projectId, fromDate, toDate]);

  useEffect(() => { void loadResponses(); }, [loadResponses]);

  const filtered = useMemo(() => rows.filter((row) => {
    if (provider !== "all" && row.llm_provider !== provider) return false;
    if (status !== "all" && row.response_status !== status) return false;
    const needle = search.trim().toLowerCase();
    if (!needle) return true;
    return [
      row.prompt_snapshot ?? "", row.response_text ?? "", row.llm_provider,
      row.tracking_location ?? "", row.run_id ?? "", row.response_status,
      row.error_message ?? "",
    ].some((value) => value.toLowerCase().includes(needle));
  }), [rows, provider, status, search]);

  const pageCount = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const visible = filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

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

        <section className="ops-card p-4 sm:p-5">
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-[1fr_1fr_1fr_1fr_auto] xl:items-end">
            <label className="block text-xs font-semibold text-[var(--muted-foreground)]">
              <span className="mb-1.5 flex items-center gap-1.5"><CalendarDays size={14}/> From</span>
              <input type="date" value={fromDate} max={toDate} onChange={(e) => setFromDate(e.target.value)} className="platform-input text-sm"/>
            </label>
            <label className="block text-xs font-semibold text-[var(--muted-foreground)]">
              <span className="mb-1.5 flex items-center gap-1.5"><CalendarDays size={14}/> To</span>
              <input type="date" value={toDate} min={fromDate} max={today} onChange={(e) => setToDate(e.target.value)} className="platform-input text-sm"/>
            </label>
            <label className="block text-xs font-semibold text-[var(--muted-foreground)]">
              <span className="mb-1.5 block">AI platform</span>
              <select value={provider} onChange={(e) => {setProvider(e.target.value); setPage(1);}} className="platform-input text-sm">
                <option value="all">All platforms</option>
                {Object.entries(providerLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
              </select>
            </label>
            <label className="block text-xs font-semibold text-[var(--muted-foreground)]">
              <span className="mb-1.5 block">Response status</span>
              <select value={status} onChange={(e) => {setStatus(e.target.value); setPage(1);}} className="platform-input text-sm">
                <option value="all">All statuses</option>
                <option value="completed">Completed</option>
                <option value="failed">Failed</option>
              </select>
            </label>
            <button type="button" onClick={() => void loadResponses()} disabled={loading} className="platform-btn platform-btn-primary h-10 justify-center">
              {loading ? "Loading…" : "Apply filters"}
            </button>
          </div>
          <div className="mt-4 flex flex-col gap-3 border-t border-[var(--border)] pt-4 sm:flex-row sm:items-center">
            <div className="relative min-w-0 flex-1">
              <Search size={16} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[var(--muted-foreground)]"/>
              <input value={search} onChange={(e) => {setSearch(e.target.value); setPage(1);}} placeholder="Search prompts, response text, region or run ID…" className="platform-input pl-9 text-sm"/>
            </div>
            <button type="button" onClick={exportExcel} disabled={!filtered.length} className="platform-btn h-10 justify-center gap-2">
              <Download size={15}/> Export Excel
            </button>
          </div>
        </section>

        <div className="flex flex-wrap items-center justify-between gap-2 text-sm text-[var(--muted-foreground)]">
          <span>{loading ? "Loading stored responses…" : `${filtered.length.toLocaleString()} responses`} <span className="opacity-70">· ${fromDate} to ${toDate}</span></span>
          <span>Raw responses are retained from persistent tracking runs.</span>
        </div>

        {error && <div role="alert" className="platform-notice-error rounded-xl px-4 py-3 text-sm">{error}</div>}

        <section className="ops-card overflow-hidden">
          {loading ? <div className="space-y-3 p-5">{[0,1,2,3,4].map((n) => <div key={n} className="h-16 animate-pulse rounded-lg bg-[var(--soft)]"/>)}</div> :
            !visible.length ? <div className="px-6 py-16 text-center">
              <FileText size={28} className="mx-auto text-[var(--muted-foreground)]"/>
              <h2 className="mt-3 font-semibold">No responses found</h2>
              <p className="mt-1 text-sm text-[var(--muted-foreground)]">Try another date range or filter. Responses are saved when a persistent tracking run completes.</p>
            </div> :
            <div className="divide-y divide-[var(--border)]">
              {visible.map((row) => {
                const isOpen = expanded === row.id;
                const text = responseText(row);
                return <article key={row.id} className="min-w-0">
                  <button type="button" onClick={() => setExpanded(isOpen ? null : row.id)} className="flex w-full min-w-0 items-start gap-3 p-4 text-left transition hover:bg-[var(--accent)]/50 sm:items-center sm:px-5">
                    <span className="mt-0.5 shrink-0 text-[var(--muted-foreground)]">{isOpen ? <ChevronDown size={17}/> : <ChevronRight size={17}/>}</span>
                    <span className="min-w-0 flex-1">
                      <span className="flex flex-wrap items-center gap-2 text-[11px] text-[var(--muted-foreground)]">
                        <span className="font-semibold text-[var(--primary)]">{providerLabels[row.llm_provider] ?? row.llm_provider}</span>
                        <span>·</span><span>{formatDate(row.captured_at)}</span>
                        {row.tracking_location && <><span>·</span><span>{row.tracking_location}</span></>}
                        <span className={row.response_status === "completed" ? "rounded-full bg-emerald-500/10 px-2 py-0.5 font-semibold text-emerald-700 dark:text-emerald-300" : "rounded-full bg-red-500/10 px-2 py-0.5 font-semibold text-red-700 dark:text-red-300"}>{row.response_status}</span>
                      </span>
                      <span className="mt-1.5 block text-sm font-semibold text-[var(--foreground)]">{row.prompt_snapshot || "Prompt text unavailable"}</span>
                      <span className="mt-1 block line-clamp-2 whitespace-pre-wrap text-xs leading-5 text-[var(--muted-foreground)]">{row.error_message || text || "No text response available. Expand to inspect the raw payload."}</span>
                    </span>
                    <span className="hidden shrink-0 text-xs text-[var(--muted-foreground)] lg:block">{row.run_id ? `Run ${row.run_id.slice(0, 8)}` : "No run ID"}</span>
                  </button>
                  {isOpen && <div className="space-y-4 border-t border-[var(--border)] bg-[var(--soft)]/40 p-4 sm:p-5">
                    <div>
                      <h3 className="text-xs font-bold uppercase tracking-wider text-[var(--muted-foreground)]">Full response</h3>
                      {text ? <pre className="mt-2 whitespace-pre-wrap break-words rounded-xl border border-[var(--border)] bg-[var(--card)] p-4 text-sm leading-6 text-[var(--foreground)]">{text}</pre> : <p className="mt-2 text-sm text-[var(--muted-foreground)]">No extracted response text was stored.</p>}
                    </div>
                    {row.error_message && <div><h3 className="text-xs font-bold uppercase tracking-wider text-[var(--muted-foreground)]">Error</h3><p className="mt-2 rounded-lg border border-red-500/20 bg-red-500/5 p-3 text-sm">{row.error_message}</p></div>}
                    <details className="rounded-xl border border-[var(--border)] bg-[var(--card)]">
                      <summary className="cursor-pointer px-4 py-3 text-sm font-semibold">Raw provider response JSON</summary>
                      <pre className="max-h-[560px] overflow-auto border-t border-[var(--border)] p-4 text-xs leading-5 text-[var(--foreground)]">{JSON.stringify(row.raw_response, null, 2) ?? "null"}</pre>
                    </details>
                    <div className="grid gap-3 text-xs text-[var(--muted-foreground)] sm:grid-cols-2">
                      <p><strong className="text-[var(--foreground)]">Response ID:</strong> {row.id}</p>
                      <p><strong className="text-[var(--foreground)]">Run ID:</strong> {row.run_id ?? "—"}</p>
                      <p><strong className="text-[var(--foreground)]">Brand snapshot:</strong> {row.brand_name_snapshot ?? "—"}</p>
                      <p><strong className="text-[var(--foreground)]">Captured at:</strong> {formatDate(row.captured_at)}</p>
                    </div>
                  </div>}
                </article>;
              })}
            </div>}
          {!loading && filtered.length > PAGE_SIZE && <div className="flex items-center justify-between border-t border-[var(--border)] p-4">
            <span className="text-xs text-[var(--muted-foreground)]">Page {page} of {pageCount}</span>
            <div className="flex gap-2">
              <button type="button" disabled={page <= 1} onClick={() => {setPage((p) => p - 1); setExpanded(null);}} className="platform-btn h-9 disabled:opacity-40">Previous</button>
              <button type="button" disabled={page >= pageCount} onClick={() => {setPage((p) => p + 1); setExpanded(null);}} className="platform-btn h-9 disabled:opacity-40">Next</button>
            </div>
          </div>}
        </section>
      </div>
    </ProjectShell>
  );
}
