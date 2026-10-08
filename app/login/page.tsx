"use client";

import { FormEvent, useEffect, useState } from "react";
import { ArrowRight, Eye, EyeOff, LockKeyhole } from "lucide-react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { supabase } from "@/lib/supabase";

export default function LoginPage() {
  const router = useRouter();
  const [email,setEmail] = useState("");
  const [password,setPassword] = useState("");
  const [showPassword,setShowPassword] = useState(false);
  const [loading,setLoading] = useState(false);
  const [error,setError] = useState("");

  useEffect(()=>{
    let mounted=true;
    supabase.auth.getSession().then(({data})=>{
      if(mounted && data.session) router.replace("/projects");
    });
    return ()=>{mounted=false};
  },[router]);

  async function handleSubmit(e:FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError("");
    setLoading(true);
    const { error } = await supabase.auth.signInWithPassword({ email:email.trim(), password });
    if(error){ setError(error.message); setLoading(false); return; }
    router.replace("/projects");
    router.refresh();
  }

  return (
    <main className="min-h-screen grid lg:grid-cols-[1.05fr_.95fr]">
      <section className="hidden lg:flex bg-[#0d5b3a] text-white p-12 flex-col justify-between">
        <div>
          <div className="text-sm font-bold tracking-[0.28em] uppercase text-[#f5b64c]">Lifewood</div>
          <h1 className="mt-8 max-w-xl text-6xl font-semibold leading-[1.02] tracking-tight">AI Visibility<br/>Intelligence.</h1>
          <p className="mt-7 max-w-lg text-lg leading-8 text-white/75">Track how your brand appears across major AI answer engines and turn daily response data into measurable visibility signals.</p>
        </div>
        <div className="text-sm text-white/55">AI Visibility Platform · Separate from the AEO/GEO Operations Platform</div>
      </section>

      <section className="flex items-center justify-center p-6 sm:p-10">
        <div className="w-full max-w-md">
          <div className="mb-8">
            <div className="mb-5 flex h-12 w-12 items-center justify-center rounded-2xl bg-[#0d5b3a] text-[#f5b64c]"><LockKeyhole size={22}/></div>
            <p className="text-xs font-bold tracking-[0.24em] uppercase text-[#0d5b3a]">Lifewood</p>
            <h2 className="mt-2 text-3xl font-semibold tracking-tight">AI Visibility</h2>
            <p className="mt-2 text-sm leading-6 text-[#66736c]">Sign in to access your assigned brand projects.</p>
          </div>

          <form onSubmit={handleSubmit} className="rounded-3xl border border-[#d9ded9] bg-white p-7 shadow-[0_18px_60px_rgba(19,35,27,.08)]">
            {error && <div role="alert" className="mb-5 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>}
            <label className="block">
              <span className="text-sm font-semibold">Email</span>
              <input value={email} onChange={e=>setEmail(e.target.value)} type="email" autoComplete="email" required disabled={loading} placeholder="you@company.com" className="mt-2 w-full rounded-xl border border-[#d9ded9] px-4 py-3 outline-none focus:border-[#0d5b3a] focus:ring-4 focus:ring-[#0d5b3a]/10 disabled:opacity-60"/>
            </label>
            <label className="mt-5 block">
              <div className="flex items-center justify-between">
                <span className="text-sm font-semibold">Password</span>
                <Link href="/forgot-password" className="text-xs font-semibold text-[#0d5b3a] hover:underline">Forgot password?</Link>
              </div>
              <div className="relative mt-2">
                <input value={password} onChange={e=>setPassword(e.target.value)} type={showPassword?"text":"password"} autoComplete="current-password" required disabled={loading} placeholder="••••••••" className="w-full rounded-xl border border-[#d9ded9] px-4 py-3 pr-11 outline-none focus:border-[#0d5b3a] focus:ring-4 focus:ring-[#0d5b3a]/10 disabled:opacity-60"/>
                <button type="button" onClick={()=>setShowPassword(v=>!v)} className="absolute right-3 top-1/2 -translate-y-1/2 text-[#66736c]" aria-label={showPassword?"Hide password":"Show password"}>{showPassword?<EyeOff size={18}/>:<Eye size={18}/>}</button>
              </div>
            </label>
            <button type="submit" disabled={loading} className="mt-7 flex w-full items-center justify-center gap-2 rounded-xl bg-[#0d5b3a] px-4 py-3.5 text-sm font-semibold text-white transition hover:bg-[#083f2b] disabled:opacity-60">{loading?"Signing in…":"Sign in"}{!loading&&<ArrowRight size={17}/>}</button>
            <p className="mt-5 text-center text-xs leading-5 text-[#66736c]">Authentication is securely handled by Supabase Auth.</p>
          </form>
        </div>
      </section>
    </main>
  );
}