"use client";

import { useEffect, useState } from "react";
import { ArrowLeft, BarChart3, BookOpen, Bot, ExternalLink, Settings2, Users } from "lucide-react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";

type Project={id:string;brand_name:string;brand_description:string|null;brand_domains:string[];topics:string[]};

export default function ProjectHome(){
  const {projectId}=useParams<{projectId:string}>();
  const router=useRouter();
  const [project,setProject]=useState<Project|null>(null);
  const [role,setRole]=useState<string>("");
  const [loading,setLoading]=useState(true);
  const [error,setError]=useState("");

  useEffect(()=>{
    (async()=>{
      const {data:{user}}=await supabase.auth.getUser();
      if(!user){router.replace("/login");return}
      const {data:p,error:pe}=await supabase.from("projects").select("id,brand_name,brand_description,brand_domains,topics").eq("id",projectId).single();
      if(pe||!p){setError("This project is not available to your account.");setLoading(false);return}
      setProject(p);
      const {data:m}=await supabase.from("project_members").select("role").eq("project_id",projectId).eq("user_id",user.id).maybeSingle();
      const {data:profile}=await supabase.from("profiles").select("role").eq("id",user.id).single();
      setRole(profile?.role==="superadmin"?"superadmin":m?.role??profile?.role??"viewer");
      setLoading(false);
    })()
  },[projectId,router]);

  if(loading)return <main className="min-h-screen bg-[#f6f3eb] p-8"><div className="mx-auto max-w-7xl"><div className="h-10 w-64 animate-pulse rounded bg-white"/><div className="mt-8 h-64 animate-pulse rounded-3xl bg-white"/></div></main>;
  if(error||!project)return <main className="min-h-screen bg-[#f6f3eb] p-8"><div className="mx-auto max-w-xl rounded-3xl bg-white p-8"><p className="text-sm text-red-700">{error}</p><Link href="/projects" className="mt-5 inline-flex rounded-xl bg-[#0d5b3a] px-4 py-3 text-sm font-semibold text-white">Back to projects</Link></div></main>;

  const nav=[
    {name:"Dashboard",href:"/platform/"+projectId,icon:BarChart3},
    {name:"Analytics",href:"/platform/"+projectId+"/analytics",icon:BarChart3},
    {name:"Citations",href:"/platform/"+projectId+"/citations",icon:BookOpen},
    {name:"Competitors",href:"/platform/"+projectId+"/competitors",icon:Users},
    {name:"Prompts",href:"/platform/"+projectId+"/prompts",icon:BookOpen},
    {name:"Settings",href:"/platform/"+projectId+"/settings",icon:Settings2},
  ];

  return <main className="min-h-screen bg-[#f6f3eb]">
    <header className="border-b border-[#d9ded9] bg-white"><div className="mx-auto flex max-w-[1500px] items-center justify-between gap-4 px-6 py-4"><div className="min-w-0"><Link href="/projects" className="inline-flex items-center gap-2 text-xs font-semibold text-[#0d5b3a]"><ArrowLeft size={14}/> Projects</Link><h1 className="mt-1 truncate text-2xl font-semibold">{project.brand_name}</h1></div><div className="rounded-full bg-[#eef4ef] px-3 py-2 text-xs font-bold capitalize text-[#0d5b3a]">{role}</div></div></header>
    <div className="mx-auto max-w-[1500px] px-6 py-8">
      <div className="flex flex-wrap gap-2">{nav.map(item=>{const I=item.icon;return <Link key={item.href} href={item.href} className="inline-flex items-center gap-2 rounded-xl border border-[#d9ded9] bg-white px-4 py-2.5 text-sm font-semibold hover:border-[#0d5b3a]"><I size={16}/>{item.name}</Link>})}</div>
      <section className="mt-8 rounded-3xl border border-[#d9ded9] bg-white p-7 shadow-sm">
        <div className="flex items-start gap-4"><div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-[#0d5b3a] text-[#f5b64c]"><Bot size={25}/></div><div><p className="text-xs font-bold uppercase tracking-[0.2em] text-[#0d5b3a]">Dashboard</p><h2 className="mt-1 text-3xl font-semibold">AI visibility overview</h2><p className="mt-2 max-w-2xl text-sm leading-6 text-[#66736c]">{project.brand_description||"Configure the brand, topics, prompts and LLM connections to begin daily visibility tracking."}</p></div></div>
        <div className="mt-7 grid gap-4 md:grid-cols-3">
          <div className="rounded-2xl bg-[#f6f3eb] p-5"><div className="text-xs uppercase tracking-[0.16em] text-[#66736c]">Latest Visibility Rank</div><div className="mt-2 text-4xl font-semibold">—</div><p className="mt-1 text-sm text-[#66736c]">Awaiting first daily run</p></div>
          <div className="rounded-2xl bg-[#f6f3eb] p-5"><div className="text-xs uppercase tracking-[0.16em] text-[#66736c]">Latest Visibility Score</div><div className="mt-2 text-4xl font-semibold">—</div><p className="mt-1 text-sm text-[#66736c]">Awaiting first daily run</p></div>
          <div className="rounded-2xl bg-[#f6f3eb] p-5"><div className="text-xs uppercase tracking-[0.16em] text-[#66736c]">Tracked Topics</div><div className="mt-2 text-4xl font-semibold">{project.topics?.length??0}</div><p className="mt-1 text-sm text-[#66736c]">Configured categories</p></div>
        </div>
      </section>
      <div className="mt-6 grid gap-5 lg:grid-cols-2">
        <section className="rounded-3xl border border-[#d9ded9] bg-white p-6"><h3 className="text-lg font-semibold">Project setup</h3><p className="mt-2 text-sm leading-6 text-[#66736c]">The project is ready for the next build stages: topics, exactly 100 prompts, LLM API connections and daily collection runs.</p><div className="mt-5 text-sm"><div className="flex justify-between border-b border-[#eef0ee] py-3"><span className="text-[#66736c]">Domains</span><span className="font-semibold">{project.brand_domains?.length??0}</span></div><div className="flex justify-between py-3"><span className="text-[#66736c]">Topics</span><span className="font-semibold">{project.topics?.length??0}</span></div></div></section>
        <section className="rounded-3xl border border-[#d9ded9] bg-white p-6"><h3 className="text-lg font-semibold">Next pages</h3><div className="mt-4 space-y-2">{nav.slice(1).map(item=><Link key={item.href} href={item.href} className="flex items-center justify-between rounded-xl border border-[#e6eae6] p-4 text-sm font-semibold hover:bg-[#f6f3eb]"><span>{item.name}</span><ExternalLink size={16} className="text-[#0d5b3a]"/></Link>)}</div></section>
      </div>
    </div>
  </main>;
}