"use client";

import { useCallback, useEffect, useState } from "react";
import { RefreshCw } from "lucide-react";
import { supabase } from "@/lib/supabase";

type Job = {
  id: string;
  status: "queued" | "running" | "completed" | "failed";
  reason: string;
  requested_at: string;
  completed_at: string | null;
  error_message: string | null;
  summary: { competitors?: number; overall_days?: number; units_finalized?: number; slices_backfilled?: number; units_blocked?: unknown[] } | null;
};

function when(value: string | null) {
  return value ? new Date(value).toLocaleString() : "—";
}

/** Shows whether historical competitor statistics are current for the saved competitor list. */
export function CompetitorRecomputeStatus({ projectId, canRequest }: { projectId: string; canRequest: boolean }) {
  const [job, setJob] = useState<Job | null>(null);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const { data } = await supabase.from("competitor_recompute_jobs")
      .select("id,status,reason,requested_at,completed_at,error_message,summary")
      .eq("project_id", projectId).order("requested_at", { ascending: false }).limit(1);
    setJob((data?.[0] as Job | undefined) ?? null);
  }, [projectId]);

  useEffect(() => {
    void load();
    const timer = window.setInterval(() => { void load(); }, 10000);
    return () => window.clearInterval(timer);
  }, [load]);

  async function request() {
    setBusy(true); setMessage("");
    const { error } = await supabase.rpc("request_competitor_recompute", { p_project_id: projectId });
    if (error) setMessage(error.message); else setMessage("Recalculation queued. It starts within about a minute.");
    setBusy(false);
    void load();
  }

  const active = job?.status === "queued" || job?.status === "running";
  return (
    <div className="mt-4 rounded-xl border border-[var(--line)] bg-[var(--card)] px-4 py-3 text-xs">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="font-semibold">Historical competitor statistics</p>
          <p className="mt-1 text-[var(--muted-foreground)]">
            When the competitor list changes, visibility, rank and citation statistics are recalculated for every tracked day from the stored raw responses.
          </p>
        </div>
        {canRequest && (
          <button type="button" onClick={() => void request()} disabled={busy || active} className="inline-flex items-center gap-2 platform-btn text-xs disabled:opacity-50">
            <RefreshCw size={14} className={active ? "animate-spin" : ""} />Recalculate now
          </button>
        )}
      </div>
      <p className={"mt-2 font-medium " + (job?.status === "failed" ? "text-red-700" : active ? "text-amber-700" : "text-emerald-700")}>
        {!job && "No recalculation has run for this project yet."}
        {job?.status === "queued" && "Queued " + when(job.requested_at) + " — waiting for the next run."}
        {job?.status === "running" && "Recalculating since " + when(job.requested_at) + "…"}
        {job?.status === "completed" && "Up to date — last recalculated " + when(job.completed_at) +
          (job.summary?.competitors != null ? " (" + job.summary.competitors + " competitors, " + (job.summary.units_finalized ?? 0) + " topic-days)" : "") + "."}
        {job?.status === "failed" && "Last recalculation failed: " + (job.error_message ?? "unknown error") + ". Use Recalculate now to retry."}
      </p>
      {message && <p className="mt-1 text-[var(--muted-foreground)]">{message}</p>}
    </div>
  );
}
