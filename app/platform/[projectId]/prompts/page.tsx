"use client";
import { ChangeEvent, useEffect, useMemo, useState } from "react";
import { Download, Plus, Search, Trash2, Upload, X } from "lucide-react";
import { useParams } from "next/navigation";
import * as XLSX from "xlsx";
import { ProjectShell, UserRole } from "@/components/project-shell";
import { supabase } from "@/lib/supabase";

type Prompt = { id: string; prompt_number: number; prompt: string; topic: string; language: string; active: boolean };
type LatestMetric = { metric_date: string; visibility_rank: number | null; share_of_voice_rank: number | null; average_position_rank: number | null };
const languages = ["English", "Malay", "Chinese", "Japanese", "Korean", "Thai", "Indonesian", "Arabic", "Other"];

export default function PromptsPage() {
  const { projectId } = useParams<{ projectId: string }>();
  const [prompts, setPrompts] = useState<Prompt[]>([]);
  const [topics, setTopics] = useState<string[]>([]);
  const [latestMetrics, setLatestMetrics] = useState<Record<string, LatestMetric>>({});
  const [role, setRole] = useState<UserRole>("viewer");
  const [search, setSearch] = useState("");
  const [topicFilter, setTopicFilter] = useState("All");
  const [expanded, setExpanded] = useState(false);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [deleteIds, setDeleteIds] = useState<string[]>([]);
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ prompt: "", topic: "", language: "English" });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  async function load() {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;
    const [{ data: promptRows, error: promptError }, { data: project }, { data: profile }, { data: member }, { data: metrics, error: metricError }] = await Promise.all([
      supabase.from("prompts").select("id,prompt_number,prompt,topic,language,active").eq("project_id", projectId).order("prompt_number"),
      supabase.from("projects").select("topics").eq("id", projectId).single(),
      supabase.from("profiles").select("role").eq("id", user.id).single(),
      supabase.from("project_members").select("role").eq("project_id", projectId).eq("user_id", user.id).maybeSingle(),
      supabase.from("visibility_daily").select("metric_date,topic,visibility_rank,share_of_voice_rank,average_position_rank").eq("project_id", projectId).eq("llm_provider", "chatgpt").neq("topic", "Overall").order("metric_date", { ascending: false }),
    ]);
    if (promptError) setError(promptError.message);
    if (metricError) setError((current) => current ? current + " " + metricError.message : metricError.message);
    setPrompts(promptRows ?? []);
    setTopics(project?.topics ?? []);
    setRole(profile?.role === "superadmin" ? "superadmin" : member?.role ?? profile?.role ?? "viewer");
    const byTopic: Record<string, LatestMetric> = {};
    for (const metric of metrics ?? []) {
      if (metric.topic && !byTopic[metric.topic]) byTopic[metric.topic] = metric as LatestMetric;
    }
    setLatestMetrics(byTopic);
  }

  useEffect(() => { void load(); }, [projectId]);

  const canEdit = role === "admin" || role === "superadmin";
  const filtered = useMemo(() => {
    const term = search.trim().toLocaleLowerCase();
    return prompts.filter((prompt) =>
      (topicFilter === "All" || prompt.topic === topicFilter) &&
      (!term || [prompt.prompt, prompt.topic, prompt.language].some((value) => value.toLocaleLowerCase().includes(term)))
    );
  }, [prompts, search, topicFilter]);
  const visible = expanded ? filtered : filtered.slice(0, 10);
  const allFilteredSelected = filtered.length > 0 && filtered.every((prompt) => selectedIds.includes(prompt.id));

  function togglePrompt(id: string) {
    setSelectedIds((current) => current.includes(id) ? current.filter((value) => value !== id) : [...current, id]);
  }
  function toggleAllFiltered() {
    setSelectedIds((current) => allFilteredSelected
      ? current.filter((id) => !filtered.some((prompt) => prompt.id === id))
      : [...new Set([...current, ...filtered.map((prompt) => prompt.id)])]
    );
  }

  async function addPrompt(keepOpen = false) {
    if (!canEdit || !form.prompt.trim() || !form.topic) return;
    if (prompts.length >= 100) { setError("The project already has 100 prompts."); return; }
    setBusy(true); setError(""); setNotice("");
    const promptNumber = Math.max(0, ...prompts.map((prompt) => prompt.prompt_number)) + 1;
    const { error: insertError } = await supabase.from("prompts").insert({
      project_id: projectId, prompt_number: promptNumber, prompt: form.prompt.trim(), topic: form.topic, language: form.language,
    });
    if (insertError) setError(insertError.message);
    else {
      setForm({ prompt: "", topic: topics[0] || "", language: "English" });
      if (!keepOpen) setOpen(false);
      setNotice("Prompt added successfully.");
      await load();
    }
    setBusy(false);
  }

  async function confirmDelete() {
    if (!canEdit || !deleteIds.length) return;
    setBusy(true); setError(""); setNotice("");
    const { error: deleteError } = await supabase.from("prompts").delete().eq("project_id", projectId).in("id", deleteIds);
    if (deleteError) setError(deleteError.message);
    else {
      setSelectedIds((current) => current.filter((id) => !deleteIds.includes(id)));
      setNotice(`${deleteIds.length} prompt${deleteIds.length === 1 ? "" : "s"} deleted.`);
      setDeleteIds([]);
      await load();
    }
    setBusy(false);
  }

  function template() {
    const worksheet = XLSX.utils.json_to_sheet([{ Prompt: "Example prompt", Topic: topics[0] || "Example topic", Language: "English" }]);
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, "Prompts");
    XLSX.writeFile(workbook, "lifewood-prompts-template.xlsx");
  }

  async function upload(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file || !canEdit) return;
    setBusy(true); setError(""); setNotice("");
    try {
      const workbook = XLSX.read(await file.arrayBuffer(), { type: "array" });
      const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(workbook.Sheets[workbook.SheetNames[0]]);
      if (prompts.length + rows.length > 100) throw new Error("Bulk upload would exceed the 100-prompt limit.");
      const startNumber = Math.max(0, ...prompts.map((prompt) => prompt.prompt_number)) + 1;
      const payload = rows.map((row, index) => ({
        project_id: projectId, prompt_number: startNumber + index,
        prompt: String(row.Prompt ?? row.prompt ?? "").trim(),
        topic: String(row.Topic ?? row.topic ?? "").trim(),
        language: String(row.Language ?? row.language ?? "").trim(),
      })).filter((row) => row.prompt && row.topic && row.language);
      if (payload.length !== rows.length) throw new Error("Each row needs Prompt, Topic and Language.");
      const { error: uploadError } = await supabase.from("prompts").insert(payload);
      if (uploadError) throw uploadError;
      setNotice(`${payload.length} prompts uploaded successfully.`);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
      event.target.value = "";
    }
  }

  return <ProjectShell><div className="ops-page">
    <div className="flex flex-col justify-between gap-4 lg:flex-row lg:items-end">
      <div><p className="page-eyebrow">Prompts</p><h2 className="page-title mt-1">Prompt library</h2><p className="page-description mt-2">Manage the 100 prompts used for daily AI visibility collection.</p></div>
      {canEdit && <div className="flex flex-wrap gap-2">
        <button onClick={template} className="inline-flex items-center gap-2 platform-btn px-4 py-3 text-sm font-semibold"><Download size={16}/> Template</button>
        <label className={"inline-flex items-center gap-2 platform-btn px-4 py-3 text-sm font-semibold " + (busy ? "pointer-events-none opacity-50" : "cursor-pointer")}><Upload size={16}/> Bulk upload<input type="file" accept=".xlsx,.xls,.csv" className="hidden" disabled={busy} onChange={upload}/></label>
        <button disabled={prompts.length >= 100 || busy} onClick={() => { setForm({ prompt: "", topic: topics[0] || "", language: "English" }); setOpen(true); }} className="inline-flex items-center gap-2 platform-btn platform-btn-primary disabled:opacity-40"><Plus size={16}/> Add prompt</button>
      </div>}
    </div>

    {error && <div role="alert" className="mt-5 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>}
    {notice && <div role="status" className="mt-5 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800">{notice}</div>}

    <section className="mt-6 platform-card p-5">
      <div className="flex flex-col gap-4 xl:flex-row xl:items-center xl:justify-between">
        <div>
          <h3 className="text-lg font-semibold">All prompts <span className="ml-2 rounded-full bg-[var(--soft)] px-2.5 py-1 text-sm font-semibold text-[var(--green)]">{prompts.length} / 100</span></h3>
          <p className="mt-1 text-sm text-[#66736c]">{filtered.length} matching {filtered.length === 1 ? "prompt" : "prompts"}{canEdit ? " · Select prompts to delete them in bulk." : ""}</p>
        </div>
        <div className="flex flex-col gap-2 sm:flex-row">
          <label className="flex items-center gap-2 rounded-xl border border-[var(--line)] bg-white px-3 py-2.5 focus-within:border-[var(--green)]">
            <Search size={16} className="text-[#66736c]" aria-hidden="true"/>
            <input value={search} onChange={(event) => { setSearch(event.target.value); setExpanded(false); }} placeholder="Search prompts…" aria-label="Search prompts" className="w-full min-w-[190px] bg-transparent text-sm outline-none"/>
          </label>
          <select value={topicFilter} onChange={(event) => { setTopicFilter(event.target.value); setExpanded(false); }} aria-label="Filter prompts by topic" className="platform-input text-sm">
            <option value="All">All topics</option>{topics.map((value) => <option key={value} value={value}>{value}</option>)}
          </select>
        </div>
      </div>

      {canEdit && selectedIds.length > 0 && <div className="mt-4 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-red-100 bg-red-50 px-4 py-3">
        <span className="text-sm font-medium text-red-900">{selectedIds.length} prompt{selectedIds.length === 1 ? "" : "s"} selected</span>
        <div className="flex items-center gap-2">
          <button onClick={() => setSelectedIds([])} className="rounded-lg px-3 py-2 text-sm font-semibold text-[#66736c]">Clear selection</button>
          <button onClick={() => setDeleteIds(selectedIds)} className="inline-flex items-center gap-2 rounded-xl bg-[#a13f35] px-3 py-2 text-sm font-semibold text-white"><Trash2 size={15}/> Delete selected</button>
        </div>
      </div>}

      <div className="mt-4 overflow-x-auto">
        <table className="platform-table min-w-[1250px]">
          <thead><tr className="border-b border-[var(--line)] text-xs uppercase tracking-[.12em] text-[#66736c]">
            {canEdit && <th className="w-10 px-3 py-3"><input type="checkbox" checked={allFilteredSelected} onChange={toggleAllFiltered} aria-label="Select all filtered prompts" className="h-4 w-4 accent-[#0d5b3a]"/></th>}
            <th className="px-3 py-3">#</th><th className="px-3 py-3">Prompt</th><th className="px-3 py-3">Topic</th><th className="px-3 py-3">Language</th>
            <th className="px-3 py-3">Latest Visibility Rank</th><th className="px-3 py-3">Latest Share of Voice Rank</th><th className="px-3 py-3">Latest Average Position Rank</th>
            {canEdit && <th className="px-3 py-3">Delete</th>}
          </tr></thead>
          <tbody>
            {visible.map((prompt) => {
              const metric = latestMetrics[prompt.topic];
              return <tr key={prompt.id} className="border-b border-[#eef0ee]">
                {canEdit && <td className="px-3 py-3"><input type="checkbox" checked={selectedIds.includes(prompt.id)} onChange={() => togglePrompt(prompt.id)} aria-label={"Select prompt " + prompt.prompt_number} className="h-4 w-4 accent-[#0d5b3a]"/></td>}
                <td className="px-3 py-3">{prompt.prompt_number}</td>
                <td className="max-w-[420px] whitespace-normal px-3 py-3">{prompt.prompt}</td>
                <td className="px-3 py-3"><span className="rounded-full bg-[var(--soft)] px-2.5 py-1 text-xs font-semibold text-[var(--green)]">{prompt.topic}</span></td>
                <td className="px-3 py-3">{prompt.language}</td>
                <td className="px-3 py-3 font-semibold">{metric?.visibility_rank ?? "—"}</td>
                <td className="px-3 py-3 font-semibold">{metric?.share_of_voice_rank ?? "—"}</td>
                <td className="px-3 py-3 font-semibold">{metric?.average_position_rank ?? "—"}</td>
                {canEdit && <td className="px-3 py-3"><button onClick={() => setDeleteIds([prompt.id])} aria-label={"Delete prompt " + prompt.prompt_number} className="rounded-lg p-2 text-[#a13f35] hover:bg-red-50"><Trash2 size={16}/></button></td>}
              </tr>;
            })}
            {!visible.length && <tr><td colSpan={canEdit ? 9 : 7} className="px-3 py-10 text-center text-sm text-[#66736c]">No prompts found.</td></tr>}
          </tbody>
        </table>
      </div>
      {filtered.length > 10 && <div className="mt-4 flex flex-wrap items-center justify-between gap-3 border-t border-[var(--line)] pt-4">
        <p className="text-sm text-[#66736c]">Showing {visible.length} of {filtered.length} prompts</p>
        <button type="button" onClick={() => setExpanded((value) => !value)} className="ops-filter-btn">{expanded ? "Show first 10" : "Show all " + filtered.length + " prompts"}</button>
      </div>}
      <p className="mt-3 text-xs text-[#66736c]">Rank metrics are the latest available values for each prompt’s topic; the tracking system currently calculates these metrics at topic level.</p>
    </section>

    {open && <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-5" role="presentation">
      <div role="dialog" aria-modal="true" aria-labelledby="add-prompt-title" className="w-full max-w-xl rounded-3xl bg-white p-7 text-[#173b2a] shadow-xl">
        <div className="flex items-center justify-between"><h3 id="add-prompt-title" className="text-2xl font-semibold">Add prompt</h3><button onClick={() => setOpen(false)} aria-label="Close add prompt dialog"><X/></button></div>
        <label className="mt-6 block text-sm font-semibold">Prompt<textarea rows={5} value={form.prompt} onChange={(event) => setForm({ ...form, prompt: event.target.value })} className="mt-2 w-full platform-input"/></label>
        <label className="mt-4 block text-sm font-semibold">Topic<select value={form.topic} onChange={(event) => setForm({ ...form, topic: event.target.value })} className="mt-2 w-full platform-input">{topics.map((value) => <option key={value} value={value}>{value}</option>)}</select></label>
        <label className="mt-4 block text-sm font-semibold">Language<select value={form.language} onChange={(event) => setForm({ ...form, language: event.target.value })} className="mt-2 w-full platform-input">{languages.map((value) => <option key={value} value={value}>{value}</option>)}</select></label>
        <div className="mt-6 flex flex-wrap justify-end gap-2"><button onClick={() => setOpen(false)} className="platform-btn">Cancel</button><button disabled={busy || !form.prompt.trim() || !form.topic} onClick={() => addPrompt(true)} className="rounded-xl border border-[#0d5b3a] px-4 py-3 text-sm font-semibold text-[var(--green)] disabled:opacity-40">Add &amp; next</button><button disabled={busy || !form.prompt.trim() || !form.topic} onClick={() => addPrompt(false)} className="platform-btn platform-btn-primary disabled:opacity-40">Add prompt</button></div>
      </div>
    </div>}

    {deleteIds.length > 0 && <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/45 p-5" role="presentation">
      <div role="alertdialog" aria-modal="true" aria-labelledby="delete-prompts-title" aria-describedby="delete-prompts-description" className="w-full max-w-md rounded-3xl bg-white p-7 text-[#173b2a] shadow-xl">
        <div className="flex h-12 w-12 items-center justify-center rounded-full bg-red-50 text-[#a13f35]"><Trash2 size={22}/></div>
        <h3 id="delete-prompts-title" className="mt-4 text-xl font-semibold">Confirm prompt deletion</h3>
        <p id="delete-prompts-description" className="mt-2 text-sm leading-6 text-[#66736c]">Are you sure you want to delete {deleteIds.length} selected prompt{deleteIds.length === 1 ? "" : "s"}? This action cannot be undone. Existing tracking responses and citations are retained where possible.</p>
        <div className="mt-6 flex justify-end gap-2"><button disabled={busy} onClick={() => setDeleteIds([])} className="platform-btn disabled:opacity-50">Cancel</button><button disabled={busy} onClick={confirmDelete} className="inline-flex items-center gap-2 rounded-xl bg-[#a13f35] px-4 py-3 text-sm font-semibold text-white disabled:opacity-50">{busy ? "Deleting…" : <><Trash2 size={16}/> Delete prompts</>}</button></div>
      </div>
    </div>}
  </div></ProjectShell>;
}
