"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useParams } from "next/navigation";
import { Download, FileText, Loader2, Plus, Save, Sparkles } from "lucide-react";
import { ProjectShell } from "@/components/project-shell";
import { supabase } from "@/lib/supabase";
import { gatherSnapshot, type ReportPeriod } from "@/lib/report-data";
import { malaysiaDateString, shiftDateString, MIN_TRACKING_DATE } from "@/lib/reporting-date";
import { trackingLocationLabel } from "@/lib/tracking-locations";
import type { ReportSnapshot } from "@/lib/report-types";
import { canEditProject } from "@/lib/report-view";
import { generateMonthlyReportPptx } from "@/lib/monthly-report-pptx";

type ReportType = "monthly" | "simple" | "introductory" | "technical_audit" | "competitor_comparison";
type ReportRow = { id: string; report_type: ReportType; period_start: string; period_end: string; status: string; created_at: string; snapshot: ReportSnapshot; content: Content };
type Target = { score: string };
type Initiative = { area: string; title: string; description: string };
type Action = { week: string; website: string; knowledge: string; branding: string; community: string; monitoring: string };
type Content = {
  preparedBy: string; projectName: string; summaryDone: string; summaryFocus: string; knowledgeAssets: string;
  progress: Record<string, string[]>; initiatives: Initiative[]; actions: Action[];
  targets: Record<string, Target>; competitorAssets: Record<string, string>; citationByCategory: Record<string, { citations: number; pages: { url: string; frequency: number }[] }>;
};
const TYPES: { id: ReportType; name: string; description: string; ready: boolean }[] = [
  { id: "monthly", name: "Monthly Report", description: "AI visibility progress, citations, competitor benchmarking and next-month plans.", ready: true },
  { id: "simple", name: "Simple Report", description: "A concise client-facing performance summary.", ready: false },
  { id: "introductory", name: "Introductory Report", description: "An introduction to the brand's AI visibility baseline.", ready: false },
  { id: "technical_audit", name: "Technical Audit Report", description: "Technical SEO, GEO and website audit findings.", ready: false },
  { id: "competitor_comparison", name: "Competitor Comparison Report", description: "A focused comparison against selected competitors.", ready: false },
];
const AREAS = ["Website Content and Structure", "Knowledge Assets and Resources", "Branding and Authority", "Community Engagement", "Monitoring and Research"];
const BLANK_ACTION = (): Action => ({ week: "Week 1", website: "", knowledge: "", branding: "", community: "", monitoring: "" });
function emptyContent(categories: string[]): Content {
  return {
    preparedBy: "", projectName: "", summaryDone: "", summaryFocus: "", knowledgeAssets: "",
    progress: Object.fromEntries(AREAS.map((a) => [a, ["", "", "", ""]])),
    initiatives: [
      { area: "Website", title: "", description: "" }, { area: "Website", title: "", description: "" },
      { area: "Knowledge", title: "", description: "" }, { area: "Branding", title: "", description: "" },
      { area: "Community", title: "", description: "" }, { area: "Monitoring", title: "", description: "" },
    ],
    actions: [BLANK_ACTION(), { ...BLANK_ACTION(), week: "Week 2" }, { ...BLANK_ACTION(), week: "Week 3" }, { ...BLANK_ACTION(), week: "Week 4" }, { ...BLANK_ACTION(), week: "Ongoing" }],
    targets: Object.fromEntries(["Overall", ...categories].map((c) => [c, { score: "" }])), competitorAssets: {},
    citationByCategory: {},
  };
}
const pct = (v: number | null | undefined) => v === null || v === undefined ? "N/A" : v.toFixed(1) + "%";
const fmt = (n: number | null | undefined) => n === null || n === undefined ? "N/A" : n.toLocaleString("en-MY");
function monthRange() {
  const today = malaysiaDateString();
  const firstThisMonth = today.slice(0, 8) + "01";
  const end = shiftDateString(firstThisMonth, -1);
  return { start: end.slice(0, 8) + "01", end };
}
function Field({ label, value, onChange, placeholder = "Enter information", multiline = false }: { label: string; value: string; onChange: (v: string) => void; placeholder?: string; multiline?: boolean }) {
  return <label className="block min-w-0"><span className="mb-1.5 block text-xs font-semibold text-[var(--muted-foreground)]">{label}</span>{multiline
    ? <textarea className="platform-input min-h-20 resize-y text-sm" value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} />
    : <input className="platform-input text-sm" value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} />}</label>;
}
function SlideFrame({ number, title, children, preview = false, pageNumber = number }: { number: string; title: string; children: React.ReactNode; preview?: boolean; pageNumber?: string }) {
  return <article className={preview ? "monthly-slide monthly-slide-preview" : "monthly-slide"}>
    <div className="monthly-slide-top"><span>DR. D SIGNATURE CLINIC</span><span>AI VISIBILITY PROGRESS REPORT</span></div>
    <div className="monthly-slide-heading">{number && <span>{number}</span>}<h3>{title}</h3></div>
    <div className="monthly-slide-content">{children}</div>
    <div className="monthly-slide-footer"><span>LIFEWOOD · AI VISIBILITY INTELLIGENCE</span><span>{pageNumber}</span></div>
  </article>;
}
function Kpi({ label, value, note }: { label: string; value: string; note?: string }) {
  return <div className="monthly-kpi"><span>{label}</span><strong>{value}</strong>{note && <small>{note}</small>}</div>;
}

export default function ReportsPage() {
  const { projectId } = useParams<{ projectId: string }>();
  const [reportType, setReportType] = useState<ReportType>("monthly");
  const [start, setStart] = useState(monthRange().start);
  const [end, setEnd] = useState(monthRange().end);
  const [snapshot, setSnapshot] = useState<ReportSnapshot | null>(null);
  const [content, setContent] = useState<Content>(emptyContent([]));
  const [saved, setSaved] = useState<ReportRow[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [canEdit, setCanEdit] = useState(false);
  const [canManageTemplate, setCanManageTemplate] = useState(false);
  const [templateExists, setTemplateExists] = useState(false);
  const [templateUploading, setTemplateUploading] = useState(false);
  const [exportingPptx, setExportingPptx] = useState(false);
  const [templateError, setTemplateError] = useState("");
  const templatePath = "Client_Monthly_Report_Template.pptx";
  const templateDownloadUrl = supabase.storage.from("client-report-templates").getPublicUrl(templatePath).data.publicUrl;

  const categories = useMemo(() => snapshot?.brand.categories ?? [], [snapshot]);
  const websiteCitationTotal = useMemo(() => Object.values(content.citationByCategory).reduce((sum, item) => sum + item.citations, 0), [content.citationByCategory]);
  const slides = ["Cover", "Executive Summary", "Overall Visibility Score Progression", "Comparison with Competitors", "Citation Summary", "What Have Been Done", "What Needs To Be Done", "Recommended Action Plans", "Targets", "Thank You"];
  const sectionNumbers = ["", "1.0", "2.0", "3.0", "4.0", "5.0", "6.0", "7.0", "8.0", ""];

  const loadSaved = useCallback(async () => {
    const { data: { user } } = await supabase.auth.getUser();
    const [dataResult, projectResult, profileResult, memberResult] = await Promise.all([
      supabase.from("client_reports").select("id,report_type,period_start,period_end,status,created_at,snapshot,content")
        .eq("project_id", projectId).order("created_at", { ascending: false }).limit(30),
      supabase.from("projects").select("created_by").eq("id", projectId).maybeSingle(),
      user ? supabase.from("profiles").select("role").eq("id", user.id).maybeSingle() : Promise.resolve({ data: null }),
      user ? supabase.from("project_members").select("role").eq("project_id", projectId).eq("user_id", user.id).maybeSingle() : Promise.resolve({ data: null }),
    ]);
    if (dataResult.error) setError(dataResult.error.message);
    else setSaved((dataResult.data ?? []) as ReportRow[]);
    setCanManageTemplate(Boolean(user && ["admin", "superadmin"].includes(String(profileResult.data?.role ?? "").toLowerCase())));
    setCanEdit(Boolean(user && canEditProject(
      profileResult.data?.role,
      memberResult.data?.role,
      projectResult.data?.created_by === user.id,
    )));
  }, [projectId]);

  useEffect(() => { void loadSaved(); }, [loadSaved]);

  useEffect(() => {
    let active = true;
    void supabase.storage.from("client-report-templates").list("", { search: templatePath })
      .then(({ data, error: listError }) => {
        if (active) setTemplateExists(!listError && Boolean(data?.some((item) => item.name === templatePath)));
      });
    return () => { active = false; };
  }, [templatePath]);

  async function exportPowerPoint() {
    if (!snapshot || !templateExists) return;
    setExportingPptx(true);
    setError("");
    try {
      const blob = await generateMonthlyReportPptx(templateDownloadUrl, snapshot, content);
      const objectUrl = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = objectUrl;
      anchor.download = (snapshot.brand.name || "Client").replace(/[^a-z0-9-_]+/gi, "-") + "-AI-Visibility-Report-" + snapshot.period.start + "-to-" + snapshot.period.end + ".pptx";
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      URL.revokeObjectURL(objectUrl);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Unable to generate the PowerPoint report.");
    } finally { setExportingPptx(false); }
  }

  async function uploadTemplate(file?: File) {
    if (!file) return;
    setTemplateError("");
    if (file.type !== "application/vnd.openxmlformats-officedocument.presentationml.presentation" && !file.name.toLowerCase().endsWith(".pptx")) {
      setTemplateError("Please select a PowerPoint .pptx file.");
      return;
    }
    if (file.size > 10 * 1024 * 1024) {
      setTemplateError("The template must be 10 MB or smaller.");
      return;
    }
    setTemplateUploading(true);
    try {
      const { error: uploadError } = await supabase.storage.from("client-report-templates")
        .upload(templatePath, file, { upsert: true, contentType: "application/vnd.openxmlformats-officedocument.presentationml.presentation" });
      if (uploadError) throw uploadError;
      setTemplateExists(true);
    } catch (e) {
      setTemplateError(e instanceof Error ? e.message : "Unable to upload the PowerPoint template.");
    } finally { setTemplateUploading(false); }
  }

  function update<K extends keyof Content>(key: K, value: Content[K]) {
    setContent((prev) => ({ ...prev, [key]: value }));
  }
  function updateProgress(area: string, index: number, value: string) {
    setContent((prev) => ({ ...prev, progress: { ...prev.progress, [area]: (prev.progress[area] ?? ["", "", "", ""]).map((v, i) => i === index ? value : v) } }));
  }

  async function generate() {
    if (reportType !== "monthly") return;
    if (!start || !end || start < MIN_TRACKING_DATE || end < start) { setError("Choose a valid reporting period."); return; }
    setLoading(true); setError(""); setNotice(""); setActiveId(null);
    try {
      const period: ReportPeriod = { start, end, label: "Custom" };
      const data = await gatherSnapshot(supabase, projectId, period);
      if (!data.hasData) throw new Error("No AI visibility tracking data was found for this period and tracking location.");
      const next = emptyContent(data.brand.categories);
      const citationByCategory: Content["citationByCategory"] = {};
      const { data: projectInfo, error: projectInfoError } = await supabase.from("projects").select("brand_domains").eq("id", projectId).single();
      if (projectInfoError) throw projectInfoError;
      const brandHosts = ((projectInfo?.brand_domains ?? []) as string[]).map((domain) => {
        try { return new URL(domain.includes("://") ? domain : "https://" + domain).hostname.toLowerCase().replace(/^www\./, ""); } catch { return ""; }
      }).filter(Boolean);
      const args = { p_project_id: projectId, p_start_date: start, p_end_date: end, p_engines: [], p_brand_related_only: false, p_tracking_location: data.location };
      const results = await Promise.all(data.brand.categories.map(async (category) => {
        const { data: rows, error: rpcError } = await supabase.rpc("get_cumulative_citations", { ...args, p_category: category });
        if (rpcError) throw rpcError;
        const allPages = (rows ?? []) as { url: string; frequency: number }[];
        const pages = allPages.filter((page) => {
          try {
            const host = new URL(page.url).hostname.toLowerCase().replace(/^www\./, "");
            return brandHosts.some((brandHost) => host === brandHost || host.endsWith("." + brandHost));
          } catch { return false; }
        });
        return [category, { citations: pages.reduce((sum, p) => sum + Number(p.frequency || 0), 0), pages: pages.slice(0, 10) }] as const;
      }));
      for (const [category, value] of results) citationByCategory[category] = value;
      next.citationByCategory = citationByCategory;
      next.competitorAssets = Object.fromEntries(data.competitors.filter((row) => !row.isTracked).map((row) => [row.name, ""]));
      setSnapshot(data); setContent(next);
      setNotice("Monthly report data loaded. Complete the highlighted manual fields, then save your draft.");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Unable to generate the report.");
    } finally { setLoading(false); }
  }

  async function save() {
    if (!snapshot || !canEdit) return;
    setSaving(true); setError(""); setNotice("");
    try {
      const { data: auth } = await supabase.auth.getUser();
      const payload = {
        project_id: projectId, created_by: auth.user?.id ?? null, report_type: "monthly",
        period_start: snapshot.period.start, period_end: snapshot.period.end, period_label: snapshot.period.label,
        tracking_location: snapshot.location, snapshot, content, status: "draft",
      };
      if (activeId) {
        const { error: e } = await supabase.from("client_reports").update({ ...payload, created_by: auth.user?.id ?? null }).eq("id", activeId).eq("project_id", projectId);
        if (e) throw e;
      } else {
        const { data, error: e } = await supabase.from("client_reports").insert(payload).select("id").single();
        if (e) throw e;
        setActiveId(data.id);
      }
      await loadSaved();
      setNotice("Draft saved successfully.");
    } catch (e) { setError(e instanceof Error ? e.message : "Unable to save this report."); }
    finally { setSaving(false); }
  }

  async function openSaved(row: ReportRow) {
    setError(""); setNotice("");
    setReportType(row.report_type); setStart(row.period_start); setEnd(row.period_end);
    setSnapshot(row.snapshot); setContent({ ...emptyContent(row.snapshot.brand.categories), ...row.content });
    setActiveId(row.id);
  }

  function updateInitiative(index: number, key: keyof Initiative, value: string) {
    setContent((prev) => ({ ...prev, initiatives: prev.initiatives.map((v, i) => i === index ? { ...v, [key]: value } : v) }));
  }
  function updateAction(index: number, key: keyof Action, value: string) {
    setContent((prev) => ({ ...prev, actions: prev.actions.map((v, i) => i === index ? { ...v, [key]: value } : v) }));
  }
  function updateTarget(category: string, value: string) {
    setContent((prev) => ({ ...prev, targets: { ...prev.targets, [category]: { score: value } } }));
  }

  const preview = (slide: number) => {
    if (!snapshot) return <div className="monthly-preview-empty"><FileText size={32} /><p>Generate a monthly report to see the slide preview.</p></div>;
    const s = snapshot;
    if (slide === 1) return <div className="monthly-cover"><span>{s.brand.name}</span><h2>AI Visibility Progress Report</h2><p>{s.period.start} to {s.period.end}</p><small>Prepared by {content.preparedBy || "Team Name"} as part of {content.projectName || "Project Name"}.</small></div>;
    if (slide === 2) return <><div className="monthly-kpis"><Kpi label="Overall visibility score" value={pct(s.overall.visibilityScore)} note="Latest score in period" /><Kpi label="Share of voice" value={pct(s.overall.shareOfVoice)} note="Average across available engines" /><Kpi label="Website citations in AI" value={fmt(websiteCitationTotal)} note="Citations to the brand website" /><Kpi label="Knowledge assets" value={content.knowledgeAssets || "—"} note="Enter the latest website audit count" /></div><div className="monthly-preview-two"><div><b>Improvements made</b><p>{content.summaryDone || "Add a summary of completed work."}</p></div><div><b>Where to focus next</b><p>{content.summaryFocus || "Add the next reporting period's priorities."}</p></div></div></>;
    if (slide === 3) return <div className="monthly-chart-layout"><div><b>Daily visibility score</b><div className="monthly-bars">{s.trend.slice(-16).map((v, i) => <div key={i} title={v.date + ": " + pct(v.score)}><i style={{ height: Math.max(3, v.score ?? 0) + "%" }} /><small>{v.date.slice(8)}</small></div>)}</div></div><div className="monthly-category-stack"><Kpi label="Latest overall score" value={pct(s.overall.visibilityScore)} />{s.byCategory.map((c) => <Kpi key={c.category} label={"Latest " + c.category} value={pct(c.visibilityScore)} />)}</div></div>;
    if (slide === 4) return <div className="monthly-table-wrap"><table className="monthly-table"><thead><tr><th>Metric</th>{s.competitors.map((c) => <th key={c.name}>{c.name}</th>)}</tr></thead><tbody>{[["Visibility score", (c: typeof s.competitors[number]) => pct(c.visibilityScore)], ["Share of voice", (c: typeof s.competitors[number]) => pct(c.shareOfVoice)], ["Citations", (c: typeof s.competitors[number]) => fmt(c.citations)], ["Knowledge assets", (c: typeof s.competitors[number]) => c.isTracked ? (content.knowledgeAssets || "Not entered") : (content.competitorAssets[c.name] || "Not entered")], ["External websites", (c: typeof s.competitors[number]) => fmt(c.presence.websites)], ["Directories", (c: typeof s.competitors[number]) => fmt(c.presence.directories)], ["Social", (c: typeof s.competitors[number]) => fmt(c.presence.social)]].map(([label, fn]) => <tr key={String(label)}><th>{String(label)}</th>{s.competitors.map((c) => <td key={c.name}>{(fn as (v: typeof c) => string)(c)}</td>)}</tr>)}</tbody></table></div>;
    if (slide === 5) {
      const all = Object.values(content.citationByCategory);
      const total = all.reduce((sum, x) => sum + x.citations, 0);
      const pages = all.flatMap((x) => x.pages).sort((a,b) => b.frequency-a.frequency).slice(0,7);
      return <><div className="monthly-kpis"><Kpi label="Brand website citations" value={fmt(total)} /><Kpi label="Categories covered" value={String(categories.length)} /><Kpi label="Pages cited" value={fmt(new Set(all.flatMap(x=>x.pages.map(p=>p.url))).size)} /><Kpi label="Third-party domains" value={fmt(s.thirdPartyHosts)} /></div><div className="monthly-preview-two"><div><b>Share of citations by category</b><div className="monthly-citation-bars">{categories.map(c=>{const value=content.citationByCategory[c]?.citations ?? 0;return <div key={c}><span>{c}</span><i style={{width:(Math.max(0,value)/Math.max(1,...categories.map(k=>content.citationByCategory[k]?.citations ?? 0))*100)+"%"}}/><b>{fmt(value)}</b></div>})}</div></div><div><b>Most-cited brand pages</b>{pages.map(p=><p key={p.url}>{p.url} · {p.frequency}</p>)}</div></div></>;
    }
    if (slide === 6) return <div className="monthly-area-grid">{AREAS.map(a=><section key={a}><b>{a}</b><ul>{(content.progress[a] ?? []).filter(Boolean).map((v,i)=><li key={i}>{v}</li>)}</ul></section>)}</div>;
    if (slide === 7) return <div className="monthly-initiative-grid">{content.initiatives.map((v,i)=><section key={i}><small>{v.area}</small><b>{v.title || "Initiative " + (i+1)}</b><p>{v.description || "Description to be completed."}</p></section>)}</div>;
    if (slide === 8) return <div className="monthly-action-list">{content.actions.map((a,i)=><section key={i}><b>{a.week}</b><div>{(["website","knowledge","branding","community","monitoring"] as const).filter(k=>a[k]).map(k=><p key={k}><strong>{k}</strong>: {a[k]}</p>)}</div></section>)}</div>;
    if (slide === 9) return <div className="monthly-target-grid">{["Overall", ...categories].map(c=><section key={c}><b>{c}</b><div>Latest score <strong>{pct(c==="Overall"?s.overall.visibilityScore:s.byCategory.find(x=>x.category===c)?.visibilityScore ?? null)}</strong></div><div>Target score <strong>{content.targets[c]?.score ? content.targets[c].score+"%" : "Not set"}</strong></div></section>)}</div>;
    return <div className="monthly-thanks"><h2>Thank You</h2><p>{s.brand.name} · {s.period.start} to {s.period.end}</p></div>;
  };

  const editor = (slide: number) => {
    if (!snapshot) return <p className="text-sm text-[var(--muted-foreground)]">Generate or open a report before editing its slide content.</p>;
    if (slide === 1) return <div className="grid gap-4"><Field label="Prepared by" value={content.preparedBy} onChange={v=>update("preparedBy",v)} /><Field label="Project name" value={content.projectName} onChange={v=>update("projectName",v)} /></div>;
    if (slide === 2) return <div className="grid gap-4"><p className="text-xs text-[var(--muted-foreground)]">KPI values are populated from the tracking database. Knowledge asset counts require a future website-audit integration.</p><Field label="Improvements made during this period" value={content.summaryDone} onChange={v=>update("summaryDone",v)} multiline /><Field label="Where to focus next period" value={content.summaryFocus} onChange={v=>update("summaryFocus",v)} multiline /><Field label="Knowledge assets (count)" value={content.knowledgeAssets} onChange={v=>update("knowledgeAssets",v)} placeholder="Enter audited count" /></div>;
    if (slide === 3) return <p className="text-sm text-[var(--muted-foreground)]">Visibility trend, latest overall score and category scores are populated from visibility_daily. Category cards adapt to this brand's configured categories ({categories.length}).</p>;
    if (slide === 4) return <div className="grid gap-3">{snapshot.competitors.filter(row=>!row.isTracked).map(row=><Field key={row.name} label={row.name+" knowledge assets"} value={content.competitorAssets[row.name] ?? ""} onChange={value=>update("competitorAssets",{...content.competitorAssets,[row.name]:value})} placeholder="Enter audited asset count" />)}<p className="text-xs text-[var(--muted-foreground)]">Visibility, share of voice, citations and external presence come from tracking data. Knowledge asset counts are manual because the tracking database does not currently store this audit measure.</p></div>;
    if (slide === 5) return <p className="text-sm text-[var(--muted-foreground)]">Citation counts and cited pages are loaded per category and filtered to the tracked brand domains. The preview displays up to seven of the most-cited brand pages.</p>;
    if (slide === 6) return <div className="grid gap-4">{AREAS.map(a=><section key={a} className="rounded-xl border border-[var(--line)] p-3"><h4 className="mb-3 text-sm font-bold">{a}</h4>{(content.progress[a] ?? ["","","",""]).map((v,i)=><Field key={i} label={"Progress " + (i+1)} value={v} onChange={value=>updateProgress(a,i,value)} placeholder="Describe work completed" />)}</section>)}</div>;
    if (slide === 7) return <div className="grid gap-3">{content.initiatives.map((v,i)=><section key={i} className="grid gap-3 rounded-xl border border-[var(--line)] p-3 sm:grid-cols-2"><Field label="Area" value={v.area} onChange={value=>updateInitiative(i,"area",value)} /><Field label="Initiative" value={v.title} onChange={value=>updateInitiative(i,"title",value)} /><div className="sm:col-span-2"><Field label="Description" value={v.description} onChange={value=>updateInitiative(i,"description",value)} multiline /></div></section>)}<button className="platform-btn self-start" onClick={()=>update("initiatives",[...content.initiatives,{area:"Website",title:"",description:""}])}><Plus size={14}/> Add initiative</button></div>;
    if (slide === 8) return <div className="grid gap-3">{content.actions.map((v,i)=><section key={i} className="rounded-xl border border-[var(--line)] p-3"><div className="mb-3 flex items-center justify-between gap-2"><b className="text-sm">{v.week}</b><button className="platform-btn" onClick={()=>updateAction(i,"week",v.week==="Ongoing"?"Week 4":"Ongoing")}>Change timing</button></div><div className="grid gap-3 sm:grid-cols-2">{(["website","knowledge","branding","community","monitoring"] as const).map(k=><Field key={k} label={k[0].toUpperCase()+k.slice(1)} value={v[k]} onChange={value=>updateAction(i,k,value)} />)}</div></section>)}<button className="platform-btn self-start" onClick={()=>update("actions",[...content.actions,{...BLANK_ACTION(),week:"Additional"}])}><Plus size={14}/> Add action period</button></div>;
    if (slide === 9) return <div className="grid gap-3 sm:grid-cols-2">{["Overall",...categories].map(c=><section key={c} className="rounded-xl border border-[var(--line)] p-3"><b className="mb-2 block text-sm">{c}</b><Field label="Target visibility score (%)" value={content.targets[c]?.score ?? ""} onChange={v=>updateTarget(c,v)} placeholder="e.g. 25" /></section>)}</div>;
    return <p className="text-sm text-[var(--muted-foreground)]">No additional information is required for this slide.</p>;
  };

  return <ProjectShell>
    <div className="ops-page">
      <header className="page-heading"><p className="page-eyebrow">Client Deliverables</p><h1 className="page-title mt-1">Reports</h1><p className="page-description mt-2">Create client-ready reports from tracking data, complete the editable sections, review each slide and save drafts.</p></header>
      <section className="mt-6 rounded-2xl border border-[var(--line)] bg-[var(--card)] p-4 sm:p-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div><h2 className="font-bold">Monthly report PowerPoint template</h2><p className="mt-1 text-xs text-[var(--muted-foreground)]">Original 10-slide Lifewood template, retained as the reference design.</p></div>
          <div className="flex flex-wrap items-center gap-2">
            {templateExists ? <a className="platform-btn platform-btn-primary" href={templateDownloadUrl} download="Client_Monthly_Report_Template.pptx"><Download size={14}/> Download template</a> : <span className="text-xs text-[var(--muted-foreground)]">Template file has not been uploaded to platform storage yet.</span>}
            {canManageTemplate && <label className="platform-btn cursor-pointer">
              {templateUploading ? <Loader2 size={14} className="animate-spin"/> : <Plus size={14}/>} {templateExists ? "Replace template" : "Upload template"}
              <input className="hidden" type="file" accept=".pptx,application/vnd.openxmlformats-officedocument.presentationml.presentation" disabled={templateUploading} onChange={(e) => { void uploadTemplate(e.target.files?.[0]); e.currentTarget.value = ""; }}/>
            </label>}
          </div>
        </div>
        {templateError && <p className="mt-3 text-xs text-red-600">{templateError}</p>}
        {!templateExists && <p className="mt-2 text-xs text-[var(--muted-foreground)]">An Admin or Superadmin must upload the supplied PowerPoint once. It will then be available to download for all authenticated platform users.</p>}
      </section>
      <section className="mt-6 rounded-2xl border border-[var(--line)] bg-[var(--card)] p-4 sm:p-5">
        <div className="flex flex-wrap items-center justify-between gap-3"><h2 className="text-base font-bold">Report type</h2><span className="text-xs text-[var(--muted-foreground)]">5 report formats</span></div>
        <div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-5">{TYPES.map(t=><button key={t.id} onClick={()=>{setReportType(t.id);setSnapshot(null);setActiveId(null);setError("");setNotice("");}} className={"rounded-xl border p-3 text-left transition "+(reportType===t.id?"border-[var(--primary)] bg-[var(--accent)] ring-1 ring-[var(--primary)]":"border-[var(--line)] hover:bg-[var(--accent)]")}><div className="flex items-center justify-between gap-2"><b className="text-sm">{t.name}</b>{t.ready?<span className="monthly-ready">Available</span>:<span className="monthly-soon">Coming soon</span>}</div><p className="mt-2 text-xs leading-5 text-[var(--muted-foreground)]">{t.description}</p></button>)}</div>
        {reportType==="monthly"?<div className="mt-5 flex flex-wrap items-end gap-3 border-t border-[var(--line)] pt-4"><label className="block"><span className="mb-1.5 block text-xs font-semibold text-[var(--muted-foreground)]">Start date</span><input className="platform-input text-sm" type="date" min={MIN_TRACKING_DATE} max={end} value={start} onChange={e=>setStart(e.target.value)} /></label><label className="block"><span className="mb-1.5 block text-xs font-semibold text-[var(--muted-foreground)]">End date</span><input className="platform-input text-sm" type="date" min={start} max={malaysiaDateString()} value={end} onChange={e=>setEnd(e.target.value)} /></label><button className="platform-btn platform-btn-primary ml-auto" disabled={loading} onClick={generate}>{loading?<Loader2 size={15} className="animate-spin"/>:<Sparkles size={15}/>} Generate monthly report</button></div>:<div className="mt-5 rounded-xl border border-dashed border-[var(--line)] p-5 text-center text-sm text-[var(--muted-foreground)]">This report format is planned for a future development stage.</div>}
      </section>
      {error&&<div className="sample-error mt-4 rounded-xl p-3 text-sm">{error}</div>}{notice&&<div className="platform-notice-success mt-4 rounded-xl p-3 text-sm">{notice}</div>}
      {snapshot&&<section className="mt-6">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3"><div><h2 className="text-lg font-bold">Monthly report editor</h2><p className="text-xs text-[var(--muted-foreground)]">{snapshot.brand.name} · {snapshot.period.start} to {snapshot.period.end} · {trackingLocationLabel(snapshot.location)}</p></div><div className="flex flex-wrap gap-2"><button className="platform-btn" onClick={()=>window.print()}><Download size={14}/> Print / PDF</button><button className="platform-btn platform-btn-primary" disabled={exportingPptx || !templateExists} title={!templateExists ? "Upload the PowerPoint template first" : undefined} onClick={exportPowerPoint}>{exportingPptx?<Loader2 size={14} className="animate-spin"/>:<Download size={14}/>} Export PowerPoint</button><button className="platform-btn platform-btn-primary" disabled={saving || !canEdit} title={!canEdit ? "Only project editors can save reports" : undefined} onClick={save}>{saving?<Loader2 size={14} className="animate-spin"/>:<Save size={14}/>} Save draft</button></div>{!canEdit&&<p className="mt-2 text-right text-xs text-[var(--muted-foreground)]">You have read-only access to reports.</p>}</div>
        <div className="mb-4 flex gap-2 overflow-x-auto pb-2">{slides.map((name,i)=><a key={name} href={"#monthly-slide-"+(i+1)} className="shrink-0 rounded-lg border border-[var(--line)] px-3 py-2 text-xs hover:bg-[var(--accent)]">{i+1}. {name}</a>)}</div>
        <div className="monthly-slides-list">{slides.map((name,i)=><section id={"monthly-slide-"+(i+1)} key={name} className="monthly-slide-editor">
          <div className="monthly-editor-toolbar"><div><span className="text-xs text-[var(--muted-foreground)]">Slide {i+1} of 10</span><h3 className="font-bold">{name}</h3></div><span className="text-[10px] text-[var(--muted-foreground)]">16:9 preview</span></div>
          <div className="monthly-workspace"><div className="monthly-form-panel"><h4 className="mb-3 text-sm font-bold">Slide information</h4>{editor(i+1)}</div><div className="monthly-preview-panel"><h4 className="mb-2 text-sm font-bold">Slide preview</h4><SlideFrame number={sectionNumbers[i]} pageNumber={String(i+1).padStart(2,"0")} title={name} preview>{preview(i+1)}</SlideFrame></div></div>
        </section>)}</div>
        <div className="monthly-print hidden">{slides.map((name,i)=><SlideFrame key={name} number={sectionNumbers[i]} pageNumber={String(i+1).padStart(2,"0")} title={name}>{preview(i+1)}</SlideFrame>)}</div>
        
      </section>}
      <section className="mt-8 rounded-2xl border border-[var(--line)] bg-[var(--card)] p-4 sm:p-5"><div className="mb-4 flex items-center justify-between"><h2 className="font-bold">Saved Reports</h2><span className="text-xs text-[var(--muted-foreground)]">{saved.length} saved</span></div>{saved.length===0?<p className="text-sm text-[var(--muted-foreground)]">No saved client reports yet.</p>:<div className="overflow-x-auto"><table className="platform-table"><thead><tr><th>Created</th><th>Type</th><th>Period</th><th>Status</th><th /></tr></thead><tbody>{saved.map(r=><tr key={r.id}><td>{new Date(r.created_at).toLocaleDateString("en-MY")}</td><td>{TYPES.find(t=>t.id===r.report_type)?.name ?? r.report_type}</td><td>{r.period_start} – {r.period_end}</td><td><span className="monthly-ready">Draft</span></td><td className="text-right"><button className="platform-btn" onClick={()=>openSaved(r)}>Open</button></td></tr>)}</tbody></table></div>}</section>
    </div>
  </ProjectShell>;
}
