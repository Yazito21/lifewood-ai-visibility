"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useParams } from "next/navigation";
import { Download, ExternalLink, Loader2, Plus, Printer, RefreshCw, Save, Sparkles, ChevronDown, Trash2, X } from "lucide-react";
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
  preparedBy: string; preparedOn: string; projectName: string; summaryDone: string; summaryFocus: string; knowledgeAssets: string;
  progress: Record<string, string[]>; initiatives: Initiative[]; actions: Action[];
  targets: Record<string, Target>; competitorAssets: Record<string, string>;
  competitorDetails: Record<string, { knowledgeAssets: string; knowledgeDescription: string; externalTotal: string; news: string; directories: string; websites: string; social: string }>;
  citationByCategory: Record<string, { citations: number; pages: { url: string; frequency: number }[] }>;
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
    preparedBy: "", preparedOn: malaysiaDateString(), projectName: "", summaryDone: "", summaryFocus: "", knowledgeAssets: "",
    progress: Object.fromEntries(AREAS.map((a) => [a, ["", "", ""]])),
    initiatives: [
      { area: "Website", title: "", description: "" }, { area: "Website", title: "", description: "" },
      { area: "Knowledge", title: "", description: "" }, { area: "Branding", title: "", description: "" },
      { area: "Community", title: "", description: "" }, { area: "Monitoring", title: "", description: "" },
    ],
    actions: [BLANK_ACTION(), { ...BLANK_ACTION(), week: "Week 2" }, { ...BLANK_ACTION(), week: "Week 3" }, { ...BLANK_ACTION(), week: "Week 4" }, { ...BLANK_ACTION(), week: "Ongoing" }],
    targets: Object.fromEntries(["Overall", ...categories].map((c) => [c, { score: "" }])), competitorAssets: {}, competitorDetails: {},
    citationByCategory: {},
  };
}
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
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [canEdit, setCanEdit] = useState(false);
  const [templateExists, setTemplateExists] = useState(false);
  const [storedTemplatePath, setStoredTemplatePath] = useState<string | null>(null);
  const [templateNotice, setTemplateNotice] = useState("");
  const [exportingPptx, setExportingPptx] = useState(false);
  const [previewViewerUrl, setPreviewViewerUrl] = useState("");
  const [previewOpenUrl, setPreviewOpenUrl] = useState("");
  const [previewStoragePath, setPreviewStoragePath] = useState<string | null>(null);
  const [previewBlob, setPreviewBlob] = useState<Blob | null>(null);
  const [previewSignature, setPreviewSignature] = useState("");
  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewError, setPreviewError] = useState("");
  const [brandLogoUrl, setBrandLogoUrl] = useState("");
  const [preparedByName, setPreparedByName] = useState("Platform User");
  const [collapsedSlides, setCollapsedSlides] = useState<Record<number, boolean>>({1:true,2:true,3:true,4:true,5:true,6:true,7:true,8:true,9:true,10:true});
  const preferredTemplatePath = "Client_Monthly_Report_Template_2026-11-12.pptx";
  const legacyTemplatePath = "Client_Monthly_Report_Template.pptx";
  const templateDownloadUrl = storedTemplatePath ? supabase.storage.from("client-report-templates").getPublicUrl(storedTemplatePath).data.publicUrl : "";
  const reportSignature = useMemo(() => snapshot ? JSON.stringify({ snapshot, content }) : "", [snapshot, content]);
  const previewIsCurrent = Boolean(previewBlob && previewSignature === reportSignature);

  const categories = useMemo(() => snapshot?.brand.categories ?? [], [snapshot]);
  const slides = ["Cover", "Executive Summary", "Overall Visibility Score Progression", "Comparison with Competitors", "Citation Summary", "What Have Been Done", "What Needs To Be Done", "Recommended Action Plans", "Targets", "Thank You"];


  const loadSaved = useCallback(async () => {
    const { data: { user } } = await supabase.auth.getUser();
    const [dataResult, projectResult, profileResult, memberResult] = await Promise.all([
      supabase.from("client_reports").select("id,report_type,period_start,period_end,status,created_at,snapshot,content")
        .eq("project_id", projectId).order("created_at", { ascending: false }).limit(30),
      supabase.from("projects").select("created_by,brand_logo_url").eq("id", projectId).maybeSingle(),
      user ? supabase.from("profiles").select("role,display_name,full_name").eq("id", user.id).maybeSingle() : Promise.resolve({ data: null }),
      user ? supabase.from("project_members").select("role").eq("project_id", projectId).eq("user_id", user.id).maybeSingle() : Promise.resolve({ data: null }),
    ]);
    if (dataResult.error) setError(dataResult.error.message);
    else setSaved((dataResult.data ?? []) as ReportRow[]);
    setBrandLogoUrl(projectResult.data?.brand_logo_url ?? "");
    setPreparedByName(profileResult.data?.display_name || profileResult.data?.full_name || user?.user_metadata?.display_name || user?.user_metadata?.full_name || user?.email?.split("@")[0] || "Platform User");
    setCanEdit(Boolean(user && canEditProject(
      profileResult.data?.role,
      memberResult.data?.role,
      projectResult.data?.created_by === user.id,
    )));
  }, [projectId]);

  useEffect(() => { void loadSaved(); }, [loadSaved]);

  useEffect(() => {
    let active = true;
    void supabase.storage.from("client-report-templates").list("", { limit: 100 })
      .then(({ data, error: listError }) => {
        if (!active) return;
        if (listError) {
          setStoredTemplatePath(null); setTemplateExists(false);
          setTemplateNotice("Unable to check the stored PowerPoint template: " + listError.message);
          return;
        }
        const names = new Set((data ?? []).map((item) => item.name));
        const selected = names.has(preferredTemplatePath) ? preferredTemplatePath : names.has(legacyTemplatePath) ? legacyTemplatePath : null;
        setStoredTemplatePath(selected);
        setTemplateExists(Boolean(selected));
        setTemplateNotice(selected === legacyTemplatePath ? "Using the template already stored under its original filename. The new dated filename will be used automatically once it is added to storage." : "");
      });
    return () => { active = false; };
  }, []);

  useEffect(() => {
    return () => {
      if (previewStoragePath) void supabase.storage.from("client-report-previews").remove([previewStoragePath]);
    };
  }, [previewStoragePath]);

  async function refreshPowerPointPreview(
    sourceSnapshot: ReportSnapshot | null = snapshot,
    sourceContent: Content = content,
  ): Promise<Blob | null> {
    if (!sourceSnapshot || !templateExists) return null;
    setPreviewLoading(true);
    setPreviewError("");
    try {
      if (!templateDownloadUrl) throw new Error("The monthly PowerPoint template is not available in Supabase Storage. Check the client-report-templates bucket.");
      const blob = await generateMonthlyReportPptx(templateDownloadUrl, sourceSnapshot, { ...sourceContent, preparedBy: preparedByName }, brandLogoUrl);
      const { data: authData, error: authError } = await supabase.auth.getUser();
      if (authError) throw authError;
      if (!authData.user) throw new Error("Sign in again to generate a private PowerPoint preview.");

      const path = authData.user.id + "/" + projectId + "/" + Date.now() + "-" + crypto.randomUUID() + ".pptx";
      const { error: uploadError } = await supabase.storage.from("client-report-previews").upload(path, blob, {
        contentType: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
        upsert: false,
      });
      if (uploadError) throw uploadError;

      const { data: signed, error: signedError } = await supabase.storage.from("client-report-previews").createSignedUrl(path, 3600);
      if (signedError || !signed?.signedUrl) {
        await supabase.storage.from("client-report-previews").remove([path]);
        throw signedError ?? new Error("Could not create a secure preview link.");
      }

      const oldPath = previewStoragePath;
      setPreviewStoragePath(path);
      const signedSource = encodeURIComponent(signed.signedUrl);
      setPreviewViewerUrl("https://view.officeapps.live.com/op/embed.aspx?src=" + signedSource);
      setPreviewOpenUrl("https://view.officeapps.live.com/op/view.aspx?src=" + signedSource);
      setPreviewBlob(blob);
      setPreviewSignature(JSON.stringify({ snapshot: sourceSnapshot, content: sourceContent }));
      if (oldPath && oldPath !== path) void supabase.storage.from("client-report-previews").remove([oldPath]);
      return blob;
    } catch (e) {
      setPreviewViewerUrl("");
      setPreviewOpenUrl("");
      setPreviewError(e instanceof Error ? e.message : "Unable to render the PowerPoint preview.");
      return null;
    } finally {
      setPreviewLoading(false);
    }
  }

  useEffect(() => {
    if (snapshot && templateExists && !previewViewerUrl && !previewLoading) {
      void refreshPowerPointPreview(snapshot, content);
    }
  }, [snapshot, templateExists]);

  async function exportPowerPoint() {
    if (!snapshot || !templateExists) return;
    setExportingPptx(true);
    setError("");
    try {
      const blob = previewIsCurrent && previewBlob ? previewBlob : await refreshPowerPointPreview(snapshot, content);
      if (!blob) throw new Error("Refresh the PowerPoint preview before exporting. The preview file could not be prepared.");
      const objectUrl = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = objectUrl;
      anchor.download = (snapshot.brand.name || "Client").replace(/[^a-z0-9-_]+/gi, "-") + "-AI-Visibility-Report-" + snapshot.period.start + "-to-" + snapshot.period.end + ".pptx";
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      window.setTimeout(() => URL.revokeObjectURL(objectUrl), 1000);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Unable to generate the PowerPoint report.");
    } finally {
      setExportingPptx(false);
    }
  }


  function update<K extends keyof Content>(key: K, value: Content[K]) {
    setContent((prev) => ({ ...prev, [key]: value }));
  }
  function updateProgress(area: string, index: number, value: string) {
    setContent((prev) => ({ ...prev, progress: { ...prev.progress, [area]: (prev.progress[area] ?? ["", "", ""]).map((v, i) => i === index ? value : v) } }));
  }
  function addProgress(area: string) { setContent((prev) => ({ ...prev, progress: { ...prev.progress, [area]: [...(prev.progress[area] ?? []), ""] } })); }
  function removeProgress(area: string, index: number) { setContent((prev) => ({ ...prev, progress: { ...prev.progress, [area]: (prev.progress[area] ?? []).filter((_, i) => i !== index) } })); }
  function updateCompetitorDetail(name: string, key: keyof Content["competitorDetails"][string], value: string) {
    setContent((prev) => {
      const existing = prev.competitorDetails[name] ?? { knowledgeAssets: "", knowledgeDescription: "", externalTotal: "", news: "", directories: "", websites: "", social: "" };
      return { ...prev, competitorDetails: { ...prev.competitorDetails, [name]: { ...existing, [key]: value } } };
    });
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
      next.preparedBy = preparedByName;
      next.preparedOn = malaysiaDateString();
      next.projectName = "SEO/GEO project operations";
      next.competitorDetails = Object.fromEntries(data.competitors.map((row) => [row.name, { knowledgeAssets: "", knowledgeDescription: "", externalTotal: "", news: "", directories: "", websites: "", social: "" }]));
      const citationByCategory: Content["citationByCategory"] = {};
      const { data: projectInfo, error: projectInfoError } = await supabase.from("projects").select("brand_domains,brand_logo_url").eq("id", projectId).single();
      if (projectInfo?.brand_logo_url) setBrandLogoUrl(projectInfo.brand_logo_url);
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
        return [category, { citations: pages.reduce((sum, p) => sum + Number(p.frequency || 0), 0), pages }] as const;
      }));
      for (const [category, value] of results) citationByCategory[category] = value;
      next.citationByCategory = citationByCategory;
      next.competitorAssets = Object.fromEntries(data.competitors.filter((row) => !row.isTracked).map((row) => [row.name, ""]));
      setPreviewViewerUrl(""); setPreviewOpenUrl(""); setPreviewBlob(null); setPreviewSignature(""); setPreviewError("");
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

  function closeDraft() {
    if (snapshot && !window.confirm("Close this draft editor? Any unsaved changes will be discarded. A previously saved draft will remain in Saved Reports.")) return;
    setSnapshot(null);
    setActiveId(null);
    setContent(emptyContent([]));
    setPreviewViewerUrl("");
    setPreviewOpenUrl("");
    setPreviewBlob(null);
    setPreviewSignature("");
    setPreviewStoragePath(null);
    setPreviewError("");
    setError("");
    setNotice("Draft editor closed. Saved drafts remain available below.");
    setCollapsedSlides({1:true,2:true,3:true,4:true,5:true,6:true,7:true,8:true,9:true,10:true});
  }

  async function deleteDraft(row: ReportRow) {
    if (!canEdit || deletingId) return;
    const label = TYPES.find((type) => type.id === row.report_type)?.name ?? row.report_type;
    if (!window.confirm("Permanently delete this " + label + " draft for " + row.period_start + " to " + row.period_end + "? This cannot be undone.")) return;
    setDeletingId(row.id);
    setError("");
    setNotice("");
    try {
      const { error: deleteError } = await supabase.from("client_reports").delete().eq("id", row.id).eq("project_id", projectId);
      if (deleteError) throw deleteError;
      if (activeId === row.id) {
        setSnapshot(null);
        setActiveId(null);
        setContent(emptyContent([]));
        setPreviewViewerUrl("");
        setPreviewOpenUrl("");
        setPreviewBlob(null);
        setPreviewSignature("");
        setPreviewStoragePath(null);
        setPreviewError("");
      }
      await loadSaved();
      setNotice("Draft deleted successfully.");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Unable to delete this draft.");
    } finally {
      setDeletingId(null);
    }
  }

  async function openSaved(row: ReportRow) {
    setError(""); setNotice("");
    setReportType(row.report_type); setStart(row.period_start); setEnd(row.period_end);
    const restoredContent = { ...emptyContent(row.snapshot.brand.categories), ...row.content };
    // Earlier drafts stored Community before Monitoring, while the original template
    // places Monitoring in card 5 and Community in card 6.
    if (restoredContent.initiatives[4]?.area === "Monitoring" && restoredContent.initiatives[5]?.area === "Community") {
      [restoredContent.initiatives[4], restoredContent.initiatives[5]] = [restoredContent.initiatives[5], restoredContent.initiatives[4]];
    }
    restoredContent.preparedBy = preparedByName;
    restoredContent.preparedOn = malaysiaDateString();
    restoredContent.projectName = "SEO/GEO project operations";
    restoredContent.initiatives = [...restoredContent.initiatives.slice(0, 6)];
    restoredContent.actions = ["Week 1", "Week 2", "Week 3", "Week 4", "Ongoing"].map((week, i) => ({ ...BLANK_ACTION(), ...(restoredContent.actions?.[i] ?? {}), week }));
    restoredContent.progress = Object.fromEntries(AREAS.map((area) => [area, (restoredContent.progress?.[area] ?? ["", "", ""]).slice(0, 30)]));
    setPreviewViewerUrl(""); setPreviewOpenUrl(""); setPreviewBlob(null); setPreviewSignature(""); setPreviewError("");
    setSnapshot(row.snapshot); setContent(restoredContent);
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

  const editor = (slide: number) => {
    if (!snapshot) return <p className="text-sm text-[var(--muted-foreground)]">Generate or open a report before editing its slide content.</p>;
    if (slide === 1) return <p className="text-sm text-[var(--muted-foreground)]">The cover slide is populated automatically using the logged-in editor’s name, the report date, the SEO/GEO project operations label and the tracked brand name.</p>;
    if (slide === 2) return <div className="grid gap-4"><p className="text-xs text-[var(--muted-foreground)]">KPI values are populated from the tracking database. Knowledge asset counts require a future website-audit integration.</p><Field label="Improvements made during this period" value={content.summaryDone} onChange={v=>update("summaryDone",v)} multiline /><Field label="Where to focus next period" value={content.summaryFocus} onChange={v=>update("summaryFocus",v)} multiline /><Field label="Knowledge assets (count)" value={content.knowledgeAssets} onChange={v=>update("knowledgeAssets",v)} placeholder="Enter audited count" /></div>;
    if (slide === 3) return <p className="text-sm text-[var(--muted-foreground)]">Visibility trend, latest overall score and category scores are populated from visibility_daily. Category cards adapt to this brand's configured categories ({categories.length}).</p>;
    if (slide === 4) return <div className="grid gap-4">{snapshot.competitors.map(row => { const detail = content.competitorDetails[row.name] ?? { knowledgeAssets: "", knowledgeDescription: "", externalTotal: "", news: "", directories: "", websites: "", social: "" }; return <section key={row.name} className="rounded-xl border border-[var(--line)] p-3"><h4 className="mb-3 text-sm font-bold">{row.name}{row.isTracked ? " (tracked brand)" : ""}</h4><div className="grid gap-3 sm:grid-cols-2"><Field label="Knowledge assets (count)" value={detail.knowledgeAssets} onChange={v=>updateCompetitorDetail(row.name,"knowledgeAssets",v)} /><Field label="Knowledge assets description" value={detail.knowledgeDescription} onChange={v=>updateCompetitorDetail(row.name,"knowledgeDescription",v)} /><Field label="External presence total" value={detail.externalTotal} onChange={v=>updateCompetitorDetail(row.name,"externalTotal",v)} /><Field label="News" value={detail.news} onChange={v=>updateCompetitorDetail(row.name,"news",v)} /><Field label="Directories" value={detail.directories} onChange={v=>updateCompetitorDetail(row.name,"directories",v)} /><Field label="Websites" value={detail.websites} onChange={v=>updateCompetitorDetail(row.name,"websites",v)} /><Field label="Social media" value={detail.social} onChange={v=>updateCompetitorDetail(row.name,"social",v)} /></div></section>; })}<p className="text-xs text-[var(--muted-foreground)]">Only visibility, share of voice and citation totals are filled automatically. Knowledge assets and external presence, including their descriptions and breakdowns, are manual audit fields.</p></div>;
    if (slide === 5) return <p className="text-sm text-[var(--muted-foreground)]">Citation counts and cited pages are loaded per category and filtered to the tracked brand domains. The preview displays up to seven of the most-cited brand pages.</p>;
    if (slide === 6) return <div className="grid gap-4">{AREAS.map(a=><section key={a} className="rounded-xl border border-[var(--line)] p-3"><h4 className="mb-3 text-sm font-bold">{a}</h4>{(content.progress[a] ?? ["","",""]).map((v,i)=><div key={i} className="flex items-end gap-2"><div className="min-w-0 flex-1"><Field label={"Progress " + (i+1)} value={v} onChange={value=>updateProgress(a,i,value)} placeholder="Describe work completed" /></div><button type="button" className="platform-btn mb-0.5" disabled={(content.progress[a] ?? []).length<=1} onClick={()=>removeProgress(a,i)} aria-label={"Remove progress item "+(i+1)}>Remove</button></div>)}<button type="button" className="platform-btn mt-3" onClick={()=>addProgress(a)}><Plus size={14}/> Add item</button></section>)}</div>;
    if (slide === 7) return <div className="grid gap-3">{content.initiatives.map((v,i)=><section key={i} className="grid gap-3 rounded-xl border border-[var(--line)] p-3 sm:grid-cols-2"><Field label="Area" value={v.area} onChange={value=>updateInitiative(i,"area",value)} /><Field label="Initiative" value={v.title} onChange={value=>updateInitiative(i,"title",value)} /><div className="sm:col-span-2"><Field label="Description" value={v.description} onChange={value=>updateInitiative(i,"description",value)} multiline /></div></section>)}</div>;
    if (slide === 8) return <div className="grid gap-3">{content.actions.map((v,i)=><section key={i} className="rounded-xl border border-[var(--line)] p-3"><div className="mb-3 flex items-center justify-between gap-2"><b className="text-sm">{["Week 1","Week 2","Week 3","Week 4","Ongoing"][i]}</b></div><div className="grid gap-3 sm:grid-cols-2">{(["website","knowledge","branding","community","monitoring"] as const).map(k=><Field key={k} label={k[0].toUpperCase()+k.slice(1)} value={v[k]} onChange={value=>updateAction(i,k,value)} />)}</div></section>)}</div>;
    if (slide === 9) return <div className="grid gap-3 sm:grid-cols-2">{["Overall",...categories].map(c=><section key={c} className="rounded-xl border border-[var(--line)] p-3"><b className="mb-2 block text-sm">{c}</b><Field label="Target visibility score (%)" value={content.targets[c]?.score ?? ""} onChange={v=>updateTarget(c,v)} placeholder="e.g. 25" /></section>)}</div>;
    return <p className="text-sm text-[var(--muted-foreground)]">No additional information is required for this slide.</p>;
  };

  return <ProjectShell>
    <div className="ops-page">
      <header className="page-heading"><p className="page-eyebrow">Client Deliverables</p><h1 className="page-title mt-1">Reports</h1><p className="page-description mt-2">Create client-ready reports from tracking data. Export PowerPoint to retain the supplied 10-slide template design, artwork and formatting.</p></header>
      <section className="mt-6 flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-[var(--line)] bg-[var(--card)] p-4 sm:p-5"><div><h2 className="font-bold">Monthly report PowerPoint template</h2><p className="mt-1 text-xs text-[var(--muted-foreground)]">Canonical 10-slide template stored in platform storage.</p>{templateNotice && <p className="mt-2 text-xs text-amber-700">{templateNotice}</p>}</div>{templateExists ? <a className="platform-btn platform-btn-primary" href={templateDownloadUrl} download="Client_Monthly_Report_Template.pptx"><Download size={14}/> Download template</a> : <button type="button" className="platform-btn platform-btn-primary" disabled title="The monthly report template is not available in platform storage"><Download size={14}/> Download template</button>}</section>
      <section className="mt-6 rounded-2xl border border-[var(--line)] bg-[var(--card)] p-4 sm:p-5">
        <div className="flex flex-wrap items-center justify-between gap-3"><h2 className="text-base font-bold">Report type</h2><span className="text-xs text-[var(--muted-foreground)]">5 report formats</span></div>
        <div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-5">{TYPES.map(t=><button key={t.id} onClick={()=>{setReportType(t.id);setSnapshot(null);setActiveId(null);setError("");setNotice("");}} className={"rounded-xl border p-3 text-left transition "+(reportType===t.id?"border-[var(--primary)] bg-[var(--accent)] ring-1 ring-[var(--primary)]":"border-[var(--line)] hover:bg-[var(--accent)]")}><div className="flex items-center justify-between gap-2"><b className="text-sm">{t.name}</b>{t.ready?<span className="monthly-ready">Available</span>:<span className="monthly-soon">Coming soon</span>}</div><p className="mt-2 text-xs leading-5 text-[var(--muted-foreground)]">{t.description}</p></button>)}</div>
        {reportType==="monthly"?<div className="mt-5 flex flex-wrap items-end gap-3 border-t border-[var(--line)] pt-4"><label className="block"><span className="mb-1.5 block text-xs font-semibold text-[var(--muted-foreground)]">Start date</span><input className="platform-input text-sm" type="date" min={MIN_TRACKING_DATE} max={end} value={start} onChange={e=>setStart(e.target.value)} /></label><label className="block"><span className="mb-1.5 block text-xs font-semibold text-[var(--muted-foreground)]">End date</span><input className="platform-input text-sm" type="date" min={start} max={malaysiaDateString()} value={end} onChange={e=>setEnd(e.target.value)} /></label><button className="platform-btn platform-btn-primary ml-auto" disabled={loading} onClick={generate}>{loading?<Loader2 size={15} className="animate-spin"/>:<Sparkles size={15}/>} Generate monthly report</button></div>:<div className="mt-5 rounded-xl border border-dashed border-[var(--line)] p-5 text-center text-sm text-[var(--muted-foreground)]">This report format is planned for a future development stage.</div>}
      </section>
      {error&&<div className="sample-error mt-4 rounded-xl p-3 text-sm">{error}</div>}{notice&&<div className="platform-notice-success mt-4 rounded-xl p-3 text-sm">{notice}</div>}
      {snapshot&&<section className="mt-6">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <div><h2 className="text-lg font-bold">Monthly report editor</h2><p className="text-xs text-[var(--muted-foreground)]">{snapshot.brand.name} · {snapshot.period.start} to {snapshot.period.end} · {trackingLocationLabel(snapshot.location)}</p></div>
          <div className="flex flex-wrap gap-2">
            <button className="platform-btn" disabled={previewLoading || !templateExists} onClick={() => void refreshPowerPointPreview()}>{previewLoading?<Loader2 size={14} className="animate-spin"/>:<RefreshCw size={14}/>} Refresh PowerPoint preview</button>
            <button className="platform-btn" disabled={!previewOpenUrl} onClick={() => previewOpenUrl && window.open(previewOpenUrl, "_blank", "noopener,noreferrer")}><ExternalLink size={14}/> Open preview</button>
            <button className="platform-btn" disabled={!previewOpenUrl} title="Open the actual PowerPoint in the Office viewer, then use its Print command and choose Save as PDF." onClick={() => previewOpenUrl && window.open(previewOpenUrl, "_blank", "noopener,noreferrer")}><Printer size={14}/> Print / Save PDF</button>
            <button className="platform-btn platform-btn-primary" disabled={exportingPptx || !templateExists} title={!templateExists ? "The revised template is not yet available in platform storage" : undefined} onClick={exportPowerPoint}>{exportingPptx?<Loader2 size={14} className="animate-spin"/>:<Download size={14}/>} Export PowerPoint</button>
            <button className="platform-btn" onClick={closeDraft}><X size={14}/> Close draft</button>
            <button className="platform-btn platform-btn-primary" disabled={saving || !canEdit} title={!canEdit ? "Only project editors can save reports" : undefined} onClick={save}>{saving?<Loader2 size={14} className="animate-spin"/>:<Save size={14}/>} Save draft</button>
          </div>
          {!canEdit&&<p className="w-full text-right text-xs text-[var(--muted-foreground)]">You have read-only access to reports.</p>}
        </div>
        <div className="mb-4 flex gap-2 overflow-x-auto pb-2">{slides.map((name,i)=><a key={name} href={"#monthly-slide-"+(i+1)} onClick={()=>setCollapsedSlides(prev=>({...prev,[i+1]:false}))} className="shrink-0 rounded-lg border border-[var(--line)] px-3 py-2 text-xs hover:bg-[var(--accent)]">{i+1}. {name}</a>)}</div>
        <section className="mb-6 overflow-hidden rounded-2xl border border-[var(--line)] bg-[var(--card)]">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[var(--line)] p-4"><div><h3 className="font-bold">PowerPoint preview</h3><p className="mt-1 text-xs text-[var(--muted-foreground)]">Rendered from the same generated .pptx file used for export.</p></div><span className={previewIsCurrent?"monthly-ready":"monthly-soon"}>{previewIsCurrent?"Preview up to date":"Preview needs refreshing"}</span></div>
          {previewError && <p className="px-4 pt-3 text-sm text-red-600">{previewError}</p>}
          {previewViewerUrl ? <iframe key={previewViewerUrl} title="Generated PowerPoint report preview" src={previewViewerUrl} className="h-[760px] w-full bg-white" allowFullScreen /> : <div className="flex min-h-64 flex-col items-center justify-center gap-2 p-6 text-center text-sm text-[var(--muted-foreground)]"><p>{previewLoading ? "Preparing the PowerPoint preview…" : "Refresh PowerPoint preview to render the original template with this report's data."}</p></div>}
          <p className="border-t border-[var(--line)] p-3 text-xs text-[var(--muted-foreground)]">The preview opens in Microsoft Office for the web. To create a PDF, open the preview and use its Print command, then select Save as PDF. The HTML slide mock-up is no longer used.</p>
        </section>
        <div className="monthly-slides-list">{slides.map((name,i)=><section id={"monthly-slide-"+(i+1)} key={name} className="monthly-slide-editor">
          <button type="button" className="monthly-editor-toolbar flex w-full items-center justify-between gap-3 text-left" aria-expanded={!collapsedSlides[i+1]} onClick={()=>setCollapsedSlides(prev=>({...prev,[i+1]:!prev[i+1]}))}><div><span className="text-xs text-[var(--muted-foreground)]">Slide {i+1} of 10</span><h3 className="font-bold">{name}</h3></div><ChevronDown size={18} className={"shrink-0 transition-transform "+(collapsedSlides[i+1]?"":"rotate-180")}/></button>
          {!collapsedSlides[i+1] && <div className="monthly-form-panel w-full"><h4 className="mb-3 text-sm font-bold">Slide information</h4>{editor(i+1)}</div>}
        </section>)}</div>
        
      </section>}
      <section className="mt-8 rounded-2xl border border-[var(--line)] bg-[var(--card)] p-4 sm:p-5"><div className="mb-4 flex items-center justify-between"><h2 className="font-bold">Saved Reports</h2><span className="text-xs text-[var(--muted-foreground)]">{saved.length} saved</span></div>{saved.length===0?<p className="text-sm text-[var(--muted-foreground)]">No saved client reports yet.</p>:<div className="overflow-x-auto"><table className="platform-table"><thead><tr><th>Created</th><th>Type</th><th>Period</th><th>Status</th><th /></tr></thead><tbody>{saved.map(r=><tr key={r.id}><td>{new Date(r.created_at).toLocaleDateString("en-MY")}</td><td>{TYPES.find(t=>t.id===r.report_type)?.name ?? r.report_type}</td><td>{r.period_start} – {r.period_end}</td><td><span className="monthly-ready">Draft</span></td><td className="text-right"><div className="flex justify-end gap-2"><button className="platform-btn" onClick={()=>openSaved(r)}>Open</button><button className="platform-btn" disabled={!canEdit || Boolean(deletingId)} title={!canEdit ? "Only project editors can delete drafts" : "Permanently delete this draft"} onClick={()=>void deleteDraft(r)}>{deletingId === r.id ? <Loader2 size={14} className="animate-spin"/> : <Trash2 size={14}/>} Delete</button></div></td></tr>)}</tbody></table></div>}</section>
    </div>
  </ProjectShell>;
}
