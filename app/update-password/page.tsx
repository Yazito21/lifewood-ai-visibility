"use client";

import { FormEvent, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";

export default function UpdatePasswordPage(){
  const router=useRouter();
  const [password,setPassword]=useState("");
  const [confirm,setConfirm]=useState("");
  const [error,setError]=useState("");
  const [done,setDone]=useState(false);
  const [loading,setLoading]=useState(false);

  async function submit(e:FormEvent<HTMLFormElement>){
    e.preventDefault(); setError("");
    if(password.length<8){setError("Password must be at least 8 characters.");return}
    if(password!==confirm){setError("Passwords do not match.");return}
    setLoading(true);
    const {error}=await supabase.auth.updateUser({password});
    if(error) setError(error.message); else setDone(true);
    setLoading(false);
  }

  return <main className="flex min-h-screen items-center justify-center bg-[var(--background)] p-6">
    <div className="w-full max-w-md">
      <div className="mb-8">
        <p className="page-eyebrow">Lifewood</p>
        <h1 className="mt-2 text-3xl font-semibold tracking-tight">Set new password</h1>
        <p className="mt-2 text-sm leading-6 text-[var(--muted-foreground)]">Choose a new password for your AI Visibility account.</p>
      </div>
      <form onSubmit={submit} className="platform-card p-7 sm:p-8">
        {error&&<div className="mb-5 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>}
        {done?<div className="space-y-4"><div className="rounded-xl border border-green-200 bg-green-50 px-4 py-3 text-sm text-green-800">Password updated successfully.</div><button type="button" onClick={()=>router.replace("/login")} className="w-full rounded-xl bg-[var(--primary)] px-4 py-3.5 text-sm font-semibold text-[var(--primary-foreground)]">Back to sign in</button></div>:
        <div className="space-y-5">
          <label className="block text-sm font-semibold">New password<input value={password} onChange={e=>setPassword(e.target.value)} type="password" required className="platform-input mt-2"/></label>
          <label className="block text-sm font-semibold">Confirm password<input value={confirm} onChange={e=>setConfirm(e.target.value)} type="password" required className="platform-input mt-2"/></label>
          <button disabled={loading} className="w-full rounded-xl bg-[var(--primary)] px-4 py-3.5 text-sm font-semibold text-[var(--primary-foreground)] disabled:opacity-60">{loading?"Updating…":"Update password"}</button>
        </div>}
      </form>
    </div>
  </main>
}
