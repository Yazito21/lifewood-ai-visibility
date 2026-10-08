"use client";

import { FormEvent, useState } from "react";
import Link from "next/link";
import { ArrowLeft, Mail } from "lucide-react";
import { supabase } from "@/lib/supabase";

export default function ForgotPasswordPage(){
  const [email,setEmail]=useState("");
  const [sent,setSent]=useState(false);
  const [loading,setLoading]=useState(false);
  const [error,setError]=useState("");

  async function submit(e:FormEvent<HTMLFormElement>){
    e.preventDefault(); setError(""); setLoading(true);
    const {error}=await supabase.auth.resetPasswordForEmail(email.trim(),{redirectTo:window.location.origin+"/update-password"});
    if(error) setError(error.message); else setSent(true);
    setLoading(false);
  }

  return <main className="flex min-h-screen items-center justify-center bg-[var(--background)] p-6">
    <div className="w-full max-w-md">
      <div className="mb-8">
        <div className="mb-5 flex h-12 w-12 items-center justify-center rounded-2xl bg-[var(--lw-castleton-green)]/10 text-[var(--lw-castleton-green)]"><Mail size={22}/></div>
        <p className="page-eyebrow">Lifewood</p>
        <h1 className="mt-2 text-3xl font-semibold tracking-tight">Reset your password</h1>
        <p className="mt-2 text-sm leading-6 text-[var(--muted-foreground)]">Enter your registered email. Password recovery is handled by Supabase Auth.</p>
      </div>
      <div className="platform-card p-7 sm:p-8">
        <Link href="/login" className="inline-flex items-center gap-2 text-sm font-semibold text-[var(--primary)] hover:underline"><ArrowLeft size={16}/> Back to sign in</Link>
        {error&&<div className="mt-5 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>}
        {sent?<div className="mt-6 rounded-xl border border-green-200 bg-green-50 px-4 py-3 text-sm text-green-800">If the account exists, a password reset email has been sent.</div>:
        <form onSubmit={submit} className="mt-6">
          <label className="block text-sm font-semibold">Email<input value={email} onChange={e=>setEmail(e.target.value)} type="email" required className="platform-input mt-2"/></label>
          <button disabled={loading} className="mt-5 w-full rounded-xl bg-[var(--primary)] px-4 py-3.5 text-sm font-semibold text-[var(--primary-foreground)] disabled:opacity-60">{loading?"Sending…":"Send reset link"}</button>
        </form>}
      </div>
    </div>
  </main>
}
