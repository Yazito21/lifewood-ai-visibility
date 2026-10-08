"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useParams, usePathname, useRouter } from "next/navigation";
import {
  Activity, ArrowLeft, BarChart3, BookOpen, LayoutDashboard,
  Menu, Settings2, ShieldCheck, Users, UsersRound, X,
} from "lucide-react";
import { supabase } from "@/lib/supabase";

export type ProjectContext = {
  id: string;
  brand_name: string;
  brand_description: string | null;
  brand_domains: string[];
  brand_terms: string[];
  brand_logo_url: string | null;
  topics: string[];
};
export type UserRole = "superadmin" | "admin" | "viewer";

const baseNav = [
  ["Dashboard", "", LayoutDashboard],
  ["Analytics", "/analytics", BarChart3],
  ["Citations", "/citations", BookOpen],
  ["Competitors", "/competitors", Users],
  ["Prompts", "/prompts", Activity],
  ["Settings", "/settings", Settings2],
] as const;

export function ProjectShell({ children }: { children: React.ReactNode }) {
  const { projectId } = useParams<{ projectId: string }>();
  const pathname = usePathname();
  const router = useRouter();
  const [project, setProject] = useState<ProjectContext | null>(null);
  const [role, setRole] = useState<UserRole>("viewer");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [mobileNavOpen, setMobileNavOpen] = useState(false);

  useEffect(() => {
    let active = true;
    async function load() {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) { router.replace("/login"); return; }
      const [{ data: p, error: projectError }, { data: profile }, { data: member }] = await Promise.all([
        supabase.from("projects").select("id,brand_name,brand_description,brand_domains,brand_terms,brand_logo_url,topics").eq("id", projectId).single(),
        supabase.from("profiles").select("role").eq("id", user.id).single(),
        supabase.from("project_members").select("role").eq("project_id", projectId).eq("user_id", user.id).maybeSingle(),
      ]);
      if (!active) return;
      if (projectError || !p) { setError("This project is not available to your account."); setLoading(false); return; }
      setProject(p);
      setRole(profile?.role === "superadmin" ? "superadmin" : (member?.role ?? profile?.role ?? "viewer"));
      setLoading(false);
    }
    void load();
    return () => { active = false; };
  }, [projectId, router]);

  async function signOut() {
    await supabase.auth.signOut();
    router.replace("/login");
  }

  if (loading) {
    return <main className="min-h-screen bg-[var(--background)]">
      <div className="mx-auto max-w-[1500px] p-4 sm:p-7 lg:p-8">
        <div className="h-[82px] animate-pulse rounded-xl bg-[var(--card)]" />
        <div className="mt-2 h-12 animate-pulse rounded-xl bg-[var(--card)]" />
        <div className="mt-7 h-72 animate-pulse rounded-2xl bg-[var(--card)]" />
      </div>
    </main>;
  }

  if (error || !project) {
    return <main className="min-h-screen bg-[var(--background)] p-6">
      <div className="mx-auto max-w-xl rounded-2xl border border-[var(--line)] bg-[var(--card)] p-7 shadow-sm">
        <p className="text-sm text-red-700">{error}</p>
        <Link href="/projects" className="platform-btn platform-btn-primary mt-5">Back to projects</Link>
      </div>
    </main>;
  }

  const nav = [...baseNav, ...(role !== "viewer" ? [["Accounts", "/accounts", UsersRound] as const] : [])];

  return <div className="min-h-screen min-w-0 bg-[var(--background)] text-[var(--foreground)]">
    <header className="relative overflow-hidden border-b border-[var(--border)] bg-[var(--lw-dark-serpent)] text-white shadow-[0_10px_35px_rgba(19,48,32,0.16)]">
      <div className="pointer-events-none absolute inset-0 opacity-25 [background-image:linear-gradient(rgba(255,255,255,.055)_1px,transparent_1px),linear-gradient(90deg,rgba(255,255,255,.055)_1px,transparent_1px)] [background-size:28px_28px]" />
      <div className="pointer-events-none absolute -right-20 -top-24 h-64 w-64 rounded-full bg-[var(--lw-saffaron)]/10 blur-3xl" />
      <div className="relative mx-auto w-full max-w-[1500px] px-4 sm:px-7 lg:px-8">
        <div className="flex min-h-[82px] items-center justify-between gap-4 py-3.5">
          <div className="min-w-0">
            <Link href="/projects" className="mb-1.5 inline-flex items-center gap-1.5 text-[11px] font-medium text-white/60 transition hover:text-white">
              <ArrowLeft size={13} /> All projects
            </Link>
            <div className="flex min-w-0 items-center gap-3">
              <div className="inline-flex h-14 min-w-14 shrink-0 items-center justify-center overflow-hidden rounded-xl border border-white/20 bg-white shadow-sm">
                {project.brand_logo_url
                  ? <img src={project.brand_logo_url} alt="" className="h-full w-auto max-w-[240px] object-contain p-1.5" />
                  : <span className="font-black text-[var(--lw-castleton-green)]">AI</span>}
              </div>
              <div className="min-w-0">
                <h1 className="truncate text-sm font-semibold tracking-tight sm:text-lg">{project.brand_name}</h1>
                <div className="mt-0.5 flex items-center gap-2 text-[9px] font-semibold uppercase tracking-[0.18em] text-white/50 sm:text-[10px]">
                  <span className="h-1.5 w-1.5 rounded-full bg-[var(--lw-saffaron)]" />
                  AI Visibility Intelligence Platform
                </div>
              </div>
            </div>
          </div>
          <div className="hidden shrink-0 items-center gap-3 sm:flex">
            <span className="rounded-full border border-white/10 bg-white/5 px-3 py-1.5 text-[11px] font-medium text-white/65">Project workspace</span>
            <button type="button" onClick={() => void signOut()} className="rounded-full border border-white/10 bg-white/5 px-3 py-1.5 text-[11px] font-medium text-white/70 hover:bg-white/10 hover:text-white">
              Sign out
            </button>
          </div>
          <button type="button" onClick={() => setMobileNavOpen((v) => !v)} className="rounded-lg p-2 text-white hover:bg-white/10 sm:hidden" aria-label="Toggle project navigation">
            {mobileNavOpen ? <X size={20} /> : <Menu size={20} />}
          </button>
        </div>
      </div>
    </header>

    <div className="w-full border-b border-[var(--border)] bg-[var(--card)] shadow-[0_2px_12px_rgba(19,48,32,0.06)]">
      <nav className="mx-auto flex w-full max-w-[1500px] justify-start gap-1 overflow-x-auto px-2 py-1.5 sm:justify-center sm:px-5 lg:px-8" aria-label="Project navigation">
        {nav.map(([label, segment, Icon]) => {
          const href = `/platform/${projectId}${segment}`;
          const active = pathname === href || (segment !== "" && pathname.startsWith(`${href}/`));
          return <Link
            key={segment || "dashboard"}
            href={href}
            onClick={() => setMobileNavOpen(false)}
            className={`flex shrink-0 items-center justify-center gap-1.5 rounded-lg px-2.5 py-2 text-[11px] font-semibold transition sm:px-3 sm:text-xs ${active ? "bg-[var(--primary)] text-[var(--primary-foreground)] shadow-sm" : "text-[var(--muted-foreground)] hover:bg-[var(--accent)] hover:text-[var(--accent-foreground)]"}`}
          >
            <Icon size={15} strokeWidth={active ? 2.3 : 1.9} />
            {label}
          </Link>;
        })}
      </nav>
      {mobileNavOpen && <div className="border-t border-[var(--line)] bg-[var(--card)] p-3 sm:hidden">
        <button type="button" onClick={() => void signOut()} className="platform-btn w-full">Sign out</button>
      </div>}
    </div>

    <main className="project-main mx-auto min-w-0 max-w-[1500px] p-4 sm:p-7 lg:p-8">
      {children}
    </main>
  </div>;
}
