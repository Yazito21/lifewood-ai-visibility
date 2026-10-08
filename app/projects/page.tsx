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
        <div><p className="page-eyebrow">Lifewood</p><h1 className="mt-1 text-lg font-bold">AI Visibility</h1></div>
        <div className="flex items-center gap-2">
          {role && <div className="hidden items-center gap-2 rounded-full bg-[var(--soft)] px-3 py-2 text-xs font-extrabold capitalize text-[var(--green)] sm:flex"><ShieldCheck size={14}/>{role}</div>}
          <button onClick={signOut} className="platform-btn"><LogOut size={16}/> Sign out</button>
        </div>
      </div>
    </header>
    <div className="mx-auto max-w-[1500px] px-4 py-8 sm:px-6 lg:px-8 lg:py-10">
      <div className="flex flex-col justify-between gap-5 border-b border-[var(--line)] pb-6 sm:flex-row sm:items-end">
        <div><p className="page-eyebrow">Project Selection</p><h2 className="page-title mt-1">Select a brand project</h2><p className="page-description mt-2">Open a project workspace to review AI visibility, citations, competitors, prompts and configuration.</p></div>
        {canCreate && <button onClick={()=>setCreating(true)} className="platform-btn platform-btn-primary"><Plus size={17}/> Create project</button>}
      </div>
      {error && <div className="mt-6 rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>}
      {loading ? (
        <div className="mt-8 grid gap-5 md:grid-cols-2 xl:grid-cols-3">{[1,2,3].map(x=><div key={x} className="h-56 animate-pulse rounded-2xl border border-[var(--line)] bg-white"/>)}</div>
      ) : projects.length===0 ? (
        <div className="platform-empty mt-8"><div><FolderKanban className="mx-auto text-[var(--green)]" size={36}/><h3 className="mt-4 text-xl font-bold">{emptyMessage}</h3><p className="mx-auto mt-2 max-w-md text-sm leading-6 text-[var(--muted)]">Projects contain the brand profile, prompts, answer-engine connections, daily response data and analytics.</p></div></div>
      ) : (
        <div className="mt-8 grid gap-5 md:grid-cols-2 xl:grid-cols-3">
          {projects.map(p=><article key={p.id} className="platform-card group p-5 sm:p-6">
            <div className="flex items-start justify-between gap-4"><div className="flex h-11 w-11 items-center justify-center overflow-hidden rounded-xl bg-[var(--soft)] font-extrabold text-[var(--green)]">{p.brand_logo_url?<img src={p.brand_logo_url} alt="" className="h-full w-full object-cover"/>:"AI"}</div><span className="platform-pill bg-[#fff5e0] text-[#8c5d13]">{latest[p.id] ? "Tracked" : "No data"}</span></div>
            <div className="mt-6"><h3 className="text-xl font-bold tracking-tight">{p.brand_name}</h3><p className="mt-2 min-h-12 text-sm leading-6 text-[var(--muted)]">{p.brand_description || "No brand description has been added yet."}</p></div>
            <div className="mt-5 rounded-xl bg-[var(--paper)] p-4"><p className="platform-stat-label">Latest Rank & Score</p><div className="mt-2 flex items-end gap-3"><span className="text-3xl font-bold tracking-tight">{latest[p.id]?.rank ?? "—"}</span><span className="pb-1 text-xs text-[var(--muted)]">{latest[p.id]?.score!=null ? `Score ${Number(latest[p.id].score).toFixed(1)}%` : "No daily data yet"}</span></div></div>
            <div className="mt-5 flex items-center justify-between"><button onClick={()=>router.push("/platform/"+p.id)} className="inline-flex items-center gap-2 text-sm font-bold text-[var(--green)]">Open project <ArrowRight size={16}/></button>{role==="superadmin"&&<button onClick={()=>{setDeleteTarget(p);setConfirmName("")}} className="platform-btn platform-btn-danger px-2.5 py-2" aria-label={"Delete "+p.brand_name}><Trash2 size={16}/></button>}</div>
          </article>)}
        </div>
      )}
    </div>
    {creating&&<div className="fixed inset-0 z-50 flex items-center justify-center bg-black/35 p-5" onMouseDown={e=>{if(e.currentTarget===e.target)setCreating(false)}}><div className="w-full max-w-lg rounded-2xl border border-[var(--line)] bg-white p-7 shadow-2xl"><div className="flex items-start justify-between gap-4"><div><p className="page-eyebrow">New Project</p><h3 className="mt-1 text-2xl font-bold">Create brand project</h3><p className="mt-2 text-sm text-[var(--muted)]">Add the client company name and an optional description.</p></div><button onClick={()=>setCreating(false)} className="platform-btn px-3"><X size={18}/></button></div><div className="mt-6 space-y-5"><label className="block text-sm font-bold">Brand name<input value={brandName} onChange={e=>setBrandName(e.target.value)} placeholder="e.g. Lifewood" className="platform-input mt-2"/></label><label className="block text-sm font-bold">Brand description<span className="ml-1 font-normal text-[var(--muted)]">(optional)</span><textarea value={description} onChange={e=>setDescription(e.target.value)} rows={4} placeholder="What does this brand do?" className="platform-input mt-2 resize-none"/></label></div><div className="mt-7 flex justify-end gap-3"><button onClick={()=>setCreating(false)} className="platform-btn">Cancel</button><button disabled={busy||!brandName.trim()} onClick={createProject} className="platform-btn platform-btn-primary disabled:opacity-50">{busy?"Creating…":"Create project"}</button></div></div></div>}
    {deleteTarget&&<div className="fixed inset-0 z-50 flex items-center justify-center bg-black/35 p-5"><div className="w-full max-w-lg rounded-2xl border border-[var(--line)] bg-white p-7 shadow-2xl"><div className="flex items-start gap-4"><div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-red-50 text-[var(--danger)]"><Trash2 size={20}/></div><div><h3 className="text-2xl font-bold">Delete “{deleteTarget.brand_name}”?</h3><p className="mt-2 text-sm leading-6 text-[var(--muted)]">This permanently removes the project’s prompts, analytics, citations, competitors and configuration.</p></div></div><label className="mt-6 block text-sm font-bold">Type the project name exactly<input value={confirmName} onChange={e=>setConfirmName(e.target.value)} className="platform-input mt-2"/></label><div className="mt-7 flex justify-end gap-3"><button onClick={()=>{setDeleteTarget(null);setConfirmName("")}} className="platform-btn">Cancel</button><button onClick={deleteProject} disabled={busy||confirmName!==deleteTarget.brand_name} className="platform-btn platform-btn-danger disabled:opacity-40">{busy?"Deleting…":"Delete project"}</button></div></div></div>}
  </main>
}