"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { ArrowLeft, Check, Download, Loader2, RotateCcw } from "lucide-react";
import { ProjectShell } from "@/components/project-shell";
import { startReport } from "@/components/report/start-report";
import {
  AiVisibilityPage, CompetitorBenchmarkPage, CompetitorChartsPage, CoverPage, CurrentPositionPage, ExecutiveSummaryPage,
  GapsAndCitationsPage, GeoAuditPage, MethodologyPage, SeoAuditPage, TargetsPage, ThankYouPage, type ReportView,
} from "@/components/report/sections";
import { supabase } from "@/lib/supabase";
import { effectiveStatus, STEP_LABELS, STEP_ORDER } from "@/lib/report-view";
import type { AuditReportRow, ReportEdits } from "@/lib/report-types";

const POLL_MS = 3000;

function Progress({ step }: { step: string | null }) {
  const current = Math.max(0, STEP_ORDER.indexOf((step ?? "crawling") as (typeof STEP_ORDER)[number]));
  return <section className="platform-card mt-6 max-w-xl p-6">
    <h3 className="text-lg font-semibold">Generating the report</h3>
    <p className="mt-1 text-sm text-[var(--muted-foreground)]">This usually takes one to two minutes. You can leave this page and come back.</p>
    <ol className="mt-5 space-y-3">{STEP_ORDER.map((key, i) => <li key={key} className="flex items-center gap-3 text-sm">
      {i < current ? <Check size={16} className="text-emerald-700" aria-label="Done" />
        : i === current ? <Loader2 size={16} className="animate-spin text-[var(--primary)]" aria-label="In progress" />
        : <span className="inline-block h-4 w-4 rounded-full border border-[var(--line)]" aria-label="Pending" />}
      <span className={i > current ? "text-[var(--muted-foreground)]" : "font-medium"}>{STEP_LABELS[key]}</span>
    </li>)}</ol>
  </section>;
}

export default function ReportPage() {
  const { projectId, reportId } = useParams<{ projectId: string; reportId: string }>();
  const router = useRouter();
  const [row, setRow] = useState<AuditReportRow | null>(null);
  const [brand, setBrand] = useState<{ name: string; logoUrl: string | null }>({ name: "", logoUrl: null });
  const [canEdit, setCanEdit] = useState(false);
  const [error, setError] = useState("");
  const [saveError, setSaveError] = useState("");
  const [retrying, setRetrying] = useState("");

  const load = useCallback(async () => {
    const { data, error: loadError } = await supabase.from("audit_reports").select("*").eq("id", reportId).maybeSingle();
    if (loadError) { setError(loadError.message); return null; }
    if (!data) { setError("This report was not found."); return null; }
    setRow({ ...(data as AuditReportRow), edits: (data as AuditReportRow).edits ?? {} });
    return data as AuditReportRow;
  }, [reportId]);

  useEffect(() => {
    let alive = true;
    void (async () => {
      const { data: { user } } = await supabase.auth.getUser();
      const [project, profile, member] = await Promise.all([
        supabase.from("projects").select("brand_name,brand_logo_url").eq("id", projectId).maybeSingle(),
        user ? supabase.from("profiles").select("role").eq("id", user.id).maybeSingle() : Promise.resolve({ data: null }),
        user ? supabase.from("project_members").select("role").eq("project_id", projectId).eq("user_id", user.id).maybeSingle() : Promise.resolve({ data: null }),
      ]);
      if (!alive) return;
      setBrand({ name: project.data?.brand_name ?? "", logoUrl: project.data?.brand_logo_url ?? null });
      const roles = [profile.data?.role, member.data?.role];
      setCanEdit(roles.includes("admin") || roles.includes("superadmin"));
    })();
    return () => { alive = false; };
  }, [projectId]);

  useEffect(() => {
    let alive = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const tick = async () => {
      const latest = await load();
      if (!alive || !latest) return;
      const status = effectiveStatus(latest);
      if (status === "queued" || status === "running") timer = setTimeout(tick, POLL_MS);
    };
    void tick();
    return () => { alive = false; if (timer) clearTimeout(timer); };
  }, [load]);

  const saveEdits = useCallback(async (next: ReportEdits) => {
    setSaveError("");
    setRow((current) => (current ? { ...current, edits: next } : current));
    const { error: updateError } = await supabase.from("audit_reports").update({ edits: next }).eq("id", reportId);
    if (updateError) setSaveError("Your change could not be saved: " + updateError.message);
  }, [reportId]);

  async function retry() {
    if (!row) return;
    setError("");
    try {
      const id = await startReport(projectId, { label: row.period_label ?? "Custom", start: row.period_start, end: row.period_end }, setRetrying);
      router.push(`/platform/${projectId}/reports/${id}`);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "The report could not be started.");
      setRetrying("");
    }
  }

  const status = row ? effectiveStatus(row) : null;
  const ready = row && status === "completed" && row.visibility_snapshot && row.audit;
  const view: ReportView | null = ready ? {
    row, snapshot: row.visibility_snapshot!, audit: row.audit!, narrative: row.narrative, edits: row.edits ?? {},
    brand: { name: brand.name || row.visibility_snapshot!.brand.name, logoUrl: brand.logoUrl }, canEdit, saveEdits,
  } : null;

  return <ProjectShell><div className="ops-page">
    <div className="report-toolbar flex flex-wrap items-center justify-between gap-3">
      <Link href={`/platform/${projectId}/reports`} className="platform-btn"><ArrowLeft size={16} /> Back to reports</Link>
      {view && <button type="button" className="platform-btn platform-btn-primary" onClick={() => window.print()}><Download size={16} /> Download PDF</button>}
    </div>
    {error && <div role="alert" className="report-toolbar mt-5 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>}
    {saveError && <div role="alert" className="report-toolbar mt-5 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{saveError}</div>}
    {!row && !error && <p className="mt-6 text-sm text-[var(--muted-foreground)]">Loading…</p>}
    {row && (status === "queued" || status === "running") && <Progress step={row.step} />}
    {row && status === "failed" && <section className="platform-card mt-6 max-w-xl p-6">
      <h3 className="text-lg font-semibold">The report could not be generated</h3>
      <p className="mt-2 text-sm text-[var(--muted-foreground)]">{row.status === "failed" ? (row.error ?? "Something went wrong.") : "The report stopped making progress."}</p>
      {canEdit && <button type="button" onClick={retry} disabled={Boolean(retrying)} className="platform-btn platform-btn-primary mt-4">
        {retrying ? <><Loader2 size={16} className="animate-spin" /> {retrying}</> : <><RotateCcw size={16} /> Retry</>}
      </button>}
    </section>}
    {view && <>
      {canEdit && <p className="report-toolbar mt-4 text-xs text-[var(--muted-foreground)]">Click the pencil next to any text, domain authority or target to edit it before downloading. Edits are saved for everyone.</p>}
      {view.narrative?.fallback && <div className="report-toolbar mt-4 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">This report lists the measured findings without AI-written text. {view.audit.notices.join(" ")}</div>}
      <div className="report-document mt-6">
        <CoverPage view={view} />
        <ExecutiveSummaryPage view={view} />
        <CompetitorBenchmarkPage view={view} />
        <CompetitorChartsPage view={view} />
        <AiVisibilityPage view={view} />
        <GapsAndCitationsPage view={view} />
        <GeoAuditPage view={view} />
        <SeoAuditPage view={view} />
        <CurrentPositionPage view={view} />
        <TargetsPage view={view} />
        <MethodologyPage view={view} />
        <ThankYouPage view={view} />
      </div>
    </>}
  </div></ProjectShell>;
}
