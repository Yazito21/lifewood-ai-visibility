"use client";

import { FormEvent, useEffect, useState } from "react";
import Link from "next/link";
import { ArrowRight, Eye, EyeOff } from "lucide-react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    let mounted = true;
    supabase.auth.getSession().then(({ data }) => {
      if (mounted && data.session) router.replace("/home");
    });
    return () => { mounted = false; };
  }, [router]);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setLoading(true);
    const { error: signInError } = await supabase.auth.signInWithPassword({
      email: email.trim(),
      password,
    });
    if (signInError) {
      setError(signInError.message);
      setLoading(false);
      return;
    }
    router.replace("/home");
    router.refresh();
  }

  return (
    <main className="relative isolate flex min-h-screen items-center justify-center overflow-hidden bg-[radial-gradient(ellipse_at_top_left,rgba(4,98,65,0.68),transparent_48%),radial-gradient(ellipse_at_bottom_right,rgba(255,179,71,0.16),transparent_38%),linear-gradient(135deg,#071b14,#102c21_55%,#061710)] px-5 py-10 sm:px-6 sm:py-12">
      <div aria-hidden="true" className="pointer-events-none absolute inset-0 opacity-70" style={{
        backgroundImage: "linear-gradient(rgba(139,201,165,0.075) 1px,transparent 1px),linear-gradient(90deg,rgba(139,201,165,0.075) 1px,transparent 1px)",
        backgroundSize: "48px 48px",
        maskImage: "linear-gradient(to bottom,black,transparent 92%)",
      }} />
      <div aria-hidden="true" className="pointer-events-none absolute -left-36 top-1/4 h-96 w-96 rounded-full border border-emerald-200/10 shadow-[0_0_100px_rgba(4,98,65,0.18)]" />
      <div aria-hidden="true" className="pointer-events-none absolute -left-16 top-[30%] h-64 w-64 rounded-full border border-amber-300/10" />
      <div aria-hidden="true" className="pointer-events-none absolute -right-32 bottom-[-5rem] h-[34rem] w-[34rem] rounded-full border border-emerald-200/10 shadow-[0_0_120px_rgba(4,98,65,0.18)]" />
      <div aria-hidden="true" className="pointer-events-none absolute right-[8%] top-[12%] hidden h-44 w-44 rounded-full border border-amber-200/15 lg:block">
        <div className="absolute inset-4 rounded-full border border-emerald-100/10" />
        <div className="absolute left-1/2 top-0 h-full w-px bg-gradient-to-b from-transparent via-emerald-100/15 to-transparent" />
        <div className="absolute left-0 top-1/2 h-px w-full bg-gradient-to-r from-transparent via-emerald-100/15 to-transparent" />
        <span className="absolute left-1/2 top-1/2 h-2 w-2 -translate-x-1/2 -translate-y-1/2 rounded-full bg-[#ffb347] shadow-[0_0_20px_rgba(255,179,71,0.8)]" />
      </div>
      <svg aria-hidden="true" className="pointer-events-none absolute inset-0 h-full w-full opacity-35" viewBox="0 0 1440 900" preserveAspectRatio="xMidYMid slice" fill="none">
        <path d="M0 245H190L235 290H340M1440 190H1270L1225 235H1140M0 690H170L215 645H305M1440 690H1290L1240 640H1150" stroke="#8bc9a5" strokeOpacity=".34" strokeWidth="1.2" />
        <path d="M90 0V120L135 165V250M1340 0V100L1295 145V220M75 900V790L120 745V675M1365 900V800L1320 755V690" stroke="#ffb347" strokeOpacity=".42" strokeWidth="1.2" />
        <circle cx="340" cy="290" r="4" fill="#ffb347" />
        <circle cx="1140" cy="235" r="4" fill="#ffb347" />
        <circle cx="305" cy="645" r="4" fill="#8bc9a5" />
        <circle cx="1150" cy="640" r="4" fill="#8bc9a5" />
        <path d="M420 110H530L565 145H610M1030 770H940L905 735H860" stroke="#8bc9a5" strokeOpacity=".2" strokeDasharray="4 8" />
        <path d="M1090 500l35-22 35 14 35-43 35 7" stroke="#ffb347" strokeOpacity=".65" strokeWidth="2" />
        <path d="M170 510l24-20 25 9 25-35 25 12 24-28" stroke="#8bc9a5" strokeOpacity=".55" strokeWidth="2" />
        <circle cx="1230" cy="456" r="3" fill="#ffb347" />
        <circle cx="293" cy="448" r="3" fill="#8bc9a5" />
      </svg>

      <div aria-hidden="true" className="pointer-events-none absolute bottom-[12%] left-[7%] hidden w-44 rounded-xl border border-emerald-100/10 bg-[#0a2118]/60 p-4 backdrop-blur-sm xl:block">
        <div className="mb-3 flex items-center justify-between text-[9px] font-bold uppercase tracking-[0.18em] text-emerald-100/60"><span>Visibility index</span><span className="text-[#ffb347]">AI</span></div>
        <div className="flex h-12 items-end gap-1.5">
          {[32, 48, 38, 62, 53, 76, 67, 92, 80, 100].map((height, index) => <span key={index} className="flex-1 rounded-t-sm bg-emerald-300/50" style={{ height: height + "%" }} />)}
        </div>
        <div className="mt-2 text-[9px] tracking-wide text-emerald-100/40">SEARCH · SIGNAL · PERFORMANCE</div>
      </div>
      <div aria-hidden="true" className="pointer-events-none absolute right-[7%] bottom-[16%] hidden w-48 rounded-xl border border-emerald-100/10 bg-[#0a2118]/60 p-4 backdrop-blur-sm xl:block">
        <div className="mb-3 text-[9px] font-bold uppercase tracking-[0.18em] text-emerald-100/60">Citation signals</div>
        <div className="space-y-2">
          <div className="h-1.5 overflow-hidden rounded-full bg-emerald-100/10"><div className="h-full w-[78%] rounded-full bg-[#ffb347]/80" /></div>
          <div className="h-1.5 overflow-hidden rounded-full bg-emerald-100/10"><div className="h-full w-[61%] rounded-full bg-emerald-300/70" /></div>
          <div className="h-1.5 overflow-hidden rounded-full bg-emerald-100/10"><div className="h-full w-[88%] rounded-full bg-emerald-300/50" /></div>
        </div>
        <div className="mt-3 text-[9px] tracking-wide text-emerald-100/40">AEO · GEO · DATA INTELLIGENCE</div>
      </div>

      <div className="relative z-10 w-full max-w-md">
        <div className="mb-8 text-center">
          <div className="mx-auto mb-7 inline-flex max-w-full items-center justify-center rounded-2xl bg-white px-5 py-3.5 shadow-[0_10px_35px_rgba(0,0,0,0.18)] sm:px-6 sm:py-4">
            <img src="/lifewood-logo.svg" alt="Lifewood" className="h-auto w-[280px] max-w-[72vw] object-contain" />
          </div>
          <p className="mb-2 text-[0.65rem] font-bold uppercase tracking-[0.32em] text-[#ffbf62]">AI Search Intelligence</p>
          <h1 className="mt-2 text-3xl font-semibold tracking-tight text-white sm:text-4xl">AEO/GEO Tracking</h1>
          <p className="mt-3 text-sm leading-6 text-emerald-50/70">Monitor your brand's visibility across AI-powered search.</p>
        </div>

        <form onSubmit={handleSubmit} className="rounded-3xl border border-emerald-900/20 bg-white p-7 shadow-[0_24px_70px_rgba(0,0,0,0.28)] sm:p-8">
          {error && <div role="alert" className="mb-5 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm leading-5 text-red-700">{error}</div>}
          <div className="space-y-5">
            <label className="block">
              <span className="text-sm font-semibold text-[#133020]">Email</span>
              <input value={email} onChange={(event) => setEmail(event.target.value)} type="email" autoComplete="email" required disabled={loading} placeholder="you@company.com" className="mt-2 w-full rounded-xl border border-[#0d5b3a] bg-white px-4 py-3 text-sm text-[#133020] outline-none transition focus:border-[#046241] focus:ring-2 focus:ring-[#046241]/15 disabled:opacity-60" />
            </label>
            <label className="block">
              <div className="flex items-center justify-between gap-4">
                <span className="text-sm font-semibold text-[#133020]">Password</span>
                <Link href="/forgot-password" className="text-xs font-semibold text-[#046241] transition hover:opacity-80">Forgot your password?</Link>
              </div>
              <div className="relative mt-2">
                <input value={password} onChange={(event) => setPassword(event.target.value)} type={showPassword ? "text" : "password"} autoComplete="current-password" required disabled={loading} placeholder="••••••••" className="w-full rounded-xl border border-[#0d5b3a] bg-white px-4 py-3 pr-11 text-sm text-[#133020] outline-none transition focus:border-[#046241] focus:ring-2 focus:ring-[#046241]/15 disabled:opacity-60" />
                <button type="button" onClick={() => setShowPassword((value) => !value)} className="absolute right-3 top-1/2 -translate-y-1/2 text-[#617064]" aria-label={showPassword ? "Hide password" : "Show password"}>{showPassword ? <EyeOff size={18} /> : <Eye size={18} />}</button>
              </div>
            </label>
          </div>
          <button type="submit" disabled={loading} className="mt-7 flex w-full items-center justify-center gap-2 rounded-xl bg-[#046241] px-4 py-3.5 text-sm font-semibold text-white transition hover:bg-[#07553a] disabled:cursor-not-allowed disabled:opacity-60">
            {loading ? "Signing in…" : "Sign in"}{!loading && <ArrowRight size={17} />}
          </button>
          <p className="mt-5 text-center text-xs leading-5 text-[#617064]">Authentication is securely handled by Supabase Auth.</p>
        </form>
        <p className="mt-6 text-center text-[0.65rem] font-medium uppercase tracking-[0.24em] text-emerald-100/35">AI visibility · AEO/GEO · Data intelligence</p>
      </div>
    </main>
  );
}
