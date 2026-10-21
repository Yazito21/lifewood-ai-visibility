"use client";

import { useEffect, useState } from "react";
import { ArrowRight, Download, FileSpreadsheet, FolderKanban, LogOut, Plus, ShieldCheck, Trash2, Upload, X } from "lucide-react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";
import { downloadBrandTemplate, parseBrandWorkbook, saveProjectBrandRegistry, validateBrandRows, type BrandImportRow } from "@/lib/brand-registry";

type Project={id:string;brand_name:string;brand_description:string|null;brand_logo_url:string|null;tracking_market:string};

export default function ProjectsPage(){
  const router=useRouter();
  const [projects,setProjects]=useState<Project[]>([]);
  const [latest,setLatest]=useState<Record<string,{rank:number|null;score:number|null}>>({});
  const [role,setRole]=useState<"superadmin"|"admin"|"viewer"|null>(null);
  const [loading,setLoading]=useState(true);
  const [error,setError]=useState("");
  const [creating,setCreating]=useState(false);
  const [brandName,setBrandName]=useState("");
  const [description,setDescription]=useState("");
  const [trackedWebsite,setTrackedWebsite]=useState("");
  const [topicsText,setTopicsText]=useState("Data Collection, Data Annotation, AIGC, AEO/GEO");
  const [brandFile,setBrandFile]=useState<File|null>(null);
  const [brandRows,setBrandRows]=useState<BrandImportRow[]>([]);
  const [fileTopics,setFileTopics]=useState<string[]>([]);
  const [fileMessage,setFileMessage]=useState("");
  const [busy,setBusy]=useState(false);
  const [deleteTarget,setDeleteTarget]=useState<Project|null>(null);
  const [confirmName,setConfirmName]=useState("");

  async function load(){
    setLoading(true); setError("");
    const {data:{user}}=await supabase.auth.getUser();
    if(!user){router.replace("/login");return}
    const {data:profile,error:profileError}=await supabase.from("profiles").select("role").eq("id",user.id).single();
    if(profileError||!profile){setError("Your account profile could not be loaded.");setLoading(false);return}
    setRole(profile.role);
    const {data,error}=await supabase.from("projects").select("id,brand_name,brand_description,brand_logo_url,tracking_market").order("brand_name");
    if(error){setError(error.message);setLoading(false);return}
    setProjects(data??[]);
    const ids=(data??[]).map(x=>x.id);
    if(ids.length){
      const {data:metrics}=await supabase.from("visibility_daily").select("project_id,tracking_location,visibility_rank,visibility_score,metric_date").eq("llm_provider","Overall").in("project_id",ids).order("metric_date",{ascending:false});
      const map:Record<string,{rank:number|null;score:number|null}>={};
      const projectById=new Map((data??[]).map(project=>[project.id,project]));
      for(const m of metrics??[]){const project=projectById.get(m.project_id);if(project&&m.tracking_location===project.tracking_market&&!map[m.project_id]) map[m.project_id]={rank:m.visibility_rank,score:m.visibility_score};}
      setLatest(map);
    } else setLatest({});
    setLoading(false);
  }
  useEffect(()=>{load()},[router]);

  const canCreate=role==="superadmin"||role==="admin";

  function currentTopics(){return [...new Set(topicsText.split(/[;,]/).flatMap((part) => part.split(String.fromCharCode(10))).map(v=>v.trim()).filter(Boolean))]}
  async function handleBrandFile(file:File|null){
    setBrandFile(file);setBrandRows([]);setFileTopics([]);setFileMessage("");setError("");
    if(!file)return;
    try{
      const parsed=parseBrandWorkbook(await file.arrayBuffer());
      setBrandRows(parsed.rows);setFileTopics(parsed.topics);
      const topics=currentTopics();
      const errors=validateBrandRows(parsed.rows,topics,brandName,true);
      const workbookTopics=new Set(parsed.topics);
      if(topics.some(topic=>!workbookTopics.has(topic))||parsed.topics.some(topic=>!topics.includes(topic))){
        errors.unshift("The workbook Topics sheet must match the topics entered above.");
      }
      setFileMessage(errors.length?errors.slice(0,5).join(" "):`Validated ${parsed.rows.length} brand-topic rows across ${topics.length} topics.`);
      if(errors.length)setError(errors.join("\\n"));
    }catch(e){setError(e instanceof Error?e.message:"Unable to read this Excel workbook.");}
  }
  async function createProject(){
    if(!brandName.trim())return;
    const topics=currentTopics();
    if(!topics.length){setError("Add at least one tracking topic.");return;}
    if(!brandFile){setError("Upload the completed brand registry Excel workbook before creating the project.");return;}
    let parsed:{topics:string[];rows:BrandImportRow[]};
    try{parsed=parseBrandWorkbook(await brandFile.arrayBuffer())}catch(e){setError(e instanceof Error?e.message:"Unable to read the Excel workbook.");return;}
    const validation=validateBrandRows(parsed.rows,topics,brandName,true);
    if(topics.some(topic=>!parsed.topics.includes(topic))||parsed.topics.some(topic=>!topics.includes(topic)))validation.unshift("The workbook Topics sheet must match the topics entered above.");
    if(validation.length){setError(validation.join("\\n"));setFileMessage("The registry has validation errors. Fix them in Excel and upload the workbook again.");return;}
    setBusy(true);setError("");
    const {data:{user}}=await supabase.auth.getUser();
    if(!user){router.replace("/login");return}
    const normalizedWebsite=trackedWebsite.trim();
    const {data:project,error:projectError}=await supabase.from("projects").insert({
      brand_name:brandName.trim(),brand_description:description.trim()||null,
      brand_domains:normalizedWebsite?[normalizedWebsite]:[],brand_terms:[],topics,created_by:user.id
    }).select().single();
    if(projectError||!project){setError(projectError?.message??"Unable to create project.");setBusy(false);return}
    const memberRole=role==="superadmin"?"superadmin":"admin";
    const {error:memberError}=await supabase.from("project_members").insert({project_id:project.id,user_id:user.id,role:memberRole});
    if(memberError){await supabase.from("projects").delete().eq("id",project.id);setError(memberError.message);setBusy(false);return}
    try{
      await saveProjectBrandRegistry(supabase,project.id,brandName.trim(),topics,parsed.rows,normalizedWebsite);
    }catch(e){
      await supabase.from("projects").delete().eq("id",project.id);
      setError("Project setup failed and the incomplete project was removed: "+(e instanceof Error?e.message:"Unable to save the brand registry."));
      setBusy(false);return;
    }
    setBrandName("");setDescription("");setTrackedWebsite("");setTopicsText("");setBrandFile(null);setBrandRows([]);setFileTopics([]);setFileMessage("");setCreating(false);setBusy(false);
    router.push("/platform/"+project.id);
  }

  async function deleteProject(){
    if(!deleteTarget||confirmName!==deleteTarget.brand_name)return;
    setBusy(true);setError("");
    const {error}=await supabase.from("projects").delete().eq("id",deleteTarget.id);
    if(error){setError(error.message)} else {setProjects(v=>v.filter(p=>p.id!==deleteTarget.id));setDeleteTarget(null);setConfirmName("")}
    setBusy(false);
  }

  async function signOut(){await supabase.auth.signOut();router.replace("/login")}

  return <div className="min-h-screen min-w-0 bg-[var(--background)] text-[var(--foreground)]">
    <header className="relative overflow-hidden border-b border-[var(--border)] bg-[var(--lw-dark-serpent)] text-white shadow-[0_10px_35px_rgba(19,48,32,0.16)]">
      <div className="pointer-events-none absolute inset-0 opacity-25 [background-image:linear-gradient(rgba(255,255,255,.055)_1px,transparent_1px),linear-gradient(90deg,rgba(255,255,255,.055)_1px,transparent_1px)] [background-size:28px_28px]" />
      <div className="pointer-events-none absolute -right-20 -top-24 h-64 w-64 rounded-full bg-[var(--lw-saffaron)]/10 blur-3xl" />
      <div className="relative mx-auto flex min-h-[82px] w-full max-w-[1500px] items-center justify-between gap-4 px-4 py-4 sm:px-7 lg:px-8">
        <div className="flex min-w-0 items-center gap-3">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-white/15 bg-white/5 text-[var(--lw-saffaron)]"><FolderKanban size={20}/></div>
          <div className="min-w-0">
            <h1 className="truncate text-base font-semibold tracking-tight sm:text-lg">AI Visibility Project Platform</h1>
            <div className="mt-1 flex items-center gap-2 text-[9px] font-semibold uppercase tracking-[0.18em] text-white/50 sm:text-[10px]"><span className="h-1.5 w-1.5 rounded-full bg-[var(--lw-saffaron)]" /> Cross-project workspace</div>
          </div>
        </div>
        <div className="hidden shrink-0 items-center gap-2 sm:flex">
          {role&&<span className="rounded-full border border-white/10 bg-white/5 px-3 py-1.5 text-[11px] font-medium capitalize text-white/70"><ShieldCheck size={13} className="mr-1 inline"/>{role}</span>}
        </div>
      </div>
    </header>

    <main className="mx-auto w-full max-w-[1500px] px-4 py-8 sm:px-7 lg:px-8 lg:py-10">
      <header className="flex flex-col gap-5 border-b border-[var(--line)] pb-8 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="page-eyebrow">Workspace</p>
          <h2 className="page-title mt-1">Home</h2>
          <p className="page-description mt-2">Your cross-project overview of AI visibility workspaces, tracked brands and daily intelligence.</p>
        </div>
        <div className="flex flex-col gap-2 sm:items-end">
          {canCreate&&<button onClick={()=>setCreating(true)} className="inline-flex items-center justify-center gap-2 rounded-xl bg-[var(--primary)] px-4 py-3 text-sm font-semibold text-[var(--primary-foreground)] transition hover:opacity-90"><Plus size={17}/> New project</button>}
          <button onClick={signOut} className="platform-btn sm:hidden"><LogOut size={16}/> Log out</button>
        </div>
      </header>

      {error&&<div className="mt-6 rounded-2xl border border-red-200 bg-red-50 px-5 py-4 text-sm text-red-700">{error}</div>}
      {loading?<div className="mt-8 flex min-h-40 items-center justify-center rounded-3xl border border-[var(--line)] bg-[var(--card)] text-sm text-[var(--muted-foreground)]">Loading workspaces…</div>:
      projects.length===0?<div className="mt-8 rounded-3xl border border-dashed border-[var(--line)] bg-[var(--card)] p-12 text-center"><FolderKanban className="mx-auto text-[var(--primary)]" size={38}/><h3 className="mt-4 text-xl font-semibold">No projects available</h3><p className="mx-auto mt-2 max-w-md text-sm leading-6 text-[var(--muted-foreground)]">{role==="superadmin"?"Create the first brand project to begin tracking AI visibility.":"No projects have been assigned to your account yet."}</p>{canCreate&&<button onClick={()=>setCreating(true)} className="platform-btn platform-btn-primary mt-5"><Plus size={16}/> Create project</button>}</div>:
      <>
        <section className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <div className="platform-card p-5"><p className="platform-stat-label">Brand Projects</p><p className="platform-stat-value">{projects.length}</p><p className="platform-stat-meta">Accessible workspaces</p></div>
          <div className="platform-card p-5"><p className="platform-stat-label">Tracked Projects</p><p className="platform-stat-value">{Object.keys(latest).length}</p><p className="platform-stat-meta">With daily visibility data</p></div>
          <div className="platform-card p-5"><p className="platform-stat-label">Execution-ready engines</p><p className="platform-stat-value">1</p><p className="platform-stat-meta">ChatGPT runner available; additional engines are planned</p></div>
          <div className="platform-card p-5"><p className="platform-stat-label">Prompt Limit</p><p className="platform-stat-value">100</p><p className="platform-stat-meta">Per project</p></div>
        </section>

        <section className="mt-8">
          <div className="flex items-end justify-between gap-4">
            <div><p className="page-eyebrow">Workspaces</p><h2 className="mt-1 text-xl font-semibold">Projects</h2><p className="mt-1 text-sm text-[var(--muted-foreground)]">Select a project to open its AI visibility workspace.</p></div>
            <FolderKanban className="text-[var(--primary)]" size={24}/>
          </div>
          <div className="mt-5 grid gap-5 md:grid-cols-2 lg:grid-cols-3">
            {projects.map(project=><article key={project.id} className="platform-card group cursor-pointer p-6 transition hover:-translate-y-0.5 hover:shadow-lg focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-[var(--primary)]" role="link" tabIndex={0} aria-label={"Open " + project.brand_name + " project"} onClick={() => router.push("/platform/" + project.id)} onKeyDown={event => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); router.push("/platform/" + project.id); } }}>
              <div className="flex items-start justify-between gap-4">
                <div className="flex h-16 w-16 items-center justify-center overflow-hidden rounded-2xl border border-white/70 bg-white font-black text-lg text-[var(--primary)] shadow-sm">{project.brand_logo_url?<img src={project.brand_logo_url} alt="" className="h-full w-full bg-white object-contain p-1.5"/>:"AI"}</div>
                <ArrowRight className="text-[#c3ccc6] transition group-hover:translate-x-1 group-hover:text-[var(--primary)]" size={19}/>
              </div>
              <h3 className="mt-6 text-lg font-semibold">{project.brand_name}</h3>
              <p className="mt-2 text-sm leading-6 text-[var(--muted-foreground)]">{project.brand_description||"Brand workspace for AI visibility monitoring, citations, competitors and prompt tracking."}</p>
              <div className="mt-5 flex items-center justify-between gap-3">
                <span className="inline-flex rounded-full bg-emerald-50 px-3 py-1 text-xs font-semibold text-[var(--primary)]">{latest[project.id]?"Tracked":"Active"}</span>
                <span className="text-xs font-medium text-[var(--muted-foreground)]">Open workspace <ArrowRight size={14} className="ml-1 inline transition group-hover:translate-x-1"/></span>
              </div>
            </article>)}
          </div>
        </section>
      </>}
    </main>

    {creating&&<div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-5" onMouseDown={e=>{if(e.currentTarget===e.target)setCreating(false)}}>
      <form onSubmit={e=>{e.preventDefault();void createProject()}} className="max-h-[90vh] w-full max-w-2xl overflow-y-auto rounded-3xl border border-[var(--line)] bg-[var(--card)] p-7 shadow-2xl">
        <div className="flex items-start justify-between gap-4"><div><p className="page-eyebrow">Workspace</p><h3 className="mt-1 text-2xl font-semibold">Create project</h3><p className="mt-2 text-sm text-[var(--muted-foreground)]">Add the client company name and an optional summary.</p></div><button type="button" onClick={()=>setCreating(false)} className="platform-btn px-3"><X size={18}/></button></div>
        <div className="mt-6 space-y-5"><label className="block text-sm font-semibold">Tracked brand name<input value={brandName} onChange={e=>setBrandName(e.target.value)} placeholder="e.g. Lifewood" className="platform-input mt-2"/></label><label className="block text-sm font-semibold">Tracked brand primary website<input value={trackedWebsite} onChange={e=>setTrackedWebsite(e.target.value)} placeholder="e.g. lifewood.com" className="platform-input mt-2"/></label><label className="block text-sm font-semibold">Company summary <span className="font-normal text-[var(--muted-foreground)]">(optional)</span><textarea value={description} onChange={e=>setDescription(e.target.value)} rows={3} placeholder="Briefly describe the company and its services." className="platform-input mt-2 resize-y leading-6"/></label><label className="block text-sm font-semibold">Tracking topics <span className="font-normal text-[var(--muted-foreground)]">(separate with commas or new lines)</span><textarea value={topicsText} onChange={e=>setTopicsText(e.target.value)} rows={3} placeholder="Data Collection, Data Annotation, AIGC" className="platform-input mt-2 resize-y leading-6"/></label><div className="rounded-2xl border border-[var(--line)] bg-[var(--soft)] p-4"><div className="flex items-start gap-3"><FileSpreadsheet size={20} className="mt-0.5 shrink-0 text-[var(--primary)]"/><div className="min-w-0 flex-1"><h4 className="text-sm font-semibold">Competitor registry workbook</h4><p className="mt-1 text-xs leading-5 text-[var(--muted-foreground)]">Upload one Excel workbook with Topics and Brands sheets. Each topic must contain exactly 100 entries: your tracked brand and 99 competitors.</p><div className="mt-3 flex flex-wrap gap-2"><button type="button" onClick={()=>downloadBrandTemplate(currentTopics(),brandName.trim()||"Tracked Brand",trackedWebsite)} disabled={!currentTopics().length} className="platform-btn text-xs disabled:opacity-40"><Download size={14}/>Download Excel template</button><label className="inline-flex cursor-pointer items-center gap-2 rounded-xl border border-[var(--line)] bg-[var(--card)] px-3 py-2 text-xs font-semibold"><Upload size={14}/>{brandFile?brandFile.name:"Upload completed workbook"}<input type="file" accept=".xlsx,.xls,.csv" className="sr-only" onChange={e=>{void handleBrandFile(e.target.files?.[0]??null);e.currentTarget.value="";}}/></label></div>{fileMessage&&<p className={`mt-3 text-xs ${fileMessage.startsWith("Validated")?"text-emerald-700":"text-amber-700"}`}>{fileMessage}</p>}</div></div></div></div>
        <div className="mt-7 flex flex-col-reverse gap-3 sm:flex-row sm:justify-end"><button type="button" onClick={()=>setCreating(false)} className="platform-btn">Cancel</button><button disabled={busy||!brandName.trim()||!brandFile} className="platform-btn platform-btn-primary disabled:opacity-50">{busy?"Creating…":"Create project"}</button></div>
      </form>
    </div>}

    {deleteTarget&&<div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-5"><div className="w-full max-w-lg rounded-3xl border border-[var(--line)] bg-[var(--card)] p-7 shadow-2xl"><div className="flex items-start gap-4"><div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-red-50 text-[var(--danger)]"><Trash2 size={20}/></div><div><h3 className="text-2xl font-semibold">Delete “{deleteTarget.brand_name}”?</h3><p className="mt-2 text-sm leading-6 text-[var(--muted-foreground)]">This permanently removes the project data.</p></div></div><label className="mt-6 block text-sm font-semibold">Type the project name<input value={confirmName} onChange={e=>setConfirmName(e.target.value)} className="platform-input mt-2"/></label><div className="mt-7 flex justify-end gap-3"><button onClick={()=>{setDeleteTarget(null);setConfirmName("")}} className="platform-btn">Cancel</button><button onClick={()=>void deleteProject()} disabled={busy||confirmName!==deleteTarget.brand_name} className="platform-btn platform-btn-danger disabled:opacity-40">{busy?"Deleting…":"Delete project"}</button></div></div></div>}
  </div>
}
