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
        let active = true;

        supabase.auth.getSession().then(({ data }) => {
            if (active && data.session) {
                router.replace("/home");
            }
        });

        return () => {
            active = false;
        };
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
            setLoading(false);
            setError(signInError.message);
            return;
        }

        router.replace("/home");
        router.refresh();
    }

    return (
        <main className="relative isolate flex min-h-screen items-center justify-center overflow-hidden bg-[#071b14] px-6 py-12">
            <div
                aria-hidden="true"
                className="pointer-events-none absolute inset-0 bg-cover bg-center"
                style={{ backgroundImage: "url('/tracking-login-bg.svg')" }}
            />
            <div aria-hidden="true" className="pointer-events-none absolute inset-0 bg-gradient-to-b from-[#071b14]/10 via-[#071b14]/15 to-[#061710]/60" />

            <div className="relative z-10 w-full max-w-md">
                <div className="mb-8 text-center">
                    <div className="mx-auto mb-7 inline-flex max-w-full items-center justify-center rounded-2xl bg-white px-5 py-3.5 shadow-[0_10px_35px_rgba(0,0,0,0.18)] sm:px-6 sm:py-4">
                        <img
                            src="/transparent_lw.png"
                            alt="Lifewood"
                            className="h-auto w-[300px] max-w-[72vw] object-contain"
                        />
                    </div>
                    <p className="mb-2 text-[0.65rem] font-bold uppercase tracking-[0.32em] text-[#ffbf62]">AI Search Intelligence</p>
                    <h1 className="mt-2 text-3xl font-semibold tracking-tight text-white">AEO/GEO Tracking</h1>
                    <p className="mt-3 text-sm leading-6 text-emerald-50/70">Sign in to access your AI visibility projects and tracking workspace.</p>
                </div>

                <form onSubmit={handleSubmit} className="rounded-3xl border border-emerald-900/20 bg-white p-7 shadow-[0_24px_70px_rgba(0,0,0,0.28)] sm:p-8">
                    {error && (
                        <div role="alert" className="mb-5 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm leading-5 text-red-700">
                            {error}
                        </div>
                    )}

                    <div className="space-y-5">
                        <label className="block">
                            <span className="text-sm font-semibold text-[var(--lw-dark-serpent)]">Email</span>
                            <input value={email} onChange={(e) => setEmail(e.target.value)} type="email" autoComplete="email" required disabled={loading} placeholder="you@company.com" className="mt-2 w-full rounded-xl border border-[var(--lw-border)] bg-white px-4 py-3 text-sm outline-none transition focus:border-[var(--lw-castleton-green)] focus:ring-2 focus:ring-[var(--lw-castleton-green)]/15 disabled:opacity-60" />
                        </label>

                        <label className="block">
                            <div className="flex items-center justify-between gap-4">
                                <span className="text-sm font-semibold text-[var(--lw-dark-serpent)]">Password</span>
                                <Link href="/forgot-password" className="text-xs font-semibold text-[var(--lw-castleton-green)] transition hover:opacity-80">Forgot your password?</Link>
                            </div>
                            <div className="relative mt-2">
                                <input value={password} onChange={(e) => setPassword(e.target.value)} type={showPassword ? "text" : "password"} autoComplete="current-password" required disabled={loading} placeholder="••••••••" className="w-full rounded-xl border border-[var(--lw-border)] bg-white px-4 py-3 pr-11 text-sm outline-none transition focus:border-[var(--lw-castleton-green)] focus:ring-2 focus:ring-[var(--lw-castleton-green)]/15 disabled:opacity-60" />
                                <button type="button" onClick={() => setShowPassword((value) => !value)} className="absolute right-3 top-1/2 -translate-y-1/2 text-[var(--lw-text-light)]" aria-label={showPassword ? "Hide password" : "Show password"}>
                                    {showPassword ? <EyeOff size={18} /> : <Eye size={18} />}
                                </button>
                            </div>
                        </label>
                    </div>

                    <button type="submit" disabled={loading} className="mt-7 flex w-full items-center justify-center gap-2 rounded-xl bg-[var(--lw-castleton-green)] px-4 py-3.5 text-sm font-semibold text-white transition hover:opacity-95 disabled:cursor-not-allowed disabled:opacity-60">
                        {loading ? "Signing in..." : "Sign in"}
                        {!loading && <ArrowRight size={17} />}
                    </button>

                    <p className="mt-5 text-center text-xs leading-5 text-[var(--lw-text-light)]">Authentication is securely handled by Supabase Auth.</p>
                </form>
                <p className="mt-6 text-center text-[0.65rem] font-medium uppercase tracking-[0.24em] text-emerald-100/35">AI visibility · Search intelligence · Tracking insights</p>
            </div>
        </main>
    );
}
