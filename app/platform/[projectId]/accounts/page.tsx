"use client";
import { useCallback, useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { Plus, ShieldCheck, Trash2, X, KeyRound, UsersRound, RefreshCw } from "lucide-react";
import { ProjectShell, UserRole } from "@/components/project-shell";
import { supabase } from "@/lib/supabase";

type Role = "superadmin" | "admin" | "viewer";
type Project = { id: string; name: string };
type User = {
  id: string; full_name: string; email: string; role: Role; is_permanent: boolean;
  projects: Array<{ id: string; name: string; role: Role }>;
};
type FormState = { name: string; email: string; password: string; role: Role; project_ids: string[] };
const emptyForm: FormState = { name: "", email: "", password: "", role: "viewer", project_ids: [] };

export default function AccountsPage() {
  const { projectId } = useParams<{ projectId: string }>();
  const router = useRouter();
  const [role, setRole] = useState<UserRole>("viewer");
  const [users, setUsers] = useState<User[]>([]);
  const [projects, setProjects] = useState<Project[]>([]);
  const [isSuperadmin, setIsSuperadmin] = useState(false);
  const [manageableProjectIds, setManageableProjectIds] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<User | null>(null);
  const [form, setForm] = useState<FormState>(emptyForm);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);

  const invoke = useCallback(async (action: string, body: Record<string, unknown> = {}) => {
    const { data, error } = await supabase.functions.invoke("admin-account-management", {
      body: { action, project_id: projectId, ...body },
    });
    if (error) {
      let detail = error.message;
      if (error.context instanceof Response) {
        try { const parsed = await error.context.clone().json(); detail = parsed?.error || detail; } catch {}
      }
      throw new Error(detail);
    }
    if (data?.error) throw new Error(data.error);
    return data;
  }, [projectId]);

  const load = useCallback(async () => {
    setLoading(true); setError("");
    try {
      const data = await invoke("list");
      setUsers(data.users ?? []);
      setProjects(data.projects ?? []);
      setIsSuperadmin(Boolean(data.is_superadmin));
      setManageableProjectIds(data.manageable_project_ids ?? []);
      const { data: auth } = await supabase.auth.getUser();
      if (auth.user) {
        const { data: profile } = await supabase.from("profiles").select("role").eq("id", auth.user.id).single();
        const { data: member } = await supabase.from("project_members").select("role").eq("project_id", projectId).eq("user_id", auth.user.id).maybeSingle();
        const currentRole = profile?.role === "superadmin" ? "superadmin" : member?.role ?? profile?.role ?? "viewer";
        setRole(currentRole);
      }
    } catch (e) {
      const text = e instanceof Error ? e.message : "Unable to load account management.";
      setError(text);
      if (/not authorized|only project admins|account-management access/i.test(text)) router.replace(`/platform/${projectId}`);
    } finally { setLoading(false); }
  }, [invoke, projectId, router]);

  useEffect(() => { void load(); }, [load]);

  async function submit(action: "create" | "update") {
    setBusy(true); setError(""); setMessage("");
    try {
      const payload: Record<string, unknown> = {
        name: form.name.trim(), email: form.email.trim(), role: form.role,
        project_ids: form.project_ids,
      };
      if (form.password) payload.password = form.password;
      if (action === "update" && editing) payload.user_id = editing.id;
      const result = await invoke(action, payload);
      setMessage(result.message ?? "Account saved.");
      setOpen(false); setEditing(null); setForm(emptyForm);
      await load();
    } catch (e) { setError(e instanceof Error ? e.message : "Unable to save account."); }
    finally { setBusy(false); }
  }

  async function removeAccess(user: User) {
    if (!confirm(`Remove ${user.full_name}'s access to the projects you manage? Their account will not be deleted.`)) return;
    setBusy(true); setError(""); setMessage("");
    try { const result = await invoke("remove_access", { user_id: user.id }); setMessage(result.message); await load(); }
    catch (e) { setError(e instanceof Error ? e.message : "Unable to remove project access."); }
    finally { setBusy(false); }
  }

  async function deleteAccount(user: User) {
    if (!confirm(`Permanently delete ${user.full_name}'s account? This cannot be undone.`)) return;
    setBusy(true); setError(""); setMessage("");
    try { const result = await invoke("delete", { user_id: user.id }); setMessage(result.message); await load(); }
    catch (e) { setError(e instanceof Error ? e.message : "Unable to delete account."); }
    finally { setBusy(false); }
  }

  function startEdit(user: User) {
    setEditing(user);
    setForm({
      name: user.full_name, email: user.email, password: "", role: user.role,
      project_ids: user.projects.filter(p => manageableProjectIds.includes(p.id)).map(p => p.id),
    });
    setOpen(true);
  }

  const canManage = role === "admin" || role === "superadmin";
  const visibleProjects = projects.filter(p => manageableProjectIds.includes(p.id));

  return <ProjectShell>
    <div className="ops-page">
      <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-end">
        <div>
          <p className="page-eyebrow">Accounts Management</p>
          <h2 className="page-title mt-1">{isSuperadmin ? "All platform accounts" : "Project users"}</h2>
          <p className="page-description mt-2">
            {isSuperadmin ? "Manage all registered accounts, roles and project assignments." : "Manage accounts assigned to the projects where you are an Admin."}
          </p>
        </div>
        <div className="flex gap-2">
          <button onClick={() => void load()} disabled={loading} className="platform-btn"><RefreshCw size={15}/> Refresh</button>
          {canManage && <button onClick={() => {
            setEditing(null);
            setForm({ ...emptyForm, project_ids: projects.some(p => p.id === projectId) ? [projectId] : visibleProjects.slice(0,1).map(p => p.id) });
            setOpen(true);
          }} className="inline-flex items-center gap-2 platform-btn platform-btn-primary"><Plus size={17}/> Add account</button>}
        </div>
      </div>

      {message && <div className="mt-5 rounded-xl border border-green-200 bg-green-50 px-4 py-3 text-sm text-green-800">{message}</div>}
      {error && <div role="alert" className="mt-5 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>}

      <section className="mt-8 platform-card p-5">
        <div className="mb-4 flex items-center gap-2 text-sm text-[var(--muted-foreground)]"><UsersRound size={16}/>{users.length} account{users.length === 1 ? "" : "s"}</div>
        <div className="overflow-x-auto">
          <table className="platform-table min-w-[1100px]">
            <thead><tr className="border-b border-[var(--line)] text-xs uppercase tracking-[0.12em] text-[#66736c]">
              <th className="px-3 py-3 text-left">Name</th><th className="px-3 py-3 text-left">Email</th><th className="px-3 py-3 text-left">Password</th><th className="px-3 py-3 text-left">Role</th><th className="px-3 py-3 text-left">Projects Assigned</th><th className="px-3 py-3 text-left">Actions</th>
            </tr></thead>
            <tbody>
              {loading ? <tr><td colSpan={6} className="px-3 py-10 text-center text-sm text-[var(--muted-foreground)]">Loading accounts…</td></tr> :
              users.map(user => {
                const protectedAccount = user.role === "superadmin";
                const canEditUser = isSuperadmin || (!protectedAccount && user.projects.some(p => manageableProjectIds.includes(p.id)));
                return <tr key={user.id} className="border-b border-[var(--line)] align-top">
                  <td className="px-3 py-4 font-semibold">{user.full_name || "Unnamed user"}{user.is_permanent && <span className="ml-2 rounded-full bg-[var(--soft)] px-2 py-0.5 text-[10px] font-semibold">Permanent</span>}</td>
                  <td className="px-3 py-4 text-[var(--muted-foreground)]">{user.email || "—"}</td>
                  <td className="px-3 py-4"><span className="inline-flex items-center gap-1.5 text-xs text-[var(--muted-foreground)]"><KeyRound size={13}/>Password protected</span><p className="mt-1 text-[11px] text-[var(--muted-foreground)]">Reset by authorised editor</p></td>
                  <td className="px-3 py-4"><span className="inline-flex items-center gap-1 rounded-full bg-[var(--soft)] px-2.5 py-1 text-xs font-semibold capitalize text-[var(--green)]"><ShieldCheck size={13}/>{user.role}</span></td>
                  <td className="max-w-[340px] px-3 py-4"><div className="flex flex-wrap gap-1.5">{user.projects.filter(p => isSuperadmin || manageableProjectIds.includes(p.id)).map(p => <span key={p.id} title={p.role} className="rounded-lg border border-[var(--line)] px-2 py-1 text-xs">{p.name}</span>)}{user.projects.filter(p => isSuperadmin || manageableProjectIds.includes(p.id)).length === 0 && <span className="text-[var(--muted-foreground)]">—</span>}</div></td>
                  <td className="px-3 py-4"><div className="flex flex-wrap gap-2">
                    {canEditUser && <button onClick={() => startEdit(user)} className="rounded-lg border border-[var(--line)] px-3 py-1.5 text-xs font-semibold">Edit</button>}
                    {!isSuperadmin && canEditUser && !protectedAccount && <button disabled={busy} onClick={() => void removeAccess(user)} className="rounded-lg border border-[var(--line)] px-3 py-1.5 text-xs font-semibold disabled:opacity-50">Remove access</button>}
                    {isSuperadmin && !protectedAccount && !user.is_permanent && <button disabled={busy} onClick={() => void deleteAccount(user)} className="rounded-lg p-2 text-[#a13f35] hover:bg-red-50 disabled:opacity-50" title="Delete account"><Trash2 size={16}/></button>}
                  </div></td>
                </tr>;
              })}
              {!loading && users.length === 0 && <tr><td colSpan={6} className="px-3 py-10 text-center text-sm text-[var(--muted-foreground)]">No accounts found in your access scope.</td></tr>}
            </tbody>
          </table>
        </div>
      </section>
      <p className="mt-4 text-xs leading-5 text-[var(--muted-foreground)]">Passwords are stored and verified by Supabase Auth and cannot be retrieved as plaintext. Editors can set a new temporary password when editing an account.</p>

      {open && <div className="fixed inset-0 z-50 flex items-center justify-center overflow-y-auto bg-black/40 p-4" onMouseDown={e => { if (e.currentTarget === e.target && !busy) { setOpen(false); setEditing(null); } }}>
        <div className="my-6 w-full max-w-2xl rounded-3xl border border-[var(--line)] bg-[var(--card)] p-6 shadow-2xl sm:p-7">
          <div className="flex items-start justify-between gap-4"><div><p className="page-eyebrow">{editing ? "Edit account" : "New account"}</p><h3 className="mt-1 text-2xl font-semibold">{editing ? editing.full_name : "Create user"}</h3><p className="mt-2 text-sm text-[var(--muted-foreground)]">Set account details and project access.</p></div><button disabled={busy} onClick={() => { setOpen(false); setEditing(null); }} className="rounded-lg p-2 hover:bg-[var(--accent)]"><X size={20}/></button></div>
          <div className="mt-6 grid gap-4 sm:grid-cols-2">
            <label className="text-sm font-semibold">Name<input value={form.name} onChange={e=>setForm(v=>({...v,name:e.target.value}))} className="mt-2 w-full platform-input"/></label>
            <label className="text-sm font-semibold">Email<input type="email" value={form.email} onChange={e=>setForm(v=>({...v,email:e.target.value}))} className="mt-2 w-full platform-input"/></label>
            <label className="text-sm font-semibold sm:col-span-2">{editing ? "New temporary password (optional)" : "Temporary password"}<input type="password" autoComplete="new-password" value={form.password} onChange={e=>setForm(v=>({...v,password:e.target.value}))} placeholder={editing ? "Leave blank to keep current password" : "At least 8 characters"} className="mt-2 w-full platform-input"/><span className="mt-1 block text-xs font-normal text-[var(--muted-foreground)]">{editing ? "Entering a password resets it immediately." : "Use at least 8 characters."}</span></label>
            <label className="text-sm font-semibold sm:col-span-2">Role<select value={form.role} onChange={e=>setForm(v=>({...v,role:e.target.value as Role}))} className="mt-2 w-full platform-input">
              {isSuperadmin && <option value="superadmin">Superadmin</option>}<option value="admin">Admin</option><option value="viewer">Viewer</option>
            </select></label>
          </div>
          <div className="mt-5"><p className="text-sm font-semibold">Projects assigned</p><p className="mt-1 text-xs text-[var(--muted-foreground)]">Only projects you are allowed to manage are listed.</p>
            <div className="mt-3 grid gap-2 sm:grid-cols-2">{visibleProjects.map(p=><label key={p.id} className="flex items-center gap-2 rounded-xl border border-[var(--line)] p-3 text-sm"><input type="checkbox" checked={form.project_ids.includes(p.id)} onChange={e=>setForm(v=>({...v,project_ids:e.target.checked?[...v.project_ids,p.id]:v.project_ids.filter(id=>id!==p.id)}))}/>{p.name}</label>)}</div>
            {visibleProjects.length === 0 && <p className="mt-2 text-sm text-[var(--muted-foreground)]">No assignable projects are available.</p>}
          </div>
          <div className="mt-7 flex flex-col-reverse gap-3 sm:flex-row sm:justify-end"><button disabled={busy} onClick={()=>{setOpen(false);setEditing(null);}} className="platform-btn">Cancel</button><button disabled={busy||!form.name.trim()||!form.email.trim()||(!editing&&form.password.length<8)||(Boolean(form.password)&&form.password.length<8)||(!isSuperadmin&&form.project_ids.length===0)} onClick={()=>void submit(editing?"update":"create")} className="platform-btn platform-btn-primary disabled:opacity-40">{busy?"Saving…":editing?"Save changes":"Create account"}</button></div>
        </div>
      </div>}
    </div>
  </ProjectShell>;
}
