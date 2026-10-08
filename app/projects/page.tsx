"use client";

import { useEffect, useMemo, useState } from "react";
import { FolderKanban, LogOut, Plus, ShieldCheck, Trash2, ArrowRight, X } from "lucide-react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";

type Project={id:string;brand_name:string;brand_description:string|null;brand_logo_url:string|null};

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
  const [busy,setBusy]=useState(false);
  const [deleteTarget,setDeleteTarget]=useState<Project|null>(null);
  const [confirmName,setConfirmName]=useState("");

  const canCreate=role==="superadmin"||role==="admin";

  async function load(){
    setLoading(true); setError("");
    const {data:{user}}=await supabase.auth.getUser();
    if(!user){router.replace("/login");return}
    const {data:profile,error:profileError}=await supabase.from("profiles").select("role").eq("id",user.id).single();
    if(profileError||!profile){setError("Your account profile could not be loaded.");setLoading(false);return}
    setRole(profile.role);
    const {data,error}=await supabase.from("projects").select("id,brand_name,brand_description,brand_logo_url").order("brand_name");
    if(error) setError(error.message); else setProjects(data??[]);
    setLoading(false);
  }

  useEffect(()=>{load()},[]);

  const emptyMessage=useMemo(()=>role==="superadmin"?"No projects yet. Create the first brand project.":"No projects have been assigned to your account.",[role]);

  async function createProject(){
    if(!brandName.trim())return;
    setBusy(true);setError("");
    const {data:{user}}=await supabase.auth.getUser();
    if(!user){router.replace("/login");return}
    const {data:project,error:projectError}=await supabase.from("projects").insert({brand_name:brandName.trim(),brand_description:description.trim()||null,created_by:user.id}).select().single();
    if(projectError||!project){setError(projectError?.message??"Unable to create project.");setBusy(false);return}
    const memberRole=role==="superadmin"?"superadmin":"admin";
    const {error:memberError}=await supabase.from("project_members").insert({project_id:project.id,user_id:user.id,role:memberRole});
    if(memberError){await supabase.from("projects").delete().eq("id",project.id);setError(memberError.message);setBusy(false);return}
    setBrandName("");setDescription("");setCreating(false);setBusy(false);
    router.push("/platform/"+project.id);
  }

  async function deleteProject(){
    if(!deleteTarget||confirmName!==deleteTarget.brand_name)return;
    setBusy(true);setError("");
    const {error}=await supabase.from("projects").delete().eq("id",deleteTarget.id);
    if(error){setError(error.message)} else {setProjects(v=>v.filter(p=>p.id!==deleteTarget.id));setDeleteTarget(null);setConfirmName("")}
    setBusy(false);
  }

  async function signOut(){
    await supabase.auth.signOut();router.replace("/login");
  }

  return <main className="min-h-screen bg-[var(--paper)]">
    <header className="border-b border-[var(--line)] bg-white">
      <div className="mx-auto flex max-w-[1500px] items-center justify-between gap-4 px-4 py-4 sm:px-6 lg:px-8">
        <div><div className="page-eyebrow">Lifewood</div><div className="text-lg font-bold">AI Visibility</div></div>
        <div className="flex items-center gap-2">
          {role&&<div className="hidden sm:inline-flex items-center gap-2 rounded-full bg-[var(--soft)] px-3 py-2 text-xs font-extrabold capitalize text-[var(--green)]"><ShieldCheck size={14} className="text-[var(--green)]"/>{role}</div>}
          <button onClick={signOut} className="platform-btn"><LogOut size={16}/> Sign out</button>
        </div>
      </div>
    </header>

    <div className="mx-auto max-w-[1500px] px-4 py-7 sm:px-6 lg:px-8 lg:py-9">
      <div className="flex flex-col justify-between gap-5 sm:flex-row sm:items-end">
        <div><p className="page-eyebrow">Project Selection</p><h1 className="page-title mt-1">Select a brand project</h1><p className="page-description mt-2">Only projects your account can access are shown here.</p></div>
        {canCreate&&<button onClick={()=>setCreating(true)} className="platform-btn platform-btn-primary"><Plus size={17}/> Create project</button>}
      </div>

      {error&&<div className="mt-6 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>}

      {loading?<div className="mt-10 grid gap-5 md:grid-cols-2 xl:grid-cols-3"><div className="h-48 animate-pulse rounded-2xl bg-white"/><div className="h-48 animate-pulse rounded-2xl bg-white"/><div className="h-48 animate-pulse rounded-2xl bg-white"/></div>:
      projects.length===0?<div className="mt-10 rounded-3xl border border-dashed border-[#cbd4cd] bg-white p-12 text-center"><FolderKanban className="mx-auto text-[var(--green)]" size={36}/><h2 className="mt-4 text-xl font-semibold">{emptyMessage}</h2><p className="mx-auto mt-2 max-w-md text-sm leading-6 text-[#66736c]">Projects become the container for the brand, prompts, LLM configurations, daily AI responses and analytics.</p></div>:
      <div className="mt-8 grid gap-5 md:grid-cols-2 xl:grid-cols-3">
        {projects.map(p=><article key={p.id} className="group rounded-2xl border border-[var(--line)] bg-white p-5 shadow-sm transition hover:-translate-y-0.5 hover:shadow-lg sm:p-6">
          <div className="flex items-start justify-between gap-4"><div className="flex h-12 w-12 items-center justify-center overflow-hidden rounded-2xl bg-[var(--soft)] text-[var(--green)] font-bold">{p.brand_logo_url?<img src={p.brand_logo_url} alt="" className="h-full w-full object-cover"/>:"AI"}</div><span className="rounded-full bg-[#fff5e0] px-3 py-1 text-xs font-bold text-[#8c5d13]">{latest[p.id]?"Tracked":"No data"}</span></div>
          <h2 className="mt-6 text-2xl font-semibold">{p.brand_name}</h2>
          <p className="mt-2 min-h-12 text-sm leading-6 text-[#66736c]">{p.brand_description||"No brand description has been added yet."}</p>
          <div className="mt-7 rounded-2xl bg-[var(--paper)] p-4"><div className="text-xs uppercase tracking-[0.15em] text-[#66736c]">Latest Rank & Score</div><div className="mt-2 flex items-end gap-3"><span className="text-3xl font-semibold">{latest[p.id]?.rank??"—"}</span><span className="pb-1 text-sm text-[#66736c]">{latest[p.id]?.score!=null?`Score ${Number(latest[p.id].score).toFixed(1)}%`:"No daily data yet"}</span></div></div>
          <div className="mt-5 flex items-center justify-between"><button onClick={()=>router.push("/platform/"+p.id)} className="inline-flex items-center gap-2 text-sm font-semibold text-[var(--green)]">Open project <ArrowRight size={16}/></button>{role==="superadmin"&&<button onClick={()=>{setDeleteTarget(p);setConfirmName("")}} className="rounded-lg p-2 text-[#a13f35] hover:bg-red-50" aria-label={"Delete "+p.brand_name}><Trash2 size={17}/></button>}</div>
        </article>)}
      </div>}
    </div>

    {creating&&<div className="fixed inset-0 z-50 flex items-center justify-center bg-black/35 p-5" onMouseDown={e=>{if(e.currentTarget===e.target)setCreating(false)}}>
      <div className="w-full max-w-lg rounded-3xl bg-white p-7 shadow-2xl">
        <div className="flex items-center justify-between"><div><p className="text-xs font-bold uppercase tracking-[0.2em] text-[var(--green)]">New project</p><h2 className="mt-1 text-2xl font-semibold">Create brand project</h2></div><button onClick={()=>setCreating(false)} className="rounded-lg p-2 hover:bg-[var(--paper)]"><X size={18}/></button></div>
        <div className="mt-6 space-y-5">
          <label className="block text-sm font-semibold">Brand name<input value={brandName} onChange={e=>setBrandName(e.target.value)} placeholder="e.g. Lifewood" className="mt-2 w-full rounded-xl border border-[var(--line)] px-4 py-3"/></label>
          <label className="block text-sm font-semibold">Brand description<span className="ml-1 font-normal text-[#66736c]">(optional)</span><textarea value={description} onChange={e=>setDescription(e.target.value)} rows={4} placeholder="What does this brand do?" className="mt-2 w-full resize-none rounded-xl border border-[var(--line)] px-4 py-3"/></label>
        </div>
        <div className="mt-7 flex justify-end gap-3"><button onClick={()=>setCreating(false)} className="rounded-xl border border-[var(--line)] px-4 py-3 text-sm font-semibold">Cancel</button><button disabled={busy||!brandName.trim()} onClick={createProject} className="rounded-xl bg-[#0d5b3a] px-5 py-3 text-sm font-semibold text-white disabled:opacity-50">{busy?"Creating…":"Create project"}</button></div>
      </div>
    </div>}

    {deleteTarget&&<div className="fixed inset-0 z-50 flex items-center justify-center bg-black/35 p-5">
      <div className="w-full max-w-lg rounded-3xl bg-white p-7 shadow-2xl">
        <div className="flex items-start gap-4"><div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-red-50 text-[#a13f35]"><Trash2 size={20}/></div><div><h2 className="text-2xl font-semibold">Delete “{deleteTarget.brand_name}”?</h2><p className="mt-2 text-sm leading-6 text-[#66736c]">This permanently removes the project’s prompts, analytics, citations, competitors and configuration. Raw AI response records are preserved in the database.</p></div></div>
        <label className="mt-6 block text-sm font-semibold">Type the project name exactly<input value={confirmName} onChange={e=>setConfirmName(e.target.value)} className="mt-2 w-full rounded-xl border border-[var(--line)] px-4 py-3"/></label>
        <div className="mt-7 flex justify-end gap-3"><button onClick={()=>{setDeleteTarget(null);setConfirmName("")}} className="rounded-xl border border-[var(--line)] px-4 py-3 text-sm font-semibold">Cancel</button><button onClick={deleteProject} disabled={busy||confirmName!==deleteTarget.brand_name} className="rounded-xl bg-[#a13f35] px-5 py-3 text-sm font-semibold text-white disabled:opacity-40">{busy?"Deleting…":"Delete project"}</button></div>
      </div>
    </div>}
  </main>
}