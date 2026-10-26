"use client";

import { useEffect, useMemo, useState } from "react";
import { CalendarDays, ExternalLink, RefreshCw, Play, Download } from "lucide-react";
import { useParams } from "next/navigation";
import { ProjectShell } from "@/components/project-shell";
import { MetricChart } from "@/components/metric-chart";
import { supabase } from "@/lib/supabase";
import { MIN_TRACKING_DATE, malaysiaDateString, reportingDateRange, REPORTING_PERIODS } from "@/lib/reporting-date";

type Metric = { metric_date: string; topic: string; visibility_score: number | null; visibility_rank: number | null; rank_population_count: number | null; rank_population_status: string };
type AggregatedCitation = { url: string; page_name: string | null; brand_name: string | null; frequency: number };
type RankSnapshot = Metric & { previousRank: number | null };

const periods = REPORTING_PERIODS;
function dateStart(period: string, customStart: string, customEnd = "") { return reportingDateRange(period, customStart, customEnd).start; }



export default function DashboardPage() {
  const { projectId } = useParams<{ projectId: string }>();
  const [metrics, setMetrics] = useState<Metric[]>([]);
  const [trackingLocation, setTrackingLocation] = useState("MY");
  const [citationsByTopic, setCitationsByTopic] = useState<Record<string, AggregatedCitation[]>>({});
  const [topics, setTopics] = useState<string[]>([]);
  const [period, setPeriod] = useState("Last 7 Days");
  const [customStart, setCustomStart] = useState("");
  const [customEnd, setCustomEnd] = useState(malaysiaDateString());
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [tracking, setTracking] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [canRunTracking, setCanRunTracking] = useState(false);
  const [isSuperadmin, setIsSuperadmin] = useState(false);
  const [trackingMessage, setTrackingMessage] = useState("");
  const [showTopicPicker, setShowTopicPicker] = useState(false);
  const [selectedTopics, setSelectedTopics] = useState<string[]>([]);
  const [resumableBatch, setResumableBatch] = useState<any | null>(null);

  async function load() {
    setLoading(true); setError("");
    const { data: project, error: projectError } = await supabase
      .from("projects")
      .select("topics,tracking_market")
      .eq("id", projectId)
      .single();
    const location = project?.tracking_market ?? "MY";
    const dataLocation = location;
    setTrackingLocation(location);
    const topicList: string[] = Array.isArray(project?.topics)
      ? project.topics.filter((topic: unknown): topic is string => typeof topic === "string")
      : [];
    setTopics(topicList);
    const start = dateStart(period, customStart, customEnd);
    const end = period === "Custom" ? customEnd : malaysiaDateString();
    const { data: chartRows, error: metricsError } = await supabase.from("visibility_daily")
      .select("metric_date,topic,visibility_score,visibility_rank,rank_population_count,rank_population_status")
      .eq("project_id", projectId).eq("llm_provider", "Overall").eq("tracking_location", dataLocation)
      .gte("metric_date", start).lte("metric_date", end).order("metric_date");

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

    const firstError = projectError || metricsError;
    if (firstError) setError(firstError.message || "Unable to load dashboard data.");
    setMetrics(chartRows ?? []); setCitationsByTopic(citations);
    // Rank and population size are persisted together by the tracking pipeline
    // for this exact reporting scope; the UI does not reconstruct either value.
    setLoading(false);
  }

  function openTopicPicker() {
    setSelectedTopics(topics.filter((topic) => topic !== "Overall"));
    setShowTopicPicker(true);
    setError("");
    setTrackingMessage("");
  }

  async function runTracking() {
    const requestedTopics = [...selectedTopics];
    if (!requestedTopics.length && !resumableBatch) {
      setError("Select at least one topic to run tracking.");
      return;
    }
    setTracking(true); setShowTopicPicker(false); setTrackingMessage(""); setError("");
    const outcomes: Array<{ topic: string; status: string; completed: number; total: number; message?: string }> = [];
    let batchId: string | undefined = resumableBatch?.id;
    try {
      if (!batchId) {
        const { data: authData } = await supabase.auth.getUser();
        const { data: batch, error: batchError } = await supabase.from("tracking_batches").insert({
          project_id: projectId, requested_by: authData.user?.id, status: "running",
          topic_order: requestedTopics, started_at: new Date().toISOString(),
        }).select("*").single();
        if (batchError || !batch) throw new Error(batchError?.message || "Unable to create tracking batch.");
        batchId = batch.id;
        const { error: insertTopicsError } = await supabase.from("tracking_batch_topics").insert(requestedTopics.map((topic, ordinal) => ({
          batch_id: batchId, topic, ordinal, status: "queued",
        })));
        if (insertTopicsError) {
          await supabase.from("tracking_batches").update({status:"failed",last_error:insertTopicsError.message,completed_at:new Date().toISOString()}).eq("id",batchId);
          throw new Error(insertTopicsError.message);
        }
      }
      const { data: batchTopics, error: readTopicsError } = await supabase.from("tracking_batch_topics")
        .select("*").eq("batch_id", batchId).order("ordinal");
      if (readTopicsError || !batchTopics?.length) throw new Error(readTopicsError?.message || "No saved batch topics found.");
      const orderedTopics = batchTopics as Array<{id:string;topic:string;status:string;tracking_run_id:string|null;ordinal:number}>;
      for (const item of orderedTopics) {
        const topic = item.topic;
        if (item.status === "completed") {
          outcomes.push({topic,status:"completed",completed:0,total:0});
          continue;
        }
        await supabase.from("tracking_batch_topics").update({
          status:"running",attempt_count:undefined,started_at:new Date().toISOString(),last_error:null,updated_at:new Date().toISOString(),
        }).eq("id",item.id);
        setTrackingMessage("Tracking topic " + (outcomes.length + 1) + " of " + orderedTopics.length + ": " + topic + "…");
        const { data, error } = await supabase.functions.invoke("visibility-tracking", {
          body: {
            mode: "persistent",
            project_id: projectId,
            providers: ["chatgpt"],
            topic,
            ...(!isSuperadmin && item.tracking_run_id ? { tracking_batch_id: item.tracking_run_id } : {}),
          },
        });
        if (error) {
          let message = error.message;
          if (error.context instanceof Response) {
            try { const body = await error.context.clone().json(); message = body?.message || body?.error || message; } catch { /* use SDK message */ }
          }
          await supabase.from("tracking_batch_topics").update({status:"failed",last_error:message,updated_at:new Date().toISOString()}).eq("id",item.id);
          await supabase.from("tracking_batches").update({status:"failed",last_error:message,updated_at:new Date().toISOString()}).eq("id",batchId);
          throw new Error(topic + ": " + message);
        }
        if (data?.error) {
          const message = String(data.message || data.error);
          await supabase.from("tracking_batch_topics").update({status:"failed",last_error:message,updated_at:new Date().toISOString()}).eq("id",item.id);
          await supabase.from("tracking_batches").update({status:"failed",last_error:message,updated_at:new Date().toISOString()}).eq("id",batchId);
          throw new Error(topic + ": " + message);
        }
        const successful = data.status === "completed" && Number(data.failed_prompts ?? 0) === 0 &&
          Number(data.analysis_failures ?? 0) === 0 && Number(data.classification_failures?.length ?? 0) === 0;
        if (!successful) {
          await supabase.from("tracking_batch_topics").update({status:"failed",tracking_run_id:data.run_id ?? null,last_error:data.message || "Topic did not complete successfully.",updated_at:new Date().toISOString()}).eq("id",item.id);
          await supabase.from("tracking_batches").update({status:"failed",last_error:data.message || "Topic did not complete successfully.",updated_at:new Date().toISOString()}).eq("id",batchId);
          outcomes.push({
            topic,
            status: String(data.status ?? "partial"),
            completed: Number(data.completed_prompts ?? 0),
            total: Number(data.total_prompts ?? 0),
            message: data.message || "Topic did not complete successfully.",
          });
          throw new Error(topic + " finished with status " + data.status + ". Remaining topics were not started to avoid masking an incomplete run.");
        }
        await supabase.from("tracking_batch_topics").update({
          status:"completed",tracking_run_id:data.run_id ?? null,completed_at:new Date().toISOString(),last_error:null,updated_at:new Date().toISOString(),
        }).eq("id",item.id);
        outcomes.push({
          topic,
          status: "completed",
          completed: Number(data.completed_prompts ?? 0),
          total: Number(data.total_prompts ?? 0),
        });
      }
      await supabase.from("tracking_batches").update({status:"completed",completed_at:new Date().toISOString(),last_error:null,updated_at:new Date().toISOString()}).eq("id",batchId);
      setResumableBatch(null);
      setTrackingMessage("Tracking completed successfully for " + outcomes.length + " topic(s): " +
        outcomes.map((item) => item.topic + (item.total ? " (" + item.completed + "/" + item.total + " prompts)" : " (already completed)")).join("; ") + ".");
      await load();
    } catch (e) {
      const summary = outcomes.length
        ? " Completed: " + outcomes.map((item) => item.topic).join(", ") + "."
        : "";
      setError((e instanceof Error ? e.message : String(e)) + summary);
      if (batchId) {
        const { data: savedBatch } = await supabase.from("tracking_batches").select("*").eq("id",batchId).maybeSingle();
        if (savedBatch) setResumableBatch(savedBatch);
      }
      await load();
    } finally {
      setTracking(false);
    }
  }

  async function findResumableBatch() {
    const { data } = await supabase.from("tracking_batches").select("*").eq("project_id",projectId)
      .in("status",["queued","running","failed"]).order("created_at",{ascending:false}).limit(1);
    setResumableBatch(data?.[0] ?? null);
  }

  async function exportRawResponses() {
    setExporting(true); setError(""); setTrackingMessage("");
    try {
      const startDate = dateStart(period, customStart, customEnd);
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
        body: JSON.stringify({ project_id: projectId, start_date: startDate, end_date: endDate, tracking_location: trackingLocation }),
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
      if (alive) {
        setIsSuperadmin(profile?.role === "superadmin");
        setCanRunTracking(
          profile?.role === "superadmin" || profile?.role === "admin" ||
          member?.role === "superadmin" || member?.role === "admin"
        );
      }
    }
    void loadPermissions();
    return () => { alive = false; };
  }, [projectId]);

  useEffect(() => { void load(); void findResumableBatch(); }, [projectId, period, customStart, customEnd]);

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
      const previous = rows.find((row) => row.metric_date !== current?.metric_date && row.visibility_rank !== null && (row.rank_population_count ?? 0) > 0);
      if (current) snapshots.set(topic, { ...current, previousRank: previous?.visibility_rank ?? null });
    }
    return snapshots;
  }, [metrics, cardTopics]);

  function chart(topic: string, key: "visibility_score" | "visibility_rank") {
    const rows = metrics.filter((row) => row.topic === topic);
    // Cards and charts both consume the canonical daily metric. Do not hide
    // historical ranks based on a separate direct-competitor RPC.
    return rows.map((row) => ({ label: row.metric_date, value: row[key] }));
  }

  return (
    <ProjectShell>
      <div className="ops-page space-y-8">
        <section>
          <p className="page-eyebrow">Project Overview</p>
          <h2 className="page-title mt-1">Dashboard</h2>
          <p className="page-description mt-2">A live overview of AI visibility performance across answer engines and topics for the selected reporting dataset.</p>
        </section>


        <section className="ops-filter-panel">
          <div className="ops-filter-row">
            <span className="ops-filter-label">Period</span>
            {periods.map((item) => <button key={item} onClick={() => setPeriod(item)} className={"ops-filter-btn " + (period === item ? "is-active" : "")}>{item}</button>)}
            {period === "Custom" && <><label className="sr-only" htmlFor="dashboard-start">Start date</label><input id="dashboard-start" type="date" value={customStart} min={MIN_TRACKING_DATE} max={customEnd} onChange={(event) => setCustomStart(event.target.value)} className="platform-input max-w-[180px] text-xs" /><span className="text-xs font-semibold text-[var(--muted-foreground)]">to</span><label className="sr-only" htmlFor="dashboard-end">End date</label><input id="dashboard-end" type="date" value={customEnd} min={customStart || MIN_TRACKING_DATE} onChange={(event) => setCustomEnd(event.target.value)} className="platform-input max-w-[180px] text-xs" /></>}
          </div>
        </section>

        {showTopicPicker && <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" role="presentation">
          <div role="dialog" aria-modal="true" aria-labelledby="topic-picker-title" className="w-full max-w-xl rounded-2xl border border-[var(--border)] bg-[var(--card)] p-6 shadow-2xl">
            <div className="flex items-start justify-between gap-4">
              <div>
                <p className="page-eyebrow">{isSuperadmin ? "Tracking / Superadmin rerun" : "Tracking"}</p>
                <h3 id="topic-picker-title" className="mt-1 text-xl font-semibold tracking-tight">Select topics to run</h3>
                <p className="mt-2 text-sm text-[var(--muted-foreground)]">Topics are processed one at a time. The next topic starts only after the current topic completes successfully.</p>
              </div>
              <button type="button" onClick={() => setShowTopicPicker(false)} className="platform-btn" aria-label="Close topic picker">Close</button>
            </div>
            <div className="mt-5 flex flex-wrap items-center justify-between gap-2 border-b border-[var(--border)] pb-3">
              <p className="text-sm font-semibold">{selectedTopics.length} of {topics.filter((topic) => topic !== "Overall").length} selected</p>
              <div className="flex gap-2">
                <button type="button" className="platform-btn" onClick={() => setSelectedTopics(topics.filter((topic) => topic !== "Overall"))}>Select all</button>
                <button type="button" className="platform-btn" onClick={() => setSelectedTopics([])}>Clear</button>
              </div>
            </div>
            <div className="mt-3 max-h-72 space-y-1 overflow-y-auto">
              {topics.filter((topic) => topic !== "Overall").map((topic) => <label key={topic} className="flex cursor-pointer items-center gap-3 rounded-lg px-3 py-3 text-sm hover:bg-[var(--soft)]">
                <input type="checkbox" checked={selectedTopics.includes(topic)} onChange={(event) => setSelectedTopics((current) => event.target.checked ? [...current, topic] : current.filter((value) => value !== topic))} className="h-4 w-4 accent-[var(--primary)]" />
                <span className="font-medium">{topic}</span>
              </label>)}
              {!topics.filter((topic) => topic !== "Overall").length && <p className="px-3 py-6 text-sm text-[var(--muted-foreground)]">No topics are configured for this project.</p>}
            </div>
            <div className="mt-5 flex justify-end gap-2 border-t border-[var(--border)] pt-4">
              <button type="button" className="platform-btn" onClick={() => setShowTopicPicker(false)}>Cancel</button>
              <button type="button" className="platform-btn platform-btn-primary disabled:opacity-50" disabled={!selectedTopics.length || tracking} onClick={() => void runTracking()}>
                <Play size={14} /> Run {selectedTopics.length || ""} topic{selectedTopics.length === 1 ? "" : "s"}
              </button>
            </div>
          </div>
        </div>}

        {resumableBatch && canRunTracking && <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-950">
          <div><p className="font-semibold">An interrupted tracking batch can be resumed.</p><p className="mt-1">Completed topics will be skipped and remaining topics continue in saved order.</p></div>
          <button type="button" className="platform-btn platform-btn-primary" disabled={tracking || exporting} onClick={() => {
            setSelectedTopics([]);
            setTracking(true);
            setShowTopicPicker(false);
            void (async () => {
              const { data: rows } = await supabase.from("tracking_batch_topics").select("topic").eq("batch_id",resumableBatch.id).order("ordinal");
              setSelectedTopics((rows ?? []).map((row: {topic:string}) => row.topic));
              // runTracking reads the saved batch directly; state update is deferred, so use the saved batch state.
              await runTracking();
            })();
          }}><Play size={14} /> Resume batch</button>
        </div>}
        {trackingMessage && <div className="rounded-xl border border-green-200 bg-green-50 px-4 py-3 text-sm text-green-800">{trackingMessage}</div>}
        {error && <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>}
        {!loading && metrics.length === 0 && <div className="rounded-xl border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-950">
          <p className="font-semibold">No results are available for the selected period and tracking location.</p>
          <p className="mt-1">Run tracking at the selected location to collect data for this reporting period.</p>
        </div>}


        <section className="space-y-4">
          <div className="flex flex-wrap items-end justify-between gap-3">
            <div><p className="page-eyebrow">Latest Performance</p><h3 className="mt-1 text-xl font-semibold tracking-tight">Visibility Rank</h3><p className="mt-1 text-sm text-[var(--muted-foreground)]">Latest ranking, score and movement within the selected period.</p></div>
            <div className="flex flex-wrap gap-2">{canRunTracking && <button onClick={openTopicPicker} disabled={tracking || exporting || topics.filter((topic) => topic !== "Overall").length === 0} className="platform-btn platform-btn-primary disabled:opacity-50">{tracking ? <RefreshCw size={14} className="animate-spin" /> : <Play size={14} />}{tracking ? "Tracking…" : "Run Tracking"}</button>}<button onClick={exportRawResponses} disabled={exporting || tracking || loading} className="platform-btn disabled:opacity-50">{exporting ? <RefreshCw size={14} className="animate-spin" /> : <Download size={14} />}{exporting ? "Preparing Excel…" : "Export Raw Data"}</button><button onClick={() => void load()} disabled={tracking || exporting} className="platform-btn"><RefreshCw size={14} /> Refresh</button></div>
          </div>
          {trackingMessage && <div className="mb-3 rounded-xl border border-[var(--line)] bg-white px-4 py-3 text-sm text-[var(--green)]">{trackingMessage}</div>}
          {!loading && cardTopics.some((topic) => !(latestByTopic.get(topic)?.rank_population_count && latestByTopic.get(topic)!.rank_population_count! > 0)) && <div className="mb-3 rounded-xl border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-950">Some ranks have no verified eligible population. Legacy ranks with missing run lineage are marked unverified and are not displayed with a fabricated denominator.</div>}
          {loading ? <div className="flex gap-4 overflow-hidden pb-1">{cardTopics.map((topic) => <div key={topic} className="h-40 min-w-[235px] flex-1 animate-pulse rounded-2xl bg-[var(--card)]" />)}</div> :
            <div className="flex gap-4 overflow-x-auto pb-2">
              {cardTopics.map((topic) => {
                const snapshot = latestByTopic.get(topic); const denominator = snapshot?.rank_population_count ?? 0; const currentRank = denominator > 0 ? (snapshot?.visibility_rank ?? null) : null; const previousRank = snapshot?.previousRank ?? null;
                const change = currentRank !== null && previousRank !== null ? previousRank - currentRank : null;
                return <article key={topic} className={"platform-card min-w-[235px] flex-1 p-5 " + (topic === "Overall" ? "platform-card-overall" : "")}>
                  <div className="flex items-center justify-between gap-3"><span className="text-[11px] font-extrabold uppercase tracking-[0.16em] text-[var(--muted-foreground)]">{topic}</span><span className={"rounded-full px-2.5 py-1 text-[10px] font-bold " + (topic === "Overall" ? "platform-overall-pill" : "bg-[var(--soft)] text-[var(--primary)]")}>{snapshot?.metric_date ?? "No data"}</span></div>
                  <div className="mt-4 flex items-end justify-between gap-4"><div><p className="text-[10px] font-bold uppercase tracking-[0.12em] text-[var(--muted-foreground)]">Rank</p><p className={"mt-1 text-4xl font-semibold tracking-tight " + (topic === "Overall" ? "platform-overall-value" : "")}>{currentRank ?? "—"}{currentRank !== null && denominator > 0 ? "/" + denominator : ""}</p>{snapshot?.rank_population_status === "unverified" && snapshot.visibility_rank !== null && <p className="mt-1 text-[10px] font-medium text-amber-700">Historical population unverified</p>}</div><div className="text-right"><p className="text-[10px] font-bold uppercase tracking-[0.12em] text-[var(--muted-foreground)]">Score</p><p className={"mt-1 text-lg font-semibold " + (topic === "Overall" ? "platform-overall-value" : "")}>{snapshot?.visibility_score != null ? snapshot.visibility_score.toFixed(1) + "%" : "—"}</p></div></div>
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