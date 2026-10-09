"use client";

import { useEffect, useMemo, useState } from "react";
import { CalendarDays, ExternalLink, RefreshCw, Play } from "lucide-react";
import { useParams } from "next/navigation";
import { ProjectShell } from "@/components/project-shell";
import { MetricChart } from "@/components/metric-chart";
import { supabase } from "@/lib/supabase";

type Metric = { metric_date: string; topic: string; visibility_score: number | null; visibility_rank: number | null };
type Citation = { metric_date: string; topic: string | null; url: string; page_name: string | null; brand_name: string | null; is_brand_related: boolean; frequency: number };
type RankSnapshot = Metric & { previousRank: number | null };

const periods = ["Today", "Last 2 days", "Last 7 Days", "Last 14 Days", "Last 30 Days", "Last 90 Days", "All Time", "Custom"];

function malaysiaDateString(date = new Date()) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Kuala_Lumpur",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const year = parts.find((part) => part.type === "year")?.value;
  const month = parts.find((part) => part.type === "month")?.value;
  const day = parts.find((part) => part.type === "day")?.value;
  return `${year}-${month}-${day}`;
}

function dateStart(period: string, customStart: string) {
  if (period === "Custom") return customStart || new Date().toISOString().slice(0, 10);
  const d = new Date(); d.setHours(0, 0, 0, 0);
  const days = period === "Today" ? 0 : period === "Last 2 days" ? 1 : period === "Last 7 Days" ? 6 : period === "Last 14 Days" ? 13 : period === "Last 30 Days" ? 29 : period === "Last 90 Days" ? 89 : 3650;
  d.setDate(d.getDate() - days);
  return d.toISOString().slice(0, 10);
}

function aggregateCitations(rows: Citation[], topic: string) {
  const map = new Map<string, { url: string; page_name: string | null; brand_name: string | null; frequency: number }>();
  for (const row of rows) {
    if (!row.is_brand_related || (row.topic ?? "Overall") !== topic) continue;
    const old = map.get(row.url);
    map.set(row.url, { url: row.url, page_name: row.page_name, brand_name: row.brand_name, frequency: (old?.frequency ?? 0) + row.frequency });
  }
  return [...map.values()].sort((a, b) => b.frequency - a.frequency).slice(0, 5);
}

export default function DashboardPage() {
  const { projectId } = useParams<{ projectId: string }>();
  const [metrics, setMetrics] = useState<Metric[]>([]);
  const [latestMetrics, setLatestMetrics] = useState<Metric[]>([]);
  const [citations, setCitations] = useState<Citation[]>([]);
  const [topics, setTopics] = useState<string[]>([]);
  const [period, setPeriod] = useState("Last 7 Days");
  const [customStart, setCustomStart] = useState("");
  const [customEnd, setCustomEnd] = useState(new Date().toISOString().slice(0, 10));
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [tracking, setTracking] = useState(false);
  const [canRunTracking, setCanRunTracking] = useState(false);
  const [dailyRunClaimed, setDailyRunClaimed] = useState(false);
  const [trackingMessage, setTrackingMessage] = useState("");

  async function load() {
    setLoading(true); setError("");
    const { data: project, error: projectError } = await supabase.from("projects").select("topics").eq("id", projectId).single();
    const topicList = project?.topics ?? []; setTopics(topicList);
    const start = dateStart(period, customStart);
    const end = period === "Custom" ? customEnd : new Date().toISOString().slice(0, 10);
    const [{ data: chartRows, error: metricsError }, { data: latestRows, error: latestError }, { data: citationRows, error: citationsError }] = await Promise.all([
      supabase.from("visibility_daily").select("metric_date,topic,visibility_score,visibility_rank").eq("project_id", projectId).eq("llm_provider", "Overall").gte("metric_date", start).lte("metric_date", end).order("metric_date"),
      supabase.from("visibility_daily").select("metric_date,topic,visibility_score,visibility_rank").eq("project_id", projectId).eq("llm_provider", "Overall").order("metric_date", { ascending: false }).limit(500),
      supabase.from("citations").select("metric_date,topic,url,page_name,brand_name,is_brand_related,frequency").eq("project_id", projectId).gte("metric_date", start).lte("metric_date", end),
    ]);
    const firstError = projectError || metricsError || latestError || citationsError;
    if (firstError) setError(firstError.message || "Unable to load dashboard data.");
    setMetrics(chartRows ?? []); setLatestMetrics(latestRows ?? []); setCitations(citationRows ?? []); setLoading(false);
  }

  async function runTracking() {
    setTracking(true); setTrackingMessage(""); setError("");
    try {
      const { data, error } = await supabase.functions.invoke("visibility-tracking", {
        body: { mode: "persistent", project_id: projectId, providers: ["chatgpt"] },
      });
      if (error) {
        let message = error.message;
        let payload: Record<string, unknown> | null = null;
        if (error.context instanceof Response) {
          try {
            payload = await error.context.clone().json();
            message = String(payload?.message || payload?.error || message);
          } catch { /* use SDK message */ }
        }
        if (payload?.error === "DAILY_TRACKING_LIMIT_REACHED") {
          setDailyRunClaimed(true);
          setTrackingMessage(message);
          return;
        }
        throw new Error(message);
      }
      if (data?.error) throw new Error(data.message || data.error);
      setDailyRunClaimed(true);
      setTrackingMessage(`Today's full run finished: ${data.completed_prompts} of ${data.total_prompts} prompts completed (${data.status}). Another full run is available after midnight MYT.`);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally { setTracking(false); }
  }

  useEffect(() => {
    let alive = true;
    async function loadPermissions() {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;
      const [{ data: profile }, { data: member }, { data: dailyClaim }] = await Promise.all([
        supabase.from("profiles").select("role").eq("id", user.id).maybeSingle(),
        supabase.from("project_members").select("role").eq("project_id", projectId).eq("user_id", user.id).maybeSingle(),
        supabase.from("tracking_run_daily_claims").select("run_date").eq("project_id", projectId).eq("run_date", malaysiaDateString()).maybeSingle(),
      ]);
      if (alive) {
        setCanRunTracking(
          profile?.role === "superadmin" || profile?.role === "admin" ||
          member?.role === "superadmin" || member?.role === "admin"
        );
        setDailyRunClaimed(Boolean(dailyClaim));
      }
    }
    void loadPermissions();
    return () => { alive = false; };
  }, [projectId]);

  useEffect(() => { void load(); }, [projectId, period, customStart, customEnd]);

  const cardTopics = useMemo(() => ["Overall", ...topics.filter((topic) => topic !== "Overall")], [topics]);
  const latestByTopic = useMemo(() => {
    const grouped = new Map<string, Metric[]>();
    for (const row of latestMetrics) grouped.set(row.topic, [...(grouped.get(row.topic) ?? []), row]);
    const snapshots = new Map<string, RankSnapshot>();
    for (const topic of cardTopics) {
      const rows = grouped.get(topic) ?? []; const current = rows[0];
      const previous = rows.find((row) => row.metric_date !== current?.metric_date && row.visibility_rank !== null);
      if (current) snapshots.set(topic, { ...current, previousRank: previous?.visibility_rank ?? null });
    }
    return snapshots;
  }, [latestMetrics, cardTopics]);

  function chart(topic: string, key: "visibility_score" | "visibility_rank") {
    return metrics.filter((row) => row.topic === topic).map((row) => ({
      label: new Date(row.metric_date + "T00:00:00").toLocaleDateString(undefined, { month: "short", day: "numeric" }),
      value: row[key],
    }));
  }

  return (
    <ProjectShell>
      <div className="ops-page space-y-8">
        <section>
          <p className="page-eyebrow">Project Overview</p>
          <h2 className="page-title mt-1">Dashboard</h2>
          <p className="page-description mt-2">A live overview of AI visibility performance across tracked answer engines and topics.</p>
        </section>

        <section className="ops-filter-panel">
          <div className="ops-filter-row">
            <span className="ops-filter-label">Period</span>
            {periods.map((item) => <button key={item} onClick={() => setPeriod(item)} className={"ops-filter-btn " + (period === item ? "is-active" : "")}>{item}</button>)}
            {period === "Custom" && <><label className="sr-only" htmlFor="dashboard-start">Start date</label><input id="dashboard-start" type="date" value={customStart} max={customEnd} onChange={(event) => setCustomStart(event.target.value)} className="platform-input max-w-[180px] text-xs" /><span className="text-xs font-semibold text-[var(--muted-foreground)]">to</span><label className="sr-only" htmlFor="dashboard-end">End date</label><input id="dashboard-end" type="date" value={customEnd} min={customStart || undefined} onChange={(event) => setCustomEnd(event.target.value)} className="platform-input max-w-[180px] text-xs" /></>}
          </div>
        </section>

        {trackingMessage && <div className="rounded-xl border border-green-200 bg-green-50 px-4 py-3 text-sm text-green-800">{trackingMessage}</div>}
        {error && <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>}

        <section className="space-y-4">
          <div className="flex flex-wrap items-end justify-between gap-3">
            <div><p className="page-eyebrow">Latest Performance</p><h3 className="mt-1 text-xl font-semibold tracking-tight">Visibility Rank</h3><p className="mt-1 text-sm text-[var(--muted-foreground)]">Latest ranking, score and movement for every tracked topic.</p></div>
            <div className="flex flex-wrap gap-2">{canRunTracking && <button onClick={runTracking} disabled={tracking} className="platform-btn platform-btn-primary disabled:opacity-50">{tracking ? <RefreshCw size={14} className="animate-spin" /> : <Play size={14} />}{tracking ? "Tracking…" : "Run Tracking"}</button>}<button onClick={() => void load()} disabled={tracking} className="platform-btn"><RefreshCw size={14} /> Refresh</button></div>
          </div>
          {loading ? <div className="flex gap-4 overflow-hidden pb-1">{cardTopics.map((topic) => <div key={topic} className="h-40 min-w-[235px] flex-1 animate-pulse rounded-2xl bg-[var(--card)]" />)}</div> :
            <div className="flex gap-4 overflow-x-auto pb-2">
              {cardTopics.map((topic) => {
                const snapshot = latestByTopic.get(topic); const currentRank = snapshot?.visibility_rank ?? null; const previousRank = snapshot?.previousRank ?? null;
                const change = currentRank !== null && previousRank !== null ? previousRank - currentRank : null;
                return <article key={topic} className="ops-card min-w-[235px] flex-1 p-5 xl:min-w-0">
                  <div className="flex items-center justify-between gap-3"><span className="text-[11px] font-extrabold uppercase tracking-[0.16em] text-[var(--muted-foreground)]">{topic}</span><span className="rounded-full bg-[var(--soft)] px-2.5 py-1 text-[10px] font-bold text-[var(--primary)]">Latest</span></div>
                  <div className="mt-4 flex items-end justify-between gap-4"><div><p className="text-[10px] font-bold uppercase tracking-[0.12em] text-[var(--muted-foreground)]">Rank</p><p className="mt-1 text-4xl font-semibold tracking-tight">{currentRank ?? "—"}</p></div><div className="text-right"><p className="text-[10px] font-bold uppercase tracking-[0.12em] text-[var(--muted-foreground)]">Score</p><p className="mt-1 text-lg font-semibold">{snapshot?.visibility_score != null ? snapshot.visibility_score.toFixed(1) + "%" : "—"}</p></div></div>
                  <div className="mt-4 grid grid-cols-2 gap-3 border-t border-[color-mix(in_srgb,var(--border)_35%,transparent)] pt-3"><div><p className="text-[10px] font-bold uppercase tracking-[0.1em] text-[var(--muted-foreground)]">Previous Rank</p><p className="mt-1 text-sm font-semibold">{previousRank ?? "—"}</p></div><div><p className="text-[10px] font-bold uppercase tracking-[0.1em] text-[var(--muted-foreground)]">Rank Change</p><p className={"mt-1 text-sm font-semibold " + (change === null ? "text-[var(--muted-foreground)]" : change > 0 ? "text-[var(--primary)]" : change < 0 ? "text-[var(--danger)]" : "text-[var(--muted-foreground)]")}>{change === null ? "—" : change > 0 ? "↑ " + change : change < 0 ? "↓ " + Math.abs(change) : "No change"}</p></div></div>
                </article>;
              })}
            </div>}
        </section>

        <section className="space-y-4">
          <div><p className="page-eyebrow">Performance</p><h3 className="mt-1 text-xl font-semibold tracking-tight">Daily Trends</h3><p className="mt-1 text-sm text-[var(--muted-foreground)]">Daily visibility score and ranking across the selected period.</p></div>
          <div className="space-y-5">
            {cardTopics.map((topic) => <div key={topic} className="grid min-w-0 gap-5 xl:grid-cols-2"><MetricChart data={chart(topic, "visibility_score")} title={topic + " — Daily Visibility Score"} format="percent" /><MetricChart data={chart(topic, "visibility_rank")} title={topic + " — Daily Visibility Rank"} invert /></div>)}
          </div>
        </section>

        <section className="space-y-5">
          <div><p className="page-eyebrow">Citations</p><h3 className="mt-1 text-xl font-semibold tracking-tight">Top Cited Brand Pages</h3><p className="mt-1 text-sm text-[var(--muted-foreground)]">The five most frequently cited tracked-brand pages for each topic in the selected period.</p></div>
          {cardTopics.map((topic) => {
            const rows = aggregateCitations(citations, topic);
            return <div key={topic} className="ops-card p-5 sm:p-6">
              <div className="flex items-center gap-2"><span className="inline-flex h-8 w-8 items-center justify-center rounded-lg bg-[var(--soft)] text-[var(--primary)]"><CalendarDays size={16} /></span><h4 className="text-base font-semibold">{topic}</h4></div>
              <div className="mt-4 overflow-x-auto"><table className="platform-table min-w-[760px]"><thead><tr><th>No.</th><th>Page</th><th>Page Name</th><th>Brand Name</th><th>Frequency</th></tr></thead><tbody>
                {rows.map((row, index) => <tr key={row.url}><td>{index + 1}</td><td className="max-w-[380px]"><a href={row.url} target="_blank" rel="noreferrer" className="inline-flex max-w-[360px] items-center gap-1 truncate font-semibold text-[var(--green)] hover:underline">{row.url}<ExternalLink size={13} /></a></td><td>{row.page_name || "—"}</td><td>{row.brand_name || "—"}</td><td className="font-semibold">{row.frequency}</td></tr>)}
                {!rows.length && <tr><td colSpan={5} className="py-8 text-center text-sm text-[var(--muted-foreground)]">No citations recorded for this topic and period.</td></tr>}
              </tbody></table></div>
            </div>;
          })}
        </section>
      </div>
    </ProjectShell>
  );
}