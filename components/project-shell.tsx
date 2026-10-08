"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useParams, usePathname, useRouter } from "next/navigation";
import { ArrowLeft, BarChart3, BookOpen, LogOut, Menu, Settings2, ShieldCheck, Users, UsersRound, X } from "lucide-react";
import { supabase } from "@/lib/supabase";

export type ProjectContext = { id:string; brand_name:string; brand_description:string|null; brand_domains:string[]; brand_terms:string[]; brand_logo_url:string|null; topics:string[] };
export type UserRole = "superadmin"|"admin"|"viewer";

export function ProjectShell({children}:{children:React.ReactNode}) {
  const {projectId}=useParams<{projectId:string}>(), pathname=usePathname(), router=useRouter();
  const [project,setProject]=useState<ProjectContext|null>(null), [role,setRole]=useState<UserRole>("viewer"), [error,setError]=useState(""), [loading,setLoading]=useState(true), [mobileOpen,setMobileOpen]=useState(false);

  useEffect(()=>{(async()=>{
    const {data:{user}}=await supabase.auth.getUser();
    if(!user){router.replace("/login");return}
    const [{data:p,error:pe},{data:profile},{data:member}]=await Promise.all([
      supabase.from("projects").select("id,brand_name,brand_description,brand_domains,brand_terms,brand_logo_url,topics").eq("id",projectId).single(),
      supabase.from("profiles").select("role").eq("id",user.id).single(),
      supabase.from("project_members").select("role").eq("project_id",projectId).eq("user_id",user.id).maybeSingle()
    ]);
    if(pe||!p){setError("This project is not available to your account.");setLoading(false);return}
    setProject(p); setRole(profile?.role==="superadmin" ? "superadmin" : (member?.role ?? profile?.role ?? "viewer")); setLoading(false);
  })()},[projectId,router]);

  async function signOut(){await supabase.auth.signOut();router.replace("/login")}

  if(loading) return <main className="min-h-screen bg-[var(--paper)]"><div className="mx-auto max-w-[1500px] p-6 lg:p-8"><div className="h-5 w-24 animate-pulse rounded bg-white"/><div className="mt-4 h-10 w-72 animate-pulse rounded bg-white"/><div className="mt-7 h-16 animate-pulse rounded-2xl bg-white"/><div className="mt-7 h-72 animate-pulse rounded-2xl bg-white"/></div></main>;
  if(error||!project) return <main className="min-h-screen bg-[var(--paper)] p-6"><div className="mx-auto max-w-xl rounded-2xl border border-[var(--line)] bg-white p-7 shadow-sm"><p className="text-sm text-red-700">{error}</p><Link href="/projects" className="platform-btn platform-btn-primary mt-5">Back to projects</Link></div></main>;

  const nav=[["Dashboard","",BarChart3],["Analytics","/analytics",BarChart3],["Citations","/citations",BookOpen],["Competitors","/competitors",Users],["Prompts","/prompts",BookOpen],["Settings","/settings",Settings2]] as const;
  const canManage=role!=="viewer";
  const NavItems=()=> <>{nav.map(([label,suffix,Icon])=>{
    const href="/platform/"+projectId+(suffix||""), active=pathname===href;
    return <Link key={href} href={href} onClick={()=>setMobileOpen(false)} className={"platform-btn "+(active?"platform-btn-primary shadow-sm":"")}>{label}<Icon size={16}/></Link>
  })}{canManage&&<Link href={"/platform/"+projectId+"/accounts"} onClick={()=>setMobileOpen(false)} className={"platform-btn "+(pathname.endsWith("/accounts")?"platform-btn-primary shadow-sm":"")}><UsersRound size={16}/> Accounts</Link>}</>;

  return <main className="min-h-screen bg-[var(--paper)]">
    <header className="border-b border-[var(--line)] bg-white">
      <div className="mx-auto flex max-w-[1500px] items-center justify-between gap-4 px-4 py-4 sm:px-6 lg:px-8">
        <div className="min-w-0">
          <Link href="/projects" className="inline-flex items-center gap-2 text-xs font-bold text-[var(--green)]"><ArrowLeft size={14}/> Projects</Link>
          <div className="mt-2 flex items-center gap-3">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center overflow-hidden rounded-xl bg-[var(--soft)] text-xs font-extrabold text-[var(--green)]">{project.brand_logo_url?<img src={project.brand_logo_url} alt="" className="h-full w-full object-cover"/>:"AI"}</div>
            <div className="min-w-0"><p className="truncate text-base font-bold sm:text-lg">{project.brand_name}</p><p className="truncate text-xs text-[var(--muted)]">AI Visibility Workspace</p></div>
          </div>
        </div>
        <div className="hidden items-center gap-2 sm:flex"><div className="inline-flex items-center gap-2 rounded-full bg-[var(--soft)] px-3 py-2 text-xs font-extrabold capitalize text-[var(--green)]"><ShieldCheck size={14}/>{role}</div><button onClick={signOut} className="platform-btn"><LogOut size={16}/> Sign out</button></div>
        <button onClick={()=>setMobileOpen(true)} className="platform-btn sm:hidden" aria-label="Open navigation"><Menu size={17}/></button>
      </div>
    </header>
    <div className="mx-auto max-w-[1500px] px-4 py-5 sm:px-6 lg:px-8">
      <div className="hidden flex-wrap gap-2 md:flex"><NavItems/></div>
      <div className="mt-5 md:mt-6">{children}</div>
    </div>
    {mobileOpen&&<div className="fixed inset-0 z-50 bg-black/35 md:hidden" onMouseDown={e=>{if(e.target===e.currentTarget)setMobileOpen(false)}}><div className="ml-auto flex h-full w-[86%] max-w-sm flex-col bg-white p-5 shadow-2xl"><div className="flex items-center justify-between border-b border-[var(--line)] pb-4"><div><p className="page-eyebrow">Navigation</p><p className="mt-1 font-bold">{project.brand_name}</p></div><button onClick={()=>setMobileOpen(false)} className="platform-btn px-3"><X size={17}/></button></div><nav className="mt-5 flex flex-col gap-2"><NavItems/></nav><button onClick={signOut} className="platform-btn mt-auto justify-center"><LogOut size={16}/> Sign out</button></div></div>}
  </main>;
}
