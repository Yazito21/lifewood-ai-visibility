"use client";

import { FormEvent, useEffect, useState } from "react";
import Link from "next/link";
import { ArrowRight, Eye, EyeOff, LockKeyhole } from "lucide-react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";

export default function LoginPage() {
  const router = useRouter();
  const [email,setEmail]=useState("");
  const [password,setPassword]=useState("");
  const [showPassword,setShowPassword]=useState(false);
  const [loading,setLoading]=useState(false);
  const [error,setError]=useState("");

  useEffect(()=>{
    let mounted=true;
    supabase.auth.getSession().then(({data})=>{
      if(mounted && data.session) router.replace("/projects");
    });
    return ()=>{mounted=false};
  },[router]);

  async function handleSubmit(e:FormEvent<HTMLFormElement>){
    e.preventDefault();
    setError("");
    setLoading(true);
    const {error}=await supabase.auth.signInWithPassword({email:email.trim(),password});
    if(error){setError(error.message);setLoading(false);return;}
    router.replace("/projects");
    router.refresh();
  }

  return <main className="flex min-h-screen items-center justify-center bg-[var(--background)] px-6 py-12">
    <div className="w-full max-w-md">
      <div className="mb-8">
        <div className="mx-auto mb-5 flex h-14 w-14 items-center justify-center rounded-2xl bg-[var(--lw-castleton-green)] text-[var(--lw-saffaron)] shadow-lg">
          <LockKeyhole size={24}/>
        </div>
        <p className="page-eyebrow text-center">Lifewood</p>
        <h1 className="mt-2 text-center text-3xl font-semibold tracking-tight">AI Visibility</h1>
        <p className="mt-2 text-center text-sm leading-6 text-[var(--muted-foreground)]">Sign in to access your assigned brand projects.</p>
      </div>
      <form onSubmit={handleSubmit} className="platform-card p-7 sm:p-8">
        {error&&<div role="alert" className="mb-5 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>}
        <label className="block">
          <span className="text-sm font-semibold">Email</span>
          <input value={email} onChange={e=>setEmail(e.target.value)} type="email" autoComplete="email" required disabled={loading} placeholder="you@company.com" className="platform-input mt-2 disabled:opacity-60"/>
        </label>
        <label className="mt-5 block">
          <div className="flex items-center justify-between gap-4"><span className="text-sm font-semibold">Password</span><Link href="/forgot-password" className="text-xs font-semibold text-[var(--primary)] hover:underline">Forgot password?</Link></div>
          <div className="relative mt-2">
            <input value={password} onChange={e=>setPassword(e.target.value)} type={showPassword?"text":"password"} autoComplete="current-password" required disabled={loading} placeholder="••••••••" className="platform-input pr-11 disabled:opacity-60"/>
            <button type="button" onClick={()=>setShowPassword(v=>!v)} className="absolute right-3 top-1/2 -translate-y-1/2 text-[var(--muted-foreground)]" aria-label={showPassword?"Hide password":"Show password"}>{showPassword?<EyeOff size={18}/>:<Eye size={18}/>}</button>
          </div>
        </label>
        <button type="submit" disabled={loading} className="mt-7 flex w-full items-center justify-center gap-2 rounded-xl bg-[var(--primary)] px-4 py-3.5 text-sm font-semibold text-[var(--primary-foreground)] transition hover:opacity-90 disabled:opacity-60">
          {loading?"Signing in…":"Sign in"}{!loading&&<ArrowRight size={17}/>}
        </button>
        <p className="mt-5 text-center text-xs leading-5 text-[var(--muted-foreground)]">Authentication is securely handled by Supabase Auth.</p>
      </form>
    </div>
  </main>;
}
