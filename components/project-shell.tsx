"use client";

import { useEffect,useState } from "react";
import Link from "next/link";
import { useParams,usePathname,useRouter } from "next/navigation";
import { ArrowLeft,BarChart3,BookOpen,Bot,LogOut,Settings2,ShieldCheck,SlidersHorizontal,Users,UsersRound } from "lucide-react";
import { supabase } from "@/lib/supabase";

export type ProjectContext={id:string;brand_name:string;brand_description:string|null;brand_domains:string[];brand_terms:string[];brand_logo_url:string|null;topics:string[]};
export type UserRole="superadmin"|"admin"|"viewer";

export function ProjectShell({children}:{children:React.ReactNode}){
  const {projectId}=useParams<{projectId:string}>();
  const pathname=usePathname();
  const router=useRouter();
  const [project,setProject]=useState<ProjectContext|null>(null);
  const [role,setRole]=useState<UserRole>("viewer");
  const [error,setError]=useState("");
  const [loading,setLoading]=useState(true);

  useEffect(()=>{
    (async()=>{
      const {data:{user}}=await supabase.auth.getUser();
      if(!user){router.replace("/login");return}
      const [{data:p,error:pe},{data:profile},{data:member}]=await Promise.all([
        supabase.from("projects").select("id,brand_name,brand_description,brand_domains,brand_terms,brand_logo_url,topics").eq("id",projectId).single(),
        supabase.from("profiles").select("role").eq("id",user.id).single(),
        supabase.from("project_members").select("role").eq("project_id",projectId).eq("user_id",user.id).maybeSingle()
      ]);
      if(pe||!p){setError("This project is not available to your account.");setLoading(false);return}
      setProject(p);
      setRole(profile?.role==="superadmin"?"superadmin":(member?.role??profile?.role??"viewer"));
      setLoading(false);
    })();
  },[projectId,router]);

  async function signOut(){await supabase.auth.signOut();router.replace("/login")}

  if(loading)return <main className="min-h-screen bg-[#f6f3eb] p-8"><div className="mx-auto max-w-[1500px]"><div className="h-8 w-56 animate-pulse rounded bg-white"/><div className="mt-6 h-72 animate-pulse rounded-3xl bg-white"/></div></main>;
  if(error||!project)return <main className="min-h-screen bg-[#f6f3eb] p-8"><div className="mx-auto max-w-xl rounded-3xl bg-white p-8"><p className="text-sm text-red-700">{error}</p><Link href="/projects" className="mt-5 inline-flex rounded-xl bg-[#0d5b3a] px-4 py-3 text-sm font-semibold text-white">Back to projects</Link></div></main>;

  const nav=[
    ["Dashboard","","BarChart3"],["Analytics","/analytics","BarChart3"],["Citations","/citations","BookOpen"],["Competitors","/competitors","Users"],["Prompts","/prompts","BookOpen"],["Settings","/settings","Settings2"]
  ] as const;
  const canManage=role!=="viewer";
  const IconMap={BarChart3,BookOpen,Users,Settings2};

  return <main className="min-h-screen bg-[#f6f3eb]">
    <header className="sticky top-0 z-40 border-b border-[#d9ded9] bg-white/95 backdrop-blur">
      <div className="mx-auto flex max-w-[1500px] items-center justify-between gap-4 px-6 py-4">
        <div className="min-w-0">
          <Link href="/projects" className="inline-flex items-center gap-2 text-xs font-semibold text-[#0d5b3a]"><ArrowLeft size={14}/> Projects</Link>
          <div className="mt-1 flex items-center gap-3"><div className="flex h-9 w-9 items-center justify-center overflow-hidden rounded-xl bg-[#eef4ef] text-xs font-bold text-[#0d5b3a]">{project.brand_logo_url?<img src={project.brand_logo_url} alt="" className="h-full w-full object-cover"/>:"AI"}</div><h1 className="truncate text-xl font-semibold">{project.brand_name}</h1></div>
        </div>
        <div className="flex items-center gap-2"><div className="hidden items-center gap-2 rounded-full bg-[#eef4ef] px-3 py-2 text-xs font-bold capitalize text-[#0d5b3a] sm:flex"><ShieldCheck size={14}/>{role}</div><button onClick={signOut} className="inline-flex items-center gap-2 rounded-xl border border-[#d9ded9] px-3 py-2 text-sm font-semibold hover:bg-[#f6f3eb]"><LogOut size={16}/> Sign out</button></div>
      </div>
    </header>
    <div className="mx-auto max-w-[1500px] px-6 py-6">
      <nav className="flex gap-2 overflow-x-auto pb-1">{nav.map(([label,suffix,icon])=>{const I=IconMap[icon as keyof typeof IconMap];const href="/platform/"+projectId+(suffix||"");const active=pathname===href;return <Link key={href} href={href} className={"inline-flex shrink-0 items-center gap-2 rounded-xl border px-4 py-2.5 text-sm font-semibold transition "+(active?"border-[#0d5b3a] bg-[#0d5b3a] text-white":"border-[#d9ded9] bg-white hover:border-[#0d5b3a]")}><I size={16}/>{label}</Link>})}
        {canManage&&<Link href={"/platform/"+projectId+"/accounts"} className={"inline-flex shrink-0 items-center gap-2 rounded-xl border px-4 py-2.5 text-sm font-semibold "+(pathname.endsWith("/accounts")?"border-[#0d5b3a] bg-[#0d5b3a] text-white":"border-[#d9ded9] bg-white hover:border-[#0d5b3a]")}><UsersRound size={16}/> Accounts</Link>}
      </nav>
      {children}
    </div>
  </main>;
}
