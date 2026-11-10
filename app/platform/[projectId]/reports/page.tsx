"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { FileText, Loader2 } from "lucide-react";
import { ProjectShell } from "@/components/project-shell";
import { startReport } from "@/components/report/start-report";
import { supabase } from "@/lib/supabase";
import { MIN_TRACKING_DATE, malaysiaDateString } from "@/lib/reporting-date";
import { periodFromChoice, type PeriodChoice } from "@/lib/report-data";
import { effectiveStatus, fmtDate, fmtScore, rating, type Tone } from "@/lib/report-view";
import { trackingLocationLabel } from "@/lib/tracking-locations";
import type { ReportStatus } from "@/lib/report-types";
import { canEditProject } from "@/lib/report-view";

type ReportListRow = {
  id: string;
  created_at: string;
  updated_at: string;
  period_label: string | null;
  period_start: string;
  period_end: string;
  status: ReportStatus;
  ai_visibility_score: number | null;
  geo_score: number | null;
  seo_score: number | null;
  error: string | null;
};

const PERIODS: PeriodChoice[] = ["Last 7 Days", "Last 30 Days", "Last 90 Days", "Custom"];

const toneClass: Record<Tone, string> = {
  good: "bg-emerald-50 text-emerald-800 border-emerald-200",
  fair: "bg-amber-50 text-amber-900 border-amber-200",
  poor: "bg-rose-50 text-rose-800 border-rose-200",
};

const statusText: Record<ReportStatus, string> = { queued: "Queued", running: "Generating…", completed: "Ready", failed: "Failed" };

function ScoreChip({ label, score }: { label: string; score: number | null }) {
  const r = rating(score);
  return <span className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-semibold ${toneClass[r.tone]}`}>
    {label} <span className="tabular-nums">{fmtScore(score, 0)}</span>
  </span>;
}

export default function ReportsPage() {
  const { projectId } = useParams<{ projectId: string }>();
  const router = useRouter();
  const [reports, setReports] = useState<ReportListRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [canGenerate, setCanGenerate] = useState(false);
  const [location, setLocation] = useState("");
  const [choice, setChoice] = useState<PeriodChoice>("Last 30 Days");
  const [customStart, setCustomStart] = useState("");
  const [customEnd, setCustomEnd] = useState(malaysiaDateString());
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    let alive = true;
    async function load() {
      setLoading(true);
      const { data: { user } } = await supabase.auth.getUser();
      const [list, project, profile, member] = await Promise.all([
        supabase.from("audit_reports")
          .select("id,created_at,updated_at,period_label,period_start,period_end,status,ai_visibility_score,geo_score,seo_score,error")
          .eq("project_id", projectId).order("created_at", { ascending: false }),
        supabase.from("projects").select("tracking_market,created_by").eq("id", projectId).maybeSingle(),
        user ? supabase.from("profiles").select("role").eq("id", user.id).maybeSingle() : Promise.resolve({ data: null }),
        user ? supabase.from("project_members").select("role").eq("project_id", projectId).eq("user_id", user.id).maybeSingle() : Promise.resolve({ data: null }),
      ]);
      if (!alive) return;
      if (list.error) setError(list.error.message);
      setReports((list.data ?? []) as ReportListRow[]);
      setLocation(project.data?.tracking_market ?? "MY");
      setCanGenerate(canEditProject(profile.data?.role, member.data?.role, project.data?.created_by === user?.id));
      setLoading(false);
    }
    void load();
    return () => { alive = false; };
  }, [projectId]);

  async function generate() {
    setError("");
    try {
      const period = periodFromChoice(choice, customStart, customEnd);
      const reportId = await startReport(projectId, period, setBusy);
      router.push(`/platform/${projectId}/reports/${reportId}`);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "The report could not be started. Try again.");
      setBusy("");
    }
  }

  return <ProjectShell><div className="ops-page">
    <p className="page-eyebrow">Client deliverables</p>
    <h2 className="page-title mt-1">Reports</h2>
    <p className="page-description mt-2">Client-ready AI visibility, GEO and SEO audit reports. Each report combines this project&apos;s tracking data with a fresh audit of the brand&apos;s website and its top competitors. Reports are saved here, can be edited before sharing, and download as a PDF.</p>

    {canGenerate && <section className="mt-8 platform-card p-6">
      <h3 className="text-lg font-semibold">Generate a report</h3>
      <p className="mt-1 text-sm text-[var(--muted-foreground)]">Takes about one to two minutes. You can leave this page; the report keeps generating.</p>
      <div className="mt-5 flex flex-wrap items-end gap-4">
        <div>
          <span className="ops-filter-label">Period</span>
          <div className="mt-2 flex flex-wrap gap-2">
            {PERIODS.map((value) => <button key={value} type="button" onClick={() => setChoice(value)} className={`ops-filter-btn ${choice === value ? "is-active" : ""}`}>{value}</button>)}
          </div>
        </div>
        {choice === "Custom" && <div className="flex items-center gap-2">
          <label className="sr-only" htmlFor="report-start">Start date</label>
          <input id="report-start" type="date" value={customStart} min={MIN_TRACKING_DATE} max={customEnd} onChange={(e) => setCustomStart(e.target.value)} className="platform-input max-w-[180px] text-xs" />
          <span className="text-xs font-semibold text-[var(--muted-foreground)]">to</span>
          <label className="sr-only" htmlFor="report-end">End date</label>
          <input id="report-end" type="date" value={customEnd} min={customStart || MIN_TRACKING_DATE} onChange={(e) => setCustomEnd(e.target.value)} className="platform-input max-w-[180px] text-xs" />
        </div>}
        <div>
          <span className="ops-filter-label">Location</span>
          <p className="mt-2 text-sm font-medium">{location ? trackingLocationLabel(location) : "—"}</p>
        </div>
        <button type="button" onClick={generate} disabled={Boolean(busy)} className="platform-btn platform-btn-primary ml-auto">
          {busy ? <><Loader2 size={16} className="animate-spin" /> {busy}</> : <><FileText size={16} /> Generate report</>}
        </button>
      </div>
    </section>}

    {error && <div role="alert" className="mt-5 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>}

    <section className="mt-6 platform-card p-6">
      <h3 className="text-lg font-semibold">Saved reports</h3>
      {loading ? <p className="mt-4 text-sm text-[var(--muted-foreground)]">Loading…</p>
        : !reports.length ? <p className="mt-4 text-sm text-[var(--muted-foreground)]">No reports yet.{canGenerate ? " Generate the first one above." : ""}</p>
        : <div className="mt-4 overflow-x-auto"><table className="platform-table min-w-[760px]">
          <thead><tr><th className="text-left">Created</th><th className="text-left">Period</th><th className="text-left">Scores</th><th className="text-left">Status</th><th /></tr></thead>
          <tbody>{reports.map((report) => {
            const status = effectiveStatus(report);
            return <tr key={report.id}>
              <td>{fmtDate(report.created_at)}</td>
              <td>{report.period_label ?? "Custom"}<div className="text-xs text-[var(--muted-foreground)]">{fmtDate(report.period_start)} – {fmtDate(report.period_end)}</div></td>
              <td>{status === "completed"
                ? <div className="flex flex-wrap gap-1.5"><ScoreChip label="AI visibility" score={report.ai_visibility_score} /><ScoreChip label="GEO" score={report.geo_score} /><ScoreChip label="SEO" score={report.seo_score} /></div>
                : <span className="text-xs text-[var(--muted-foreground)]">—</span>}</td>
              <td className={status === "failed" ? "text-rose-700" : ""}>{statusText[status]}</td>
              <td className="text-right"><Link href={`/platform/${projectId}/reports/${report.id}`} className="platform-btn">Open</Link></td>
            </tr>;
          })}</tbody>
        </table></div>}
    </section>
  </div></ProjectShell>;
}
