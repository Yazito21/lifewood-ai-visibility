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

  return <main className="min-h-screen flex items-center justify-center bg-[#f6f3eb] p-6">
    <form onSubmit={submit} className="w-full max-w-md rounded-3xl border border-[#d9ded9] bg-white p-8 shadow-xl">
      <p className="text-xs font-bold tracking-[0.24em] uppercase text-[#0d5b3a]">Lifewood</p>
      <h1 className="mt-3 text-3xl font-semibold">Set new password</h1>
      {error&&<div className="mt-5 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>}
      {done?<div className="mt-5 space-y-4"><div className="rounded-xl border border-green-200 bg-green-50 px-4 py-3 text-sm text-green-800">Password updated successfully.</div><button type="button" onClick={()=>router.replace("/login")} className="w-full rounded-xl bg-[#0d5b3a] px-4 py-3.5 text-sm font-semibold text-white">Back to sign in</button></div>:
      <div className="mt-6 space-y-5">
        <label className="block text-sm font-semibold">New password<input value={password} onChange={e=>setPassword(e.target.value)} type="password" required className="mt-2 w-full rounded-xl border border-[#d9ded9] px-4 py-3"/></label>
        <label className="block text-sm font-semibold">Confirm password<input value={confirm} onChange={e=>setConfirm(e.target.value)} type="password" required className="mt-2 w-full rounded-xl border border-[#d9ded9] px-4 py-3"/></label>
        <button disabled={loading} className="w-full rounded-xl bg-[#0d5b3a] px-4 py-3.5 text-sm font-semibold text-white disabled:opacity-60">{loading?"Updating…":"Update password"}</button>
      </div>}
    </form>
  </main>
}