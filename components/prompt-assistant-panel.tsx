"use client";
import { useEffect, useState } from "react";
import { Check, Loader2, RefreshCw, RotateCw, Sparkles, X } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { assistantErrorMessage, notShown, remainingSlots, PROMPT_LIMIT, type BrandProfile, type Suggestion, type SuggestionMode } from "@/lib/prompt-assistant";

type SuggestionResponse = { prompt: string; category: string; language: string; mode: SuggestionMode };

const languages = ["English", "Malay", "Chinese", "Japanese", "Korean", "Thai", "Indonesian", "Arabic", "Other"];

async function invokeAssistant<T>(body: Record<string, unknown>): Promise<T> {
  const { data, error } = await supabase.functions.invoke("prompt-assistant", { body });
  if (error) {
    const context = (error as { context?: Response }).context;
    let payload: { error?: string; message?: string } | undefined;
    try { payload = await context?.json(); } catch { payload = undefined; }
    throw new Error(assistantErrorMessage(payload?.error, payload?.message, context?.status));
  }
  return data as T;
}

let nextId = 0;
const toSuggestion = (item: SuggestionResponse): Suggestion => ({ ...item, id: "s" + (nextId++), selected: true });

export function PromptAssistantPanel({ projectId, categories, existingCount, onClose, onSave }: {
  projectId: string;
  categories: string[];
  existingCount: number;
  onClose: () => void;
  onSave: (rows: { prompt: string; category: string; language: string }[]) => Promise<void>;
}) {
  const [profile, setProfile] = useState<BrandProfile | null>(null);
  const [profileLoading, setProfileLoading] = useState(true);
  const [descriptionOnly, setDescriptionOnly] = useState(false);
  const [category, setCategory] = useState(categories[0] ?? "");
  const [language, setLanguage] = useState("English");
  const [mode, setMode] = useState<SuggestionMode>("discovery");
  const [suggestions, setSuggestions] = useState<Suggestion[]>([]);
  const [generating, setGenerating] = useState(false);
  const [replacingId, setReplacingId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const slots = remainingSlots(existingCount);
  const selected = suggestions.filter((item) => item.selected && item.prompt.trim());
  const overLimit = selected.length > slots;

  async function analyze() {
    setProfileLoading(true); setError("");
    try {
      const result = await invokeAssistant<{ profile: BrandProfile; source: string }>({ action: "analyze", project_id: projectId });
      setProfile(result.profile);
      setDescriptionOnly(result.source === "description_only");
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setProfileLoading(false);
    }
  }

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const { data } = await supabase.from("projects").select("brand_profile").eq("id", projectId).maybeSingle();
      if (cancelled) return;
      if (data?.brand_profile) { setProfile(data.brand_profile as BrandProfile); setProfileLoading(false); }
      else await analyze();
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => { if (event.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  async function generate() {
    if (!category) return;
    setGenerating(true); setError(""); setNotice("");
    try {
      const shown = suggestions.map((item) => item.prompt);
      const result = await invokeAssistant<{ suggestions: SuggestionResponse[]; profile_source?: string }>({ action: "generate", project_id: projectId, category, mode, language, exclude: shown });
      if (result.profile_source === "description_only") setDescriptionOnly(true);
      const fresh = notShown(result.suggestions.map((item) => item.prompt), shown);
      const incoming = result.suggestions.filter((item) => fresh.includes(item.prompt));
      if (!incoming.length) setNotice("No new prompts this time. The AI only came up with prompts you already have. Try another category or type.");
      setSuggestions((current) => [...incoming.map(toSuggestion), ...current]);
      if (!profile) {
        const { data } = await supabase.from("projects").select("brand_profile").eq("id", projectId).maybeSingle();
        if (data?.brand_profile) setProfile(data.brand_profile as BrandProfile);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setGenerating(false);
    }
  }

  async function replace(item: Suggestion) {
    setReplacingId(item.id); setError("");
    try {
      const shown = suggestions.map((value) => value.prompt);
      const result = await invokeAssistant<{ suggestions: SuggestionResponse[] }>({ action: "generate", project_id: projectId, category: item.category, mode: item.mode, language: item.language, count: 1, exclude: shown });
      const replacement = result.suggestions.find((value) => notShown([value.prompt], shown).length > 0);
      if (replacement) setSuggestions((current) => current.map((value) => value.id === item.id ? toSuggestion(replacement) : value));
      else setNotice("Couldn't find a different prompt for that one. Edit it or untick it.");
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setReplacingId(null);
    }
  }

  function update(id: string, patch: Partial<Suggestion>) {
    setSuggestions((current) => current.map((item) => item.id === id ? { ...item, ...patch } : item));
  }

  async function save() {
    if (!selected.length || overLimit) return;
    setSaving(true); setError(""); setNotice("");
    try {
      await onSave(selected.map((item) => ({ prompt: item.prompt.trim(), category: item.category, language: item.language })));
      const savedIds = new Set(selected.map((item) => item.id));
      setSuggestions((current) => current.filter((item) => !savedIds.has(item.id)));
      setNotice(`${selected.length} prompt${selected.length === 1 ? "" : "s"} added to the library.`);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  }

  return <div className="fixed inset-0 z-50 flex justify-end bg-black/40" role="presentation" onClick={onClose}>
    <aside role="dialog" aria-modal="true" aria-labelledby="prompt-assistant-title" onClick={(event) => event.stopPropagation()}
      className="flex h-full w-full max-w-2xl flex-col bg-white text-[#173b2a] shadow-2xl">
      <header className="flex items-start justify-between gap-4 border-b border-[var(--line)] px-6 py-5">
        <div>
          <p className="page-eyebrow flex items-center gap-1.5"><Sparkles size={13}/> AI prompt assistant</p>
          <h3 id="prompt-assistant-title" className="mt-1 text-xl font-semibold">Suggest prompts for this brand</h3>
          <p className="mt-1 text-sm text-[#66736c]">Generate 5 at a time, edit them, and add only the ones you want to track.</p>
        </div>
        <button onClick={onClose} aria-label="Close AI prompt assistant" className="rounded-lg p-2 hover:bg-[var(--soft)]"><X size={20}/></button>
      </header>

      <div className="flex-1 space-y-5 overflow-y-auto px-6 py-5">
        <section className="rounded-2xl border border-[var(--line)] bg-[var(--soft)] p-4">
          <div className="flex items-center justify-between gap-3">
            <h4 className="text-sm font-semibold">What the AI knows about the brand</h4>
            <button onClick={() => void analyze()} disabled={profileLoading} className="inline-flex items-center gap-1.5 text-xs font-semibold text-[var(--green)] disabled:opacity-50">
              <RefreshCw size={13} className={profileLoading ? "animate-spin" : ""}/> Refresh profile
            </button>
          </div>
          {profileLoading
            ? <div className="mt-3 space-y-2" aria-label="Analysing the brand"><div className="h-3 w-full animate-pulse rounded bg-white"/><div className="h-3 w-4/5 animate-pulse rounded bg-white"/><p className="text-xs text-[#66736c]">Reading the website and summarising the brand…</p></div>
            : profile
              ? <>
                  <p className="mt-2 text-sm leading-6">{profile.summary}</p>
                  {profile.offerings.length > 0 && <div className="mt-3 flex flex-wrap gap-1.5">{profile.offerings.map((item) => <span key={item} className="rounded-full bg-white px-2.5 py-1 text-xs font-medium text-[var(--green)]">{item}</span>)}</div>}
                </>
              : <p className="mt-2 text-sm text-[#66736c]">No profile yet. Use Refresh profile to analyse the brand.</p>}
          {descriptionOnly && !profileLoading && <p className="mt-3 rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-800">Built from the project description only. The website couldn&apos;t be read.</p>}
        </section>

        <section className="grid gap-3 sm:grid-cols-2">
          <label className="block text-sm font-semibold">Category
            <select value={category} onChange={(event) => setCategory(event.target.value)} className="mt-2 w-full platform-input">{categories.map((value) => <option key={value} value={value}>{value}</option>)}</select>
          </label>
          <label className="block text-sm font-semibold">Language
            <select value={language} onChange={(event) => setLanguage(event.target.value)} className="mt-2 w-full platform-input">{languages.map((value) => <option key={value} value={value}>{value}</option>)}</select>
          </label>
          <div className="sm:col-span-2">
            <p className="text-sm font-semibold">Prompt type</p>
            <div role="radiogroup" aria-label="Prompt type" className="mt-2 inline-flex rounded-xl border border-[var(--line)] p-1">
              {([["discovery", "Discovery"], ["brand", "Brand perception"]] as const).map(([value, label]) =>
                <button key={value} role="radio" aria-checked={mode === value} onClick={() => setMode(value)}
                  className={"rounded-lg px-3 py-1.5 text-sm font-semibold " + (mode === value ? "bg-[var(--green)] text-white" : "text-[#66736c]")}>{label}</button>)}
            </div>
            <p className="mt-2 text-xs leading-5 text-[#66736c]">{mode === "discovery"
              ? "Questions buyers ask before they pick a company. These show whether AI recommends the brand on its own."
              : "Brand prompts name your brand and raise the score; use them to check how AI describes you."}</p>
          </div>
        </section>

        <button onClick={() => void generate()} disabled={generating || profileLoading || !category || slots === 0}
          className="inline-flex w-full items-center justify-center gap-2 platform-btn platform-btn-primary disabled:opacity-50">
          {generating ? <><Loader2 size={16} className="animate-spin"/> Generating…</> : <><Sparkles size={16}/> Generate 5 prompts</>}
        </button>
        {slots === 0 && <p className="text-center text-xs text-[#66736c]">The project already has {PROMPT_LIMIT} prompts.</p>}

        {error && <div role="alert" className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>}
        {notice && <div role="status" className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800">{notice}</div>}

        {suggestions.length > 0 && <ul className="space-y-3" aria-label="Suggested prompts">
          {suggestions.map((item) => <li key={item.id} className={"rounded-2xl border p-3 " + (item.selected ? "border-[var(--green)] bg-white" : "border-[var(--line)] bg-[#fafbfa] opacity-70")}>
            <div className="flex items-start gap-3">
              <input type="checkbox" checked={item.selected} onChange={(event) => update(item.id, { selected: event.target.checked })} aria-label="Include this prompt" className="mt-2 h-4 w-4 accent-[#0d5b3a]"/>
              <textarea value={item.prompt} onChange={(event) => update(item.id, { prompt: event.target.value })} rows={2} aria-label="Edit prompt" className="w-full resize-y rounded-lg border border-transparent bg-transparent px-2 py-1.5 text-sm leading-6 outline-none focus:border-[var(--line)]"/>
              <button onClick={() => void replace(item)} disabled={replacingId === item.id} aria-label="Replace this prompt" title="Replace this prompt" className="rounded-lg p-2 text-[#66736c] hover:bg-[var(--soft)] disabled:opacity-50">
                <RotateCw size={15} className={replacingId === item.id ? "animate-spin" : ""}/>
              </button>
            </div>
            <div className="mt-1 flex flex-wrap gap-1.5 pl-7 text-[11px] font-semibold">
              <span className="rounded-full bg-[var(--soft)] px-2 py-0.5 text-[var(--green)]">{item.category}</span>
              <span className="rounded-full bg-[var(--soft)] px-2 py-0.5 text-[#66736c]">{item.language}</span>
              {item.mode === "brand" && <span className="rounded-full bg-amber-100 px-2 py-0.5 text-amber-800">Brand</span>}
            </div>
          </li>)}
        </ul>}
      </div>

      <footer className="flex flex-wrap items-center justify-between gap-3 border-t border-[var(--line)] px-6 py-4">
        <div className="text-sm">
          <span className="font-semibold">{Math.min(PROMPT_LIMIT, existingCount + selected.length)} / {PROMPT_LIMIT}</span>
          <span className="text-[#66736c]"> prompts after adding</span>
          {overLimit && <p className="text-xs text-red-700">Only {slots} slot{slots === 1 ? "" : "s"} left. Untick {selected.length - slots}.</p>}
        </div>
        <button onClick={() => void save()} disabled={saving || !selected.length || overLimit}
          className="inline-flex items-center gap-2 platform-btn platform-btn-primary disabled:opacity-40">
          {saving ? <><Loader2 size={16} className="animate-spin"/> Adding…</> : <><Check size={16}/> Add selected ({selected.length})</>}
        </button>
      </footer>
    </aside>
  </div>;
}
