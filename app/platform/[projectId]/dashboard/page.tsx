"use client";

import { useEffect, useMemo, useState } from "react";
import { CalendarDays, ExternalLink, RefreshCw, Play, Download } from "lucide-react";
import { useParams } from "next/navigation";
import { ProjectShell } from "@/components/project-shell";
import { TrackingDataScope } from "@/components/tracking-data-scope";
import { MetricChart } from "@/components/metric-chart";
import { supabase } from "@/lib/supabase";
import { malaysiaDateString, reportingDateRange, REPORTING_PERIODS } from "@/lib/reporting-date";

type Metric = { metric_date: string; topic: string; visibility_score: number | null; visibility_rank: number | null };
type AggregatedCitation = { url: string; page_name: string | null; brand_name: string | null; frequency: number };
type CompetitorCount = { topic: string; metric_date: string; competitor_count: number; visibility_rank: number };
type RankSnapshot = Metric & { previousRank: number | null };

const periods = REPORTING_PERIODS;
function dateStart(period: string, customStart: string, customEnd = "") { return reportingDateRange(period, customStart, customEnd).start; }



export default function DashboardPage() {
  const { projectId } = useParams<{ projectId: string }>();
  const [metrics, setMetrics] = useState<Metric[]>([]);
  const [trackingLocation, setTrackingLocation] = useState("MY");
  const [scope, setScope] = useState<"current" | "legacy">("current");
  const [citationsByTopic, setCitationsByTopic] = useState<Record<string, AggregatedCitation[]>>({});
  const [competitorCounts, setCompetitorCounts] = useState<Record<string, number>>({});
  const [periodRanks, setPeriodRanks] = useState<Record<string, number>>({});
  const [topics, setTopics] = useState<string[]>([]);
  const [period, setPeriod] = useState("Last 7 Days");
  const [customStart, setCustomStart] = useState("");
  const [customEnd, setCustomEnd] = useState(malaysiaDateString());
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [tracking, setTracking] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [canRunTracking, setCanRunTracking] = useState(false);
  const [trackingMessage, setTrackingMessage] = useState("");

  async function load() {
    setLoading(true); setError("");
    const { data: project, error: projectError } = await supabase
      .from("projects")
      .select("topics,tracking_market")
      .eq("id", projectId)
      .single();
    const location = project?.tracking_market ?? "MY";
    const dataLocation = scope === "legacy" ? "LEGACY" : location;
    setTrackingLocation(location);
    const topicList: string[] = Array.isArray(project?.topics)
      ? project.topics.filter((topic: unknown): topic is string => typeof topic === "string")
      : [];
    setTopics(topicList);
    const start = dateStart(period, customStart, customEnd);
    const end = period === "Custom" ? customEnd : malaysiaDateString();
    const [{ data: chartRows, error: metricsError }, { data: competitorRows, error: competitorError }] = await Promise.all([
      supabase.from("visibility_daily").select("metric_date,topic,visibility_score,visibility_rank").eq("project_id", projectId).eq("llm_provider", "Overall").eq("tracking_location", dataLocation).gte("metric_date", start).lte("metric_date", end).order("metric_date"),
      supabase.rpc("get_direct_competitor_metrics_for_period", { p_project_id: projectId, p_start_date: start, p_end_date: end, p_tracking_location: dataLocation }),
    ]);

    // Aggregate citations in Postgres, using the same RPC and brand-related filter as the Citations page.
    // Fetching raw citation rows can silently truncate at the API row limit, leaving later topics blank.
    const citationResults = await Promise.all(
      topicList.filter((topic) => topic !== "Overall").map(async (topic) => {
        const { data, error } = await supabase.rpc("get_cumulative_citations", {
          p_project_id: projectId,
          p_start_date: start,
          p_end_date: end,
          p_topic: topic,
          p_engines: [],
          p_brand_related_only: true,
          p_tracking_location: dataLocation,
        });
        return { topic, data, error };
      })
    );
    const citations: Record<string, AggregatedCitation[]> = {};
    for (const result of citationResults) {
      if (result.error) {
        setError(result.error.message || "Unable to load cited pages for " + result.topic + ".");
      } else {
        citations[result.topic] = ((result.data ?? []) as AggregatedCitation[]).slice(0, 5);
      }
    }

    const firstError = projectError || metricsError || competitorError;
    if (firstError) setError(firstError.message || "Unable to load dashboard data.");
    setMetrics(chartRows ?? []); setCitationsByTopic(citations);
    const counts: Record<string, number> = {};
    const ranks: Record<string, number> = {};
    for (const row of (competitorRows ?? []) as CompetitorCount[]) {
      counts[row.topic] = Number(row.competitor_count) || 0;
      ranks[row.topic] = Number(row.visibility_rank) || 1;
    }
    setCompetitorCounts(counts);
    setPeriodRanks(ranks);
    setLoading(false);
  }

  async function runTracking() {
    setTracking(true); setTrackingMessage(""); setError("");
    try {
      const { data, error } = await supabase.functions.invoke("visibility-tracking", {
        body: { mode: "persistent", project_id: projectId, providers: ["chatgpt"] },
      });
      if (error) {
        let message = error.message;
        if (error.context instanceof Response) {
          try { message = (await error.context.clone().json())?.error || message; } catch { /* use SDK message */ }
        }
        throw new Error(message);
      }
      if (data?.error) throw new Error(data.error);
      setTrackingMessage("Tracking " + data.status + ": " + data.completed_prompts + " of " + data.total_prompts + " prompts completed.");
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally { setTracking(false); }
  }

  async function exportRawResponses() {
    setExporting(true); setError(""); setTrackingMessage("");
    try {
      const startDate = period === "All Time" ? "1900-01-01" : dateStart(period, customStart);
      const endDate = period === "Custom" ? customEnd : malaysiaDateString();
      if (!startDate || !endDate || startDate > endDate) throw new Error("Select a valid date range before exporting.");
      const { data: { session } } = await supabase.auth.getSession();
      if (!session?.access_token) throw new Error("Your session has expired. Please sign in again.");
      const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
      const publishableKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
      if (!supabaseUrl || !publishableKey) throw new Error("Supabase export configuration is missing.");

      const response = await fetch(supabaseUrl.replace(/\/$/, "") + "/functions/v1/export-raw-responses", {
        method: "POST",
        headers: {
          Authorization: "Bearer " + session.access_token,
          apikey: publishableKey,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ project_id: projectId, start_date: startDate, end_date: endDate, tracking_location: scope === "legacy" ? "LEGACY" : trackingLocation }),
      });
      if (!response.ok) {
        let message = "Unable to export raw AI responses.";
        try {
          const body = await response.json();
          message = body?.error || body?.message || message;
        } catch { /* response may not be JSON */ }
        throw new Error(message);
      }
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      const disposition = response.headers.get("content-disposition");
      const filename = disposition?.match(/filename="?([^";]+)"?/i)?.[1] || ("lifewood-raw-responses-" + startDate + "-to-" + endDate + ".xlsx");
      link.href = url;
      link.download = filename;
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.setTimeout(() => URL.revokeObjectURL(url), 1000);
      setTrackingMessage("Excel export prepared for " + startDate + " to " + endDate + ".");
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setExporting(false);
    }
  }

  useEffect(() => {
    let alive = true;
    async function loadPermissions() {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;
      const [{ data: profile }, { data: member }] = await Promise.all([
        supabase.from("profiles").select("role").eq("id", user.id).maybeSingle(),
        supabase.from("project_members").select("role").eq("project_id", projectId).eq("user_id", user.id).maybeSingle(),
      ]);
      if (alive) setCanRunTracking(
        profile?.role === "superadmin" || profile?.role === "admin" ||
        member?.role === "superadmin" || member?.role === "admin"
      );
    }
    void loadPermissions();
    return () => { alive = false; };
  }, [projectId]);

  useEffect(() => { void load(); }, [projectId, period, customStart, customEnd, scope]);

  const cardTopics = useMemo(() => ["Overall", ...topics.filter((topic) => topic !== "Overall")], [topics]);
  const chartDateRange = useMemo(() => {
    const trackedDates = metrics.map((row) => row.metric_date).sort();
    const firstTrackedDate = trackedDates[0];
    const requestedStart = period === "All Time" ? (firstTrackedDate ?? dateStart(period, customStart)) : dateStart(period, customStart);
    return {
      start: firstTrackedDate && firstTrackedDate > requestedStart ? firstTrackedDate : requestedStart,
      end: period === "Custom" ? customEnd : malaysiaDateString(),
    };
  }, [period, customStart, customEnd, metrics]);
  const latestByTopic = useMemo(() => {
    const grouped = new Map<string, Metric[]>();
    for (const row of metrics) grouped.set(row.topic, [...(grouped.get(row.topic) ?? []), row]);
    const snapshots = new Map<string, RankSnapshot>();
    for (const topic of cardTopics) {
      const rows = (grouped.get(topic) ?? []).slice().sort((a, b) => b.metric_date.localeCompare(a.metric_date));
      const current = rows[0];
      const previous = rows.find((row) => row.metric_date !== current?.metric_date && row.visibility_rank !== null);
      if (current) snapshots.set(topic, { ...current, previousRank: previous?.visibility_rank ?? null });
    }
    return snapshots;
  }, [metrics, cardTopics]);

  function chart(topic: string, key: "visibility_score" | "visibility_rank") {
    return metrics.filter((row) => row.topic === topic).map((row) => ({
      label: row.metric_date,
      value: row[key],
    }));
  }

  return (
    <ProjectShell>
      <div className="ops-page space-y-8">
        <section>
          <p className="page-eyebrow">Project Overview</p>
          <h2 className="page-title mt-1">Dashboard</h2>
          <p className="page-description mt-2">A live overview of AI visibility performance across answer engines and topics for the selected reporting dataset.</p>
        </section>

        <TrackingDataScope trackingLocation={trackingLocation} scope={scope} onScopeChange={setScope} />

        <section className="ops-filter-panel">
          <div className="ops-filter-row">
            <span className="ops-filter-label">Period</span>
            {periods.map((item) => <button key={item} onClick={() => setPeriod(item)} className={"ops-filter-btn " + (period === item ? "is-active" : "")}>{item}</button>)}
            {period === "Custom" && <><label className="sr-only" htmlFor="dashboard-start">Start date</label><input id="dashboard-start" type="date" value={customStart} max={customEnd} onChange={(event) => setCustomStart(event.target.value)} className="platform-input max-w-[180px] text-xs" /><span className="text-xs font-semibold text-[var(--muted-foreground)]">to</span><label className="sr-only" htmlFor="dashboard-end">End date</label><input id="dashboard-end" type="date" value={customEnd} min={customStart || undefined} onChange={(event) => setCustomEnd(event.target.value)} className="platform-input max-w-[180px] text-xs" /></>}
          </div>
        </section>

        {trackingMessage && <div className="rounded-xl border border-green-200 bg-green-50 px-4 py-3 text-sm text-green-800">{trackingMessage}</div>}
        {error && <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>}
        {!loading && metrics.length === 0 && <div className="rounded-xl border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-950">
          <p className="font-semibold">{scope === "legacy" ? "No legacy results found for this period." : "No results are available for the current tracking location in this period."}</p>
          <p className="mt-1">{scope === "legacy" ? "Try a wider date range to inspect older location-unknown records." : "Historical location-unknown data is kept separate to protect the accuracy of this report. Run tracking at the selected location to establish or refresh its baseline, or switch to Legacy data to inspect older records."}</p>
        </div>}


        <section className="space-y-4">
          <div className="flex flex-wrap items-end justify-between gap-3">
            <div><p className="page-eyebrow">Latest Performance</p><h3 className="mt-1 text-xl font-semibold tracking-tight">Visibility Rank</h3><p className="mt-1 text-sm text-[var(--muted-foreground)]">Latest ranking, score and movement within the selected period.</p></div>
            <div className="flex flex-wrap gap-2">{canRunTracking && <button onClick={runTracking} disabled={tracking || exporting || scope === "legacy"} title={scope === "legacy" ? "Switch to current location to run tracking." : undefined} className="platform-btn platform-btn-primary disabled:opacity-50">{tracking ? <RefreshCw size={14} className="animate-spin" /> : <Play size={14} />}{tracking ? "Tracking…" : "Run Tracking"}</button>}<button onClick={exportRawResponses} disabled={exporting || tracking || loading} className="platform-btn disabled:opacity-50">{exporting ? <RefreshCw size={14} className="animate-spin" /> : <Download size={14} />}{exporting ? "Preparing Excel…" : "Export Raw Data"}</button><button onClick={() => void load()} disabled={tracking || exporting} className="platform-btn"><RefreshCw size={14} /> Refresh</button></div>
          </div>
          {trackingMessage && <div className="mb-3 rounded-xl border border-[var(--line)] bg-white px-4 py-3 text-sm text-[var(--green)]">{trackingMessage}</div>}
          {!loading && cardTopics.some((topic) => !(competitorCounts[topic] > 0) || competitorCounts[topic] === 1) && <div className="mb-3 rounded-xl border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-950">One or more topics have no classified direct competitors yet. Their rank currently includes only the tracked brand; competitor rankings will become meaningful once direct-competitor observations are available.</div>}
          {loading ? <div className="flex gap-4 overflow-hidden pb-1">{cardTopics.map((topic) => <div key={topic} className="h-40 min-w-[235px] flex-1 animate-pulse rounded-2xl bg-[var(--card)]" />)}</div> :
            <div className="flex gap-4 overflow-x-auto pb-2">
              {cardTopics.map((topic) => {
                const snapshot = latestByTopic.get(topic); const denominator = competitorCounts[topic] ?? 0; const currentRank = denominator > 0 ? (periodRanks[topic] ?? snapshot?.visibility_rank ?? null) : (snapshot?.visibility_rank ?? null); const previousRank = snapshot?.previousRank ?? null;
                const change = currentRank !== null && previousRank !== null ? previousRank - currentRank : null;
                return <article key={topic} className={"platform-card min-w-[235px] flex-1 p-5 " + (topic === "Overall" ? "platform-card-overall" : "")}>
                  <div className="flex items-center justify-between gap-3"><span className="text-[11px] font-extrabold uppercase tracking-[0.16em] text-[var(--muted-foreground)]">{topic}</span><span className={"rounded-full px-2.5 py-1 text-[10px] font-bold " + (topic === "Overall" ? "platform-overall-pill" : "bg-[var(--soft)] text-[var(--primary)]")}>{snapshot?.metric_date ?? "No data"}</span></div>
                  <div className="mt-4 flex items-end justify-between gap-4"><div><p className="text-[10px] font-bold uppercase tracking-[0.12em] text-[var(--muted-foreground)]">Rank</p><p className={"mt-1 text-4xl font-semibold tracking-tight " + (topic === "Overall" ? "platform-overall-value" : "")}>{currentRank ?? "—"}{currentRank !== null && denominator > 0 ? "/" + denominator : ""}</p></div><div className="text-right"><p className="text-[10px] font-bold uppercase tracking-[0.12em] text-[var(--muted-foreground)]">Score</p><p className={"mt-1 text-lg font-semibold " + (topic === "Overall" ? "platform-overall-value" : "")}>{snapshot?.visibility_score != null ? snapshot.visibility_score.toFixed(1) + "%" : "—"}</p></div></div>
                  <div className="mt-4 grid grid-cols-2 gap-3 border-t border-[color-mix(in_srgb,var(--border)_35%,transparent)] pt-3"><div><p className="text-[10px] font-bold uppercase tracking-[0.1em] text-[var(--muted-foreground)]">Previous Rank</p><p className="mt-1 text-sm font-semibold">{previousRank ?? "—"}</p></div><div><p className="text-[10px] font-bold uppercase tracking-[0.1em] text-[var(--muted-foreground)]">Rank Change</p><p className={"mt-1 text-sm font-semibold " + (change === null ? "text-[var(--muted-foreground)]" : change > 0 ? "text-[var(--primary)]" : change < 0 ? "text-[var(--danger)]" : "text-[var(--muted-foreground)]")}>{change === null ? "—" : change > 0 ? "↑ " + change : change < 0 ? "↓ " + Math.abs(change) : "No change"}</p></div></div>
                </article>;
              })}
            </div>}
        </section>

        <section className="space-y-4">
          <div><p className="page-eyebrow">Performance</p><h3 className="mt-1 text-xl font-semibold tracking-tight">Daily Trends</h3><p className="mt-1 text-sm text-[var(--muted-foreground)]">Daily visibility scores and ranks. Gaps indicate dates with no recorded data; values are not interpolated.</p></div>
          <div className="space-y-5">
            {cardTopics.map((topic) => <div key={topic} className="grid min-w-0 gap-5 xl:grid-cols-2"><MetricChart data={chart(topic, "visibility_score")} title={topic + " — Daily Visibility Score"} format="percent" dateRange={chartDateRange} tone={topic === "Overall" ? "overall" : "default"} /><MetricChart data={chart(topic, "visibility_rank")} title={topic + " — Daily Visibility Rank"} invert dateRange={chartDateRange} tone={topic === "Overall" ? "overall" : "default"} /></div>)}
          </div>
        </section>

        <section className="space-y-5">
          <div><p className="page-eyebrow">Citations</p><h3 className="mt-1 text-xl font-semibold tracking-tight">Top Cited Brand Pages</h3><p className="mt-1 text-sm text-[var(--muted-foreground)]">The five most frequently cited tracked-brand pages for each topic in the selected period.</p></div>
          {cardTopics.filter((topic) => topic !== "Overall").map((topic) => {
            const rows = citationsByTopic[topic] ?? [];
            return <div key={topic} className="platform-card p-5 sm:p-6">
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