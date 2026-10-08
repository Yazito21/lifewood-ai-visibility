"use client";

import { useEffect,useState } from "react";
import Link from "next/link";
import { useParams,usePathname,useRouter } from "next/navigation";
import {
  Activity,ArrowLeft,BarChart3,BookOpen,ChevronLeft,ChevronRight,
  LayoutDashboard,LogOut,Menu,PanelLeftClose,PanelLeftOpen,Settings2,
  ShieldCheck,Users,UsersRound,X
} from "lucide-react";
import { supabase } from "@/lib/supabase";

export type ProjectContext={
  id:string;brand_name:string;brand_description:string|null;brand_domains:string[];
  brand_terms:string[];brand_logo_url:string|null;topics:string[];
};
export type UserRole="superadmin"|"admin"|"viewer";

export function ProjectShell({children}:{children:React.ReactNode}){
  const {projectId}=useParams<{projectId:string}>();
  const pathname=usePathname();
  const router=useRouter();
  const [project,setProject]=useState<ProjectContext|null>(null);
  const [role,setRole]=useState<UserRole>("viewer");
  const [error,setError]=useState("");
  const [loading,setLoading]=useState(true);
  const [collapsed,setCollapsed]=useState(false);
  const [mobileOpen,setMobileOpen]=useState(false);

  useEffect(()=>{(async()=>{
    const {data:{user}}=await supabase.auth.getUser();
    if(!user){router.replace("/login");return;}
    const [{data:p,error:pe},{data:profile},{data:member}]=await Promise.all([
      supabase.from("projects").select("id,brand_name,brand_description,brand_domains,brand_terms,brand_logo_url,topics").eq("id",projectId).single(),
      supabase.from("profiles").select("role").eq("id",user.id).single(),
      supabase.from("project_members").select("role").eq("project_id",projectId).eq("user_id",user.id).maybeSingle()
    ]);
    if(pe||!p){setError("This project is not available to your account.");setLoading(false);return;}
    setProject(p);
    setRole(profile?.role==="superadmin"?"superadmin":(member?.role??profile?.role??"viewer"));
    setLoading(false);
  })();},[projectId,router]);

  async function signOut(){await supabase.auth.signOut();router.replace("/login");}

  if(loading)return <main className="min-h-screen bg-[var(--paper)]"><div className="mx-auto max-w-[1500px] p-6 lg:p-8"><div className="h-16 animate-pulse rounded-xl bg-white"/><div className="mt-6 h-10 w-72 animate-pulse rounded-xl bg-white"/><div className="mt-6 h-72 animate-pulse rounded-2xl bg-white"/></div></main>;
  if(error||!project)return <main className="min-h-screen bg-[var(--paper)] p-6"><div className="mx-auto max-w-xl rounded-2xl border border-[var(--line)] bg-white p-7 shadow-sm"><p className="text-sm text-red-700">{error}</p><Link href="/projects" className="platform-btn platform-btn-primary mt-5">Back to projects</Link></div></main>;

  const groups=[
    {title:"Overview",items:[["Dashboard","",LayoutDashboard]]},
    {title:"Intelligence",items:[["Analytics","/analytics",BarChart3],["Citations","/citations",BookOpen],["Competitors","/competitors",Users],["Prompts","/prompts",Activity]]},
    {title:"System",items:[["Settings","/settings",Settings2]]}
  ] as const;
  const canManage=role!=="viewer";
  const navLink=(label:string,suffix:string,Icon:any)=>{const href="/platform/"+projectId+suffix;const active=pathname===href;return <Link key={href} href={href} onClick={()=>setMobileOpen(false)} title={collapsed?label:undefined} className={`flex items-center ${collapsed?"justify-center":"gap-3"} rounded-xl px-3 py-3 text-sm transition-all ${active?"bg-[var(--orange)] font-bold text-[var(--green)] shadow-sm":"text-white/90 hover:bg-white/10 hover:text-white"}`}><Icon size={19}/>{!collapsed&&<span>{label}</span>}</Link>};

  const sidebar=<aside className={`fixed inset-y-0 left-0 z-50 flex w-64 flex-col bg-[var(--green)] text-white shadow-2xl transition-all duration-300 lg:static lg:translate-x-0 ${collapsed?"lg:w-[84px]":"lg:w-64"} ${mobileOpen?"translate-x-0":"-translate-x-full"}`}>
    <div className="flex items-center justify-between border-b border-white/10 px-4 py-4">
      {!collapsed&&<Link href="/projects" className="inline-flex items-center gap-2 text-xs font-semibold text-white/80 hover:text-white"><ArrowLeft size={14}/> Projects</Link>}
      <button onClick={()=>setCollapsed(v=>!v)} className="hidden rounded-lg p-2 text-white/80 hover:bg-white/10 hover:text-white lg:block" aria-label={collapsed?"Expand sidebar":"Collapse sidebar"}>{collapsed?<PanelLeftOpen size={19}/>:<PanelLeftClose size={19}/>}</button>
      <button onClick={()=>setMobileOpen(false)} className="rounded-lg p-2 text-white/80 hover:bg-white/10 lg:hidden"><X size={19}/></button>
    </div>

    <div className="border-b border-white/10 px-4 py-7">
      <div className={`flex items-center ${collapsed?"justify-center":"gap-3"}`}>
        <div className="flex h-12 w-12 shrink-0 items-center justify-center overflow-hidden rounded-2xl bg-white shadow-lg">
          {project.brand_logo_url?<img src={project.brand_logo_url} alt="" className="h-full w-full object-cover"/>:<span className="font-black text-[var(--green)]">AI</span>}
        </div>
        {!collapsed&&<div className="min-w-0"><p className="truncate text-xs font-bold uppercase tracking-[0.22em] text-[var(--orange)]">Lifewood Data</p><p className="mt-1 truncate text-lg font-bold">AI Visibility</p><p className="mt-1 truncate text-xs text-white/60">{project.brand_name}</p></div>}
      </div>
    </div>

    <nav className="flex-1 overflow-y-auto px-3 py-6">
      {groups.map(group=><div key={group.title} className="mb-7">
        {!collapsed&&<p className="mb-2 px-2 text-[10px] font-extrabold uppercase tracking-[0.28em] text-[var(--orange)]">{group.title}</p>}
        <div className="space-y-1">{group.items.map(([label,suffix,Icon])=>navLink(label,suffix,Icon))}</div>
      </div>)}
      {canManage&&<div className="mb-7">
        {!collapsed&&<p className="mb-2 px-2 text-[10px] font-extrabold uppercase tracking-[0.28em] text-[var(--orange)]">Administration</p>}
        {navLink("Accounts","/accounts",UsersRound)}
      </div>}
    </nav>

    <div className="border-t border-white/10 p-4">
      <div className={`flex items-center ${collapsed?"justify-center":"gap-2"}`}>
        <div className="flex h-8 w-8 items-center justify-center rounded-full bg-white/10"><ShieldCheck size={15}/></div>
        {!collapsed&&<div className="min-w-0"><p className="truncate text-xs font-bold capitalize">{role}</p><p className="truncate text-[10px] text-white/55">Workspace access</p></div>}
      </div>
      {!collapsed&&<button onClick={signOut} className="mt-4 flex w-full items-center justify-center gap-2 rounded-xl border border-white/15 px-3 py-2.5 text-xs font-semibold text-white/85 hover:bg-white/10 hover:text-white"><LogOut size={15}/> Sign out</button>}
    </div>
  </aside>;

  return <main className="min-h-screen bg-[var(--paper)] lg:flex">
    {sidebar}
    {mobileOpen&&<div className="fixed inset-0 z-40 bg-black/40 lg:hidden" onClick={()=>setMobileOpen(false)}/>}
    <div className="min-w-0 flex-1">
      <header className="w-full border-b border-[var(--green)]/15 bg-[var(--orange)] text-[var(--ink)]">
        <div className="mx-auto flex min-h-16 max-w-[1800px] items-center justify-between gap-3 px-4 py-3 sm:px-6 lg:px-8">
          <div className="flex min-w-0 items-center gap-3">
            <button onClick={()=>setMobileOpen(true)} className="rounded-lg p-2 hover:bg-black/5 lg:hidden"><Menu size={21}/></button>
            <div className="min-w-0">
              <p className="truncate text-base font-bold leading-tight sm:text-xl">{project.brand_name}</p>
              <p className="truncate text-xs text-[var(--ink)]/70 sm:text-sm">AI Visibility Intelligence Platform</p>
            </div>
          </div>
          <div className="hidden text-right md:block"><p className="text-[10px] font-bold uppercase tracking-[0.18em] text-[var(--ink)]/60">Lifewood</p><p className="text-sm font-bold">AI Visibility</p></div>
        </div>
      </header>
      <div className="mx-auto w-full max-w-[1800px] px-4 py-7 sm:px-6 lg:px-8 lg:py-9">
        {children}
      </div>
    </div>
  </main>;
}
