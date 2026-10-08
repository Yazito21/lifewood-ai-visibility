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
    const origin=window.location.origin;
    const {error}=await supabase.auth.resetPasswordForEmail(email.trim(),{redirectTo:origin+"/update-password"});
    if(error) setError(error.message); else setSent(true);
    setLoading(false);
  }

  return <main className="min-h-screen flex items-center justify-center bg-[#f6f3eb] p-6">
    <div className="w-full max-w-md rounded-3xl border border-[#d9ded9] bg-white p-8 shadow-xl">
      <Link href="/login" className="inline-flex items-center gap-2 text-sm font-semibold text-[#0d5b3a]"><ArrowLeft size={16}/> Back to sign in</Link>
      <div className="mt-8 flex h-12 w-12 items-center justify-center rounded-2xl bg-[#eef4ef] text-[#0d5b3a]"><Mail size={22}/></div>
      <h1 className="mt-5 text-3xl font-semibold">Reset your password</h1>
      <p className="mt-2 text-sm leading-6 text-[#66736c]">Enter your registered email. Password recovery is handled by Supabase Auth.</p>
      {error&&<div className="mt-5 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>}
      {sent?<div className="mt-6 rounded-xl border border-green-200 bg-green-50 px-4 py-3 text-sm text-green-800">If the account exists, a password reset email has been sent.</div>:
      <form onSubmit={submit} className="mt-6">
        <label className="block text-sm font-semibold">Email<input value={email} onChange={e=>setEmail(e.target.value)} type="email" required className="mt-2 w-full rounded-xl border border-[#d9ded9] px-4 py-3 outline-none focus:border-[#0d5b3a]"/></label>
        <button disabled={loading} className="mt-5 w-full rounded-xl bg-[#0d5b3a] px-4 py-3.5 text-sm font-semibold text-white disabled:opacity-60">{loading?"Sending…":"Send reset link"}</button>
      </form>}
    </div>
  </main>
}